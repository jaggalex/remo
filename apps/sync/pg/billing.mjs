/**
 * Billing reads and utilisation counters (ADR-247, `spec/billing.md` §2.2–2.3).
 *
 * Every method here expects an established tenant: `orgs`, `org_memberships`,
 * `boards` and every `subscriptions` row are protected by RLS (ADR-178), and without the
 * setting a read silently returns no rows — which would look like "no subscription" and
 * quietly downgrade a paying organisation to Free. Call them inside
 * `store.withTenant(orgId, …)`; `entitlementsFor` and the org-scoped billing routes do.
 */
import { billingMoneyMethods } from "./billing-money.mjs";

/** Every sellable pair, the unit `checkPriceLists` reports a gap for (§2.1.1). */
const PAID_PLAN_KEYS = Object.freeze(
  ["pro", "team", "business"].flatMap((plan) => [`${plan}/month`, `${plan}/year`]),
);

/** `amount` is `bigint`, which node-postgres hands back as text; callers do arithmetic. */
function mapPrice(row) {
  return row ? { ...row, amount: Number(row.amount) } : null;
}

export const billingMethods = {
  /** The kind decides Free-ness: a personal organisation cannot buy a plan (§2.2). */
  async billingOrg(orgId) {
    const { rows } = await this.pool.query("select id, kind from orgs where id = $1", [orgId]);
    return rows[0] ?? null;
  },

  /**
   * The one live subscription, or null. `subscriptions_live_idx` makes at most one row
   * match; the order is belt and braces for a database whose index is not in place yet.
   */
  async liveSubscription(orgId) {
    const { rows } = await this.pool.query(
      `select *
         from subscriptions
        where org_id = $1
          and status in ('trialing', 'active', 'past_due', 'suspended')
        order by created_at desc
        limit 1`,
      [orgId],
    );
    return rows[0] ?? null;
  },

  /**
   * Seats in use (§2.3): an active member, or a guest who holds editor or a higher role
   * in at least one room of the organisation. Viewers, commenters and public-link
   * visitors are free.
   *
   * A guest can only reach a role through a user grant — an org grant explicitly excludes
   * guests and a guest has no team seat (`effective()` in `iam.mjs`) — so one join is the
   * whole rule. Expired grants are excluded the same way the access path excludes them.
   */
  async seatUsage(orgId, { client = null } = {}) {
    const query = client ?? this.pool;
    const { rows } = await query.query(
      `select count(*)::int as seats
         from (
           select m.user_id
             from org_memberships m
            where m.org_id = $1
              and m.relation = 'member'
              and m.state = 'active'
           union
           select m.user_id
             from org_memberships m
             join board_grants g
               on g.subject_type = 'user' and g.subject_id = m.user_id
             join boards b on b.id = g.board_id
            where m.org_id = $1
              and m.relation = 'guest'
              and b.org_id = $1
              and g.role in ('editor', 'coowner')
              and (g.expires_at is null or g.expires_at > now())
         ) occupied`,
      [orgId],
    );
    return rows[0]?.seats ?? 0;
  },

  /**
   * The `rooms` limit counts active rooms: the trash keeps a room out of it (§2.2).
   *
   * Not `roomCount(orgId)`: the store already exposes `roomCount` as the number of open
   * in-memory rooms, and `server.mjs` publishes it as a metric.
   */
  async activeRoomCount(orgId) {
    const { rows } = await this.pool.query(
      `select count(*)::int as rooms
         from boards
        where org_id = $1 and archived_at is null`,
      [orgId],
    );
    return rows[0]?.rooms ?? 0;
  },

  /** Agent tasks created in the current calendar month, for the Free ceiling (§2.4). */
  async agentTasksThisMonth(orgId) {
    const { rows } = await this.pool.query(
      `select count(*)::int as tasks
         from agent_tasks
        where org_id = $1 and created_at >= date_trunc('month', now())`,
      [orgId],
    );
    return rows[0]?.tasks ?? 0;
  },

  /**
   * Freeze every room beyond the newest `maxRooms`, or thaw all when the plan allows
   * them again (§2.5). Ordering by `updated_at` is what "the last N rooms I worked in"
   * means; the frozen room keeps its content and loses only the right to change it.
   */
  async reconcileFrozenRooms(orgId, maxRooms) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (maxRooms === null || maxRooms === undefined) {
        await client.query(
          "update boards set frozen_at = null where org_id = $1 and frozen_at is not null",
          [orgId],
        );
      } else {
        await client.query(
          `update boards
              set frozen_at = now()
            where org_id = $1
              and archived_at is null
              and frozen_at is null
              and id in (
                select id from boards
                 where org_id = $1 and archived_at is null
                 order by updated_at desc, id desc
                 offset $2
              )`,
          [orgId, maxRooms],
        );
        await client.query(
          `update boards
              set frozen_at = null
            where org_id = $1
              and frozen_at is not null
              and id in (
                select id from boards
                 where org_id = $1 and archived_at is null
                 order by updated_at desc, id desc
                 limit $2
              )`,
          [orgId, maxRooms],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Give an organisation a plan by hand (stage 1: the operator is the only seller).
   * A live subscription is updated in place so `subscriptions_live_idx` stays satisfied.
   */
  async upsertOperatorPlan({
    orgId,
    plan,
    priceId,
    amount,
    currency,
    interval,
    until,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: live } = await client.query(
        `select id from subscriptions
          where org_id = $1
            and status in ('trialing', 'active', 'past_due', 'suspended')
          order by created_at desc
          limit 1
          for update`,
        [orgId],
      );
      let row;
      if (live[0]) {
        ({ rows: [row] } = await client.query(
          `update subscriptions
              set plan = $2, price_id = $3, amount = $4, currency = $5, interval = $6,
                  status = 'active', current_period_start = now(),
                  current_period_end = $7, cancel_at_period_end = false,
                  past_due_since = null, suspended_at = null, canceled_at = null,
                  updated_at = now()
            where id = $1
            returning *`,
          [live[0].id, plan, priceId, amount, currency, interval, until],
        ));
      } else {
        ({ rows: [row] } = await client.query(
          `insert into subscriptions
             (org_id, plan, price_id, amount, currency, interval, status,
              current_period_start, current_period_end)
           values ($1, $2, $3, $4, $5, $6, 'active', now(), $7)
           returning *`,
          [orgId, plan, priceId, amount, currency, interval, until],
        ));
      }
      await client.query("commit");
      return row;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  /** End an operator-granted plan now; the organisation falls back to Free. */
  async endOperatorPlan(orgId) {
    const { rows } = await this.pool.query(
      `update subscriptions
          set status = 'canceled', canceled_at = now(), updated_at = now()
        where org_id = $1
          and status in ('trialing', 'active', 'past_due', 'suspended')
        returning id`,
      [orgId],
    );
    return rows.length > 0;
  },

  /**
   * The price a new checkout may charge (`spec/billing.md` §2.1.2). Promotion-only
   * versions never answer here: they are reachable only through a `price_override` code,
   * so a public sale has exactly one amount per plan, interval and currency.
   */
  async priceForSale({ plan, interval = "month", currency }) {
    const { rows } = await this.pool.query(
      `select * from prices
        where plan = $1 and interval = $2 and currency = $3
          and status = 'for_sale' and not promo_only
        order by version desc
        limit 1`,
      [plan, interval, currency],
    );
    return mapPrice(rows[0]);
  },

  /**
   * A new version of a price, always as a draft. Publishing is a separate act
   * (`publishPrice`) so a half-entered amount never reaches a checkout.
   *
   * The version is optional and defaults to the next free number for the same
   * (plan, interval, currency). `amount` is a whole number of minor units; zero is
   * not stored here because Free has no catalogue row (`spec/billing.md` §2.1).
   */
  async addPrice({
    id,
    plan,
    interval,
    currency,
    amount,
    version,
    status = "draft",
    promoOnly = false,
    createdBy = null,
  }) {
    if (!id) throw new Error("addPrice requires an id");
    if (status !== "draft") {
      throw new Error("addPrice creates drafts; use publishPrice to put a price on sale");
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("amount must be a positive integer in minor units");
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      let next = version;
      if (next === undefined || next === null) {
        const { rows: [row] } = await client.query(
          `select coalesce(max(version), 0) + 1 as version
             from prices
            where plan = $1 and interval = $2 and currency = $3`,
          [plan, interval, currency],
        );
        next = row.version;
      }
      const { rows: [row] } = await client.query(
        `insert into prices
           (id, plan, interval, currency, amount, version, status, promo_only, created_by)
         values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)
         returning *`,
        [id, plan, interval, currency, amount, next, promoOnly, createdBy],
      );
      await client.query(
        `insert into price_events (price_id, type, data)
         values ($1, 'created', $2)`,
        [id, JSON.stringify({ plan, interval, currency, amount, version: next, promoOnly })],
      );
      await client.query("commit");
      return mapPrice(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Put a draft on sale and end the version it replaces (`spec/billing.md` §2.1.2).
   *
   * The old row is updated before the new one: `prices_for_sale_idx` allows one public
   * row per (plan, interval, currency), and a deferred index would only move the race.
   * A promotion-only target leaves the public price alone — promo versions live beside
   * it, not instead of it.
   */
  async publishPrice(id) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: [target] } = await client.query(
        "select * from prices where id = $1 for update",
        [id],
      );
      if (!target) throw new Error(`price ${id} does not exist`);
      if (target.status === "archived") throw new Error(`price ${id} is archived`);
      if (target.status === "for_sale") {
        await client.query("commit");
        return mapPrice(target);
      }

      const ended = [];
      if (!target.promo_only) {
        const { rows } = await client.query(
          `update prices
              set status = 'sale_ended'
            where plan = $1 and interval = $2 and currency = $3
              and status = 'for_sale' and not promo_only and id <> $4
            returning id`,
          [target.plan, target.interval, target.currency, id],
        );
        for (const row of rows) {
          ended.push(row.id);
          await client.query(
            `insert into price_events (price_id, type, data)
             values ($1, 'sale_ended', $2)`,
            [row.id, JSON.stringify({ replacedBy: id })],
          );
        }
      }

      const { rows: [published] } = await client.query(
        "update prices set status = 'for_sale' where id = $1 returning *",
        [id],
      );
      await client.query(
        `insert into price_events (price_id, type, data)
         values ($1, 'published', $2)`,
        [id, JSON.stringify({ replaced: ended })],
      );
      await client.query("commit");
      return mapPrice(published);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  /** Every version the operator has ever entered, newest first within its key. */
  async listPrices({ currency = null } = {}) {
    const { rows } = await this.pool.query(
      `select * from prices
        where ($1::text is null or currency = $1)
        order by currency, plan, interval, version desc`,
      [currency ? String(currency).toUpperCase() : null],
    );
    return rows.map(mapPrice);
  },

  /**
   * Which (currency, plan/interval) pairs have no price for sale (§2.1.1, §2.1.2).
   * A currency that is not sold yet is reported with every pair missing, so the operator
   * sees the whole to-do list rather than the first gap.
   */
  async checkPriceLists(currencies) {
    const wanted = [
      ...new Set(
        (Array.isArray(currencies) ? currencies : [currencies])
          .map((value) => String(value).trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (wanted.length === 0) return [];

    const { rows } = await this.pool.query(
      `select currency, plan, interval
         from prices
        where status = 'for_sale' and not promo_only
          and currency = any($1::text[])`,
      [wanted],
    );
    const available = new Set(rows.map((row) => `${row.currency}|${row.plan}/${row.interval}`));
    return wanted.map((currency) => ({
      currency,
      missing: PAID_PLAN_KEYS.filter((key) => !available.has(`${currency}|${key}`)),
    }));
  },

  /** One price by id; checkout refuses anything that is not `for_sale` (§2.1). */
  async priceById(id) {
    const { rows } = await this.pool.query(
      `select id, plan, interval, currency, amount, version, status, promo_only
         from prices where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** The invoice behind an operator command, without knowing the tenant yet. */
  async billingInvoiceGlobal(invoiceId) {
    const { rows } = await this.pool.query(
      `select id, org_id, number, status, currency, subtotal, discount, credit_applied,
              total, lines, period_start, period_end
         from invoices where id = $1`,
      [invoiceId],
    );
    return rows[0] ?? null;
  },

  /** One payment of this organisation, for the return page after checkout. */
  async billingPayment(orgId, paymentId) {
    const { rows } = await this.pool.query(
      `select id, invoice_id, status, amount, currency, provider_payment_id, failure_code
         from payments where org_id = $1 and id = $2`,
      [orgId, paymentId],
    );
    return rows[0] ?? null;
  },

  /**
   * The owner's explicit choice of active rooms (§2.5). Only rooms of this organisation
   * are accepted; the rest are frozen, so the chosen set is exactly the active one.
   */
  async setFrozenRooms(orgId, boardIds) {
    if (!Array.isArray(boardIds)) throw new TypeError("boardIds must be an array");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: owned } = await client.query(
        "select id from boards where org_id = $1 and id = any($2::text[])",
        [orgId, boardIds],
      );
      if (owned.length !== boardIds.length) {
        throw Object.assign(new Error("a room does not belong to this organisation"), {
          code: "BOARD_NOT_FOUND",
        });
      }
      await client.query(
        `update boards
            set frozen_at = case
              when id = any($2::text[]) then null
              else coalesce(frozen_at, now())
            end
          where org_id = $1 and archived_at is null`,
        [orgId, boardIds],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
};

// The money methods are a separate file because §4 is a separate reason to change, but
// they register here: `postgres.mjs` already mixes in one billing object, and a second
// registration point would make it possible to load plans without the ledger.
Object.assign(billingMethods, billingMoneyMethods);
