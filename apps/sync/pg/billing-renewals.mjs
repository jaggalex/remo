/**
 * Storage for renewals and saved payment methods (ADR-247 §2.5, §3.3; ADR-248 §4;
 * `spec/billing.md` §3.3, §5).
 *
 * These methods exist for a job that runs outside every request, so the tenant rule is
 * spelled out per method instead of assumed:
 *
 * - `dueSubscriptions` spans organisations and therefore uses the owner connection. It is
 *   a plain select, not `for update skip locked`: the lock would end with the transaction
 *   that took it, long before the charge, so it would protect nothing. Two ticks are
 *   harmless instead — the invoice is unique by `(subscription_id, period_start)`, the
 *   charge is keyed by `invoice:{id}:attempt:{n}` and the loop is single-flight.
 * - Everything that reads or writes one organisation's rows runs inside `withTenant`, so
 *   the same methods keep working once RLS is forced on the application role (ADR-178).
 * - A row found by id first resolves its organisation over the owner connection; that is
 *   the one cross-tenant read a background tick needs to enter the tenant afterwards.
 *
 * The saved method's provider reference is sealed with the same envelope as every other
 * provider secret and is never returned in the clear: `paymentMethod` returns display
 * fields plus the envelope, and `openPaymentMethodRef` unseals it only for `chargeSaved`.
 */
import { randomUUID } from "node:crypto";
import { periodEnd as endOfPeriod } from "../billing-money.mjs";
import { encryptSecret, kekFromEnv } from "../secrets.mjs";

/** A live subscription is the only one that can renew or hold a saved method. */
const LIVE_STATUSES = Object.freeze(["trialing", "active", "past_due", "suspended"]);

/** The display fields a screen may show; card numbers never reach us (ADR-247 rule 9). */
const DISPLAY_KINDS = Object.freeze(["card", "sbp", "wallet"]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function batchSize(limit) {
  if (limit === undefined || limit === null) return 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError("limit must be an integer between 1 and 200");
  }
  return limit;
}

function amountOf(value, name = "amount") {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer in minor units`);
  }
  return amount;
}

/**
 * Only the four display facts, copied one by one. A provider object with extra keys must
 * never land in `payment_methods.display`, because that column is read by the client and
 * grows without review otherwise.
 */
function displayOf(display) {
  if (!display || typeof display !== "object") {
    throw new TypeError("a saved payment method needs display fields");
  }
  const result = {
    kind: DISPLAY_KINDS.includes(display.kind) ? display.kind : "card",
  };
  if (typeof display.brand === "string" && display.brand.trim() !== "") {
    result.brand = display.brand.trim().slice(0, 32);
  }
  if (typeof display.last4 === "string" && /^[0-9]{2,4}$/.test(display.last4)) {
    result.last4 = display.last4;
  }
  const month = Number(display.expMonth);
  if (Number.isInteger(month) && month >= 1 && month <= 12) result.expMonth = month;
  const year = Number(display.expYear);
  if (Number.isInteger(year) && year >= 2000 && year <= 2999) result.expYear = year;
  return result;
}

/** The organisation of a subscription, read without a tenant so a tick can enter one. */
async function subscriptionOrg(store, subscriptionId) {
  const row = await store.withOwnerClient(async (client) => {
    const { rows } = await client.query("select org_id from subscriptions where id = $1", [
      subscriptionId,
    ]);
    return rows[0] ?? null;
  });
  return row?.org_id ?? null;
}

function mapInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    credit_applied: Number(row.credit_applied),
    total: Number(row.total),
  };
}

function mapSubscription(row) {
  return row ? { ...row, amount: Number(row.amount) } : null;
}

/**
 * One subscription's status change in its own tenant, with one event.
 *
 * `apply` returns the `set` clause or `null` for "already in the target state", which is
 * what makes every caller idempotent without a separate existence check. The helper stays
 * module-level: it is the shape of a transition, not another store method a route could
 * call with its own set clause.
 */
async function transition(store, id, { allowed, type, apply, data }) {
  const orgId = await subscriptionOrg(store, id);
  if (!orgId) return null;

  return store.withTenant(orgId, async () => {
    const client = await store.pool.connect();
    try {
      await client.query("begin");
      const { rows: [current] } = await client.query(
        "select * from subscriptions where id = $1 for update",
        [id],
      );
      if (!current) {
        await client.query("commit");
        return null;
      }
      if (!allowed.includes(current.status)) {
        await client.query("commit");
        return mapSubscription(current);
      }
      const set = apply(current);
      if (!set) {
        await client.query("commit");
        return mapSubscription(current);
      }
      const { rows: [row] } = await client.query(
        `update subscriptions set ${set} where id = $1 returning *`,
        [id],
      );
      await client.query(
        `insert into billing_events (org_id, type, subject_id, data)
         values ($1, $2, $3, $4::jsonb)`,
        [orgId, type, id, JSON.stringify(data(current))],
      );
      await client.query("commit");
      return mapSubscription(row);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

/**
 * The one live subscription of an organisation with `cancel_at_period_end` set to
 * `enabled`, and its event. `null` means there is nothing to change: the route turns that
 * into `409 NO_SUBSCRIPTION` rather than inventing a subscription.
 */
async function setPeriodEndFlag(store, orgId, enabled, type) {
  return store.withTenant(orgId, async () => {
    const client = await store.pool.connect();
    try {
      await client.query("begin");
      const { rows: [current] } = await client.query(
        `select * from subscriptions
          where org_id = $1 and status = any($2::text[])
          order by created_at desc
          limit 1
          for update`,
        [orgId, LIVE_STATUSES],
      );
      if (!current) {
        await client.query("commit");
        return null;
      }
      if (current.cancel_at_period_end === enabled) {
        await client.query("commit");
        return mapSubscription(current);
      }
      const { rows: [row] } = await client.query(
        `update subscriptions
            set cancel_at_period_end = $2, updated_at = now()
          where id = $1
          returning *`,
        [current.id, enabled],
      );
      await client.query(
        `insert into billing_events (org_id, type, subject_id, data)
         values ($1, $2, $3, $4::jsonb)`,
        [orgId, type, current.id, JSON.stringify({ currentPeriodEnd: row.current_period_end })],
      );
      await client.query("commit");
      return mapSubscription(row);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

export const billingRenewalMethods = {
  /**
   * Active subscriptions whose period has ended, plus every past-due one (a failed
   * renewal keeps being retried until the grace period ends).
   */
  async dueSubscriptions({ limit = 50 } = {}) {
    const size = batchSize(limit);
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select *
           from subscriptions
          where status in ('active', 'past_due')
            and (status = 'past_due' or current_period_end <= now())
          order by current_period_end asc, created_at asc
          limit $1`,
        [size],
      );
      return rows.map(mapSubscription);
    });
  },

  /**
   * The invoice for the next period, created once per `(subscription_id, period_start)`.
   *
   * `createInvoice` owns the number allocation and the same idempotency pair, so a second
   * tick after a crash returns the existing document instead of issuing another number.
   * The organisation credit of §3.3 step 3 is not applied here: the renewal charges the
   * subscription amount and an operator moves credit by hand until the credit stage lands.
   */
  async renewalInvoice(subscription) {
    const orgId = subscription?.org_id ?? subscription?.orgId;
    if (!orgId) throw new TypeError("a subscription needs its organisation");
    const start = subscription.current_period_end ?? subscription.currentPeriodEnd;
    if (!start) throw new TypeError("a subscription needs the end of its current period");
    const amount = amountOf(subscription.amount);
    const next = endOfPeriod(start, subscription.interval);

    return this.withTenant(orgId, async () => {
      const { invoice } = await this.createInvoice({
        orgId,
        subscriptionId: subscription.id,
        currency: subscription.currency,
        lines: [
          {
            kind: "subscription",
            plan: subscription.plan,
            interval: subscription.interval,
            priceId: subscription.price_id ?? subscription.priceId ?? null,
            amount,
            renewal: true,
          },
        ],
        subtotal: amount,
        discount: 0,
        creditApplied: 0,
        total: amount,
        periodStart: start,
        periodEnd: next,
        dueAt: start,
      });
      return invoice;
    });
  },

  /** The open invoice a retry charges; the oldest one so a stray duplicate cannot win. */
  async openInvoiceFor(subscriptionId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select *
           from invoices
          where subscription_id = $1 and status = 'open'
          order by period_start asc nulls last, created_at asc
          limit 1`,
        [subscriptionId],
      );
      return mapInvoice(rows[0]);
    });
  },

  /**
   * Move the paid period forward and clear the grace state.
   *
   * `past_due_since = null` is also what resets the retry counter: `renewalAttempts`
   * counts failures since that instant, so the counter does not need its own column.
   * A repeated call with the same target is a no-op, so the webhook and the loop may both
   * settle one payment without shortening the period to zero.
   */
  async advanceSubscription({ id, periodEnd }) {
    if (!id) throw new TypeError("advanceSubscription needs a subscription id");
    if (!periodEnd) throw new TypeError("advanceSubscription needs the next period end");
    const orgId = await subscriptionOrg(this, id);
    if (!orgId) return null;

    return this.withTenant(orgId, async () => {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const { rows: [current] } = await client.query(
          "select * from subscriptions where id = $1 for update",
          [id],
        );
        if (!current) {
          await client.query("commit");
          return null;
        }
        if (
          current.status === "active" &&
          new Date(current.current_period_end).getTime() >= new Date(periodEnd).getTime()
        ) {
          await client.query("commit");
          return mapSubscription(current);
        }
        const start = current.current_period_end;
        const { rows: [row] } = await client.query(
          `update subscriptions
              set current_period_start = current_period_end,
                  current_period_end = $2,
                  status = 'active',
                  past_due_since = null,
                  suspended_at = null,
                  canceled_at = null,
                  updated_at = now()
            where id = $1
            returning *`,
          [id, periodEnd],
        );
        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, 'subscription.renewed', $2, $3::jsonb)`,
          [
            orgId,
            id,
            JSON.stringify({
              periodStart: start,
              periodEnd: row.current_period_end,
              amount: Number(current.amount),
              currency: current.currency,
            }),
          ],
        );
        await client.query("commit");
        return mapSubscription(row);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
  },

  /**
   * A charge failed: keep the plan during the seven-day grace and record when it started.
   * Repeating the call keeps the first `past_due_since` and writes no second event.
   */
  async markPastDue(id) {
    return transition(this, id, {
      allowed: ["active", "trialing", "past_due"],
      type: "subscription.past_due",
      apply: (current) =>
        current.status === "past_due"
          ? null
          : `status = 'past_due',
             past_due_since = coalesce(past_due_since, now()),
             updated_at = now()`,
      data: () => ({}),
    });
  },

  /** The grace period is over: the plan is gone, the data stays (§3.1). */
  async suspendSubscription(id) {
    return transition(this, id, {
      allowed: ["active", "past_due"],
      type: "subscription.suspended",
      apply: () => `status = 'suspended', suspended_at = now(), updated_at = now()`,
      data: () => ({}),
    });
  },

  /**
   * Renewal off, or back on, without touching the period (§3.4). The flag is the whole
   * state: the renewal loop already skips a subscription that carries it, and the
   * subscription stays live until `current_period_end`. Repeating the call is a no-op and
   * writes no second event, so a double click cannot double the journal.
   */
  async cancelAtPeriodEnd(orgId) {
    if (!orgId) throw new TypeError("cancelAtPeriodEnd needs an organisation");
    return setPeriodEndFlag(this, orgId, true, "subscription.canceled_at_period_end");
  },

  /** "Resume" before the period ends is the same flag cleared, and nothing else. */
  async resumeSubscription(orgId) {
    if (!orgId) throw new TypeError("resumeSubscription needs an organisation");
    return setPeriodEndFlag(this, orgId, false, "subscription.resumed");
  },

  /**
   * The subscription ends now (cancel at period end, a full refund, or the end of a
   * suspended month). Repeated calls keep the first `canceled_at`.
   */
  async cancelSubscription(id) {
    return transition(this, id, {
      allowed: ["trialing", "active", "past_due", "suspended"],
      type: "subscription.canceled",
      apply: () => `status = 'canceled', canceled_at = now(), updated_at = now()`,
      data: () => ({}),
    });
  },

  /**
   * One subscription's status change in its own tenant, with one event.
   *
   * `apply` returns the `set` clause or `null` for "already in the target state", which is
   * what makes every caller idempotent without a separate existence check.
   */
  async transitionSubscription(id, { allowed, type, apply, data }) {
    const orgId = await subscriptionOrg(this, id);
    if (!orgId) return null;

    return this.withTenant(orgId, async () => {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const { rows: [current] } = await client.query(
          "select * from subscriptions where id = $1 for update",
          [id],
        );
        if (!current) {
          await client.query("commit");
          return null;
        }
        if (!allowed.includes(current.status)) {
          await client.query("commit");
          return mapSubscription(current);
        }
        const set = apply(current);
        if (!set) {
          await client.query("commit");
          return mapSubscription(current);
        }
        const { rows: [row] } = await client.query(
          `update subscriptions set ${set} where id = $1 returning *`,
          [id],
        );
        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, $2, $3, $4::jsonb)`,
          [orgId, type, id, JSON.stringify(data(current))],
        );
        await client.query("commit");
        return mapSubscription(row);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
  },

  /**
   * Count failed retries of the current grace period.
   *
   * There is no attempts column on purpose: the number is derived from `renewal.failed`
   * events since `past_due_since`, so the journal stays the one source of truth and a
   * successful payment resets the counter by clearing the timestamp. Events from an older
   * grace period are older than the current `past_due_since` and are not counted.
   */
  async renewalAttempts(subscriptionId) {
    const orgId = await subscriptionOrg(this, subscriptionId);
    if (!orgId) return 0;

    return this.withTenant(orgId, async () => {
      const { rows: [current] } = await this.pool.query(
        "select past_due_since from subscriptions where id = $1",
        [subscriptionId],
      );
      if (!current?.past_due_since) return 0;
      const { rows } = await this.pool.query(
        `select count(*)::int as attempts
           from billing_events
          where subject_id = $1
            and type = 'renewal.failed'
            and occurred_at >= $2`,
        [subscriptionId, current.past_due_since],
      );
      return rows[0]?.attempts ?? 0;
    });
  },

  /** Record one failed retry; the count itself is `renewalAttempts`. */
  async bumpRenewalAttempts(id) {
    const orgId = await subscriptionOrg(this, id);
    if (!orgId) throw codedError("SUBSCRIPTION_NOT_FOUND", "subscription does not exist");

    await this.withTenant(orgId, () =>
      this.pool.query(
        `insert into billing_events (org_id, type, subject_id, data)
         values ($1, 'renewal.failed', $2, '{}'::jsonb)`,
        [orgId, id],
      ),
    );
    return this.renewalAttempts(id);
  },

  /**
   * Store the provider's reference to a method the payer saved at the checkout.
   *
   * The id is generated before sealing because it is part of the AAD: ciphertext copied to
   * another row cannot be decrypted. One organisation has one autopay method, so a new
   * save revokes the previous active row locally; the provider keeps its copy until it
   * expires, and a revocation at the provider is an operator action.
   */
  async savePaymentMethod({
    orgId,
    connectionId,
    ref,
    display,
    consentVersion,
    createdBy = null,
    kek = undefined,
    id = null,
  }) {
    if (!orgId) throw new TypeError("savePaymentMethod needs an organisation");
    if (typeof connectionId !== "string" || connectionId === "") {
      throw new TypeError("savePaymentMethod needs the connection that saved the method");
    }
    if (typeof ref !== "string" || ref.trim() === "") {
      throw new TypeError("savePaymentMethod needs the provider reference");
    }
    if (typeof consentVersion !== "string" || consentVersion.trim() === "") {
      throw new TypeError("autopay consent needs the version of the accepted text");
    }
    const methodId = id ?? randomUUID();
    const safeDisplay = displayOf(display);
    const sealed = encryptSecret(JSON.stringify({ methodRef: ref }), {
      scope: "payment_method",
      scopeId: methodId,
      provider: "payment",
      id: methodId,
      kek: kek ?? kekFromEnv(),
    });

    return this.withTenant(orgId, async () => {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `update payment_methods
              set state = 'revoked', revoked_at = now()
            where org_id = $1 and state = 'active'`,
          [orgId],
        );
        await client.query(
          `insert into payment_methods
             (id, org_id, connection_id, ref_ciphertext, ref_nonce, ref_dek_wrapped,
              ref_dek_nonce, ref_kek_id, display, autopay_consent_at, autopay_consent_version,
              created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), $10, $11)`,
          [
            methodId,
            orgId,
            connectionId,
            sealed.ciphertext,
            sealed.nonce,
            sealed.dekWrapped,
            sealed.dekNonce,
            sealed.kekId,
            JSON.stringify(safeDisplay),
            consentVersion,
            createdBy,
          ],
        );
        const { rows: [linked] } = await client.query(
          `update subscriptions
              set payment_method_id = $2, connection_id = $3, updated_at = now()
            where org_id = $1 and status = any($4::text[])
            returning id`,
          [orgId, methodId, connectionId, LIVE_STATUSES],
        );
        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, 'payment_method.saved', $2, $3::jsonb)`,
          [
            orgId,
            methodId,
            JSON.stringify({
              connectionId,
              kind: safeDisplay.kind,
              brand: safeDisplay.brand ?? null,
              last4: safeDisplay.last4 ?? null,
              subscriptionId: linked?.id ?? null,
            }),
          ],
        );
        await client.query("commit");
        return {
          id: methodId,
          connectionId,
          display: safeDisplay,
          consentVersion,
          subscriptionId: linked?.id ?? null,
        };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
  },

  /**
   * The autopay method of an organisation, with what `chargeSaved` needs: display fields
   * for the screen and the sealed envelope for the adapter. The reference itself never
   * leaves this method in the clear.
   */
  async paymentMethod(orgId) {
    if (!orgId) throw new TypeError("paymentMethod needs an organisation");
    return this.withTenant(orgId, async () => {
      const { rows } = await this.pool.query(
        `select id, connection_id, display, autopay_consent_at, autopay_consent_version,
                ref_ciphertext, ref_nonce, ref_dek_wrapped, ref_dek_nonce, ref_kek_id
           from payment_methods
          where org_id = $1 and state = 'active'
          order by created_at desc, id desc
          limit 1`,
        [orgId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        connectionId: row.connection_id,
        display: row.display,
        consentAt: row.autopay_consent_at,
        consentVersion: row.autopay_consent_version,
        sealed: {
          scope: "payment_method",
          scope_id: row.id,
          provider: "payment",
          id: row.id,
          ciphertext: row.ref_ciphertext,
          nonce: row.ref_nonce,
          dek_wrapped: row.ref_dek_wrapped,
          dek_nonce: row.ref_dek_nonce,
          kek_id: row.ref_kek_id,
        },
      };
    });
  },

  /**
   * Turn autopay off in one action; the subscription keeps running until its period end
   * and does not renew (§13.5). The card, the link and the flag move in one transaction:
   * a card gone without the flag would still renew, and a flag without the card would
   * promise a renewal that cannot be charged.
   */
  async revokePaymentMethod(orgId) {
    if (!orgId) throw new TypeError("revokePaymentMethod needs an organisation");
    return this.withTenant(orgId, async () => {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query(
          `update payment_methods
              set state = 'revoked', revoked_at = now()
            where org_id = $1 and state = 'active'
            returning id`,
          [orgId],
        );
        if (rows.length === 0) {
          await client.query("commit");
          return { revoked: 0 };
        }
        const ids = rows.map((row) => row.id);
        await client.query(
          `update subscriptions
              set payment_method_id = null, updated_at = now()
            where org_id = $1 and payment_method_id = any($2::uuid[])`,
          [orgId, ids],
        );
        // No saved method means no renewal: the period stays as it is, the flag stops the
        // charge. A subscription already flagged needs no second event.
        const { rows: stopped } = await client.query(
          `update subscriptions
              set cancel_at_period_end = true, updated_at = now()
            where org_id = $1 and status = any($2::text[]) and not cancel_at_period_end
            returning id, current_period_end`,
          [orgId, LIVE_STATUSES],
        );
        if (stopped[0]) {
          await client.query(
            `insert into billing_events (org_id, type, subject_id, data)
             values ($1, 'subscription.canceled_at_period_end', $2, $3::jsonb)`,
            [
              orgId,
              stopped[0].id,
              JSON.stringify({ currentPeriodEnd: stopped[0].current_period_end }),
            ],
          );
        }
        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, 'payment_method.revoked', $2, $3::jsonb)`,
          [orgId, ids[0], JSON.stringify({ methods: ids.length })],
        );
        await client.query("commit");
        return { revoked: ids.length };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
  },

  /** One subscription by id, for a webhook that has no organisation in the URL. */
  async subscriptionById(id) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query("select * from subscriptions where id = $1", [id]);
      return mapSubscription(rows[0]);
    });
  },

  /**
   * Payment → invoice → subscription → organisation for a provider callback that carries
   * our `paymentId`. The invoice lines are included because they hold the consent version
   * recorded at checkout, which is what `savePaymentMethod` must store with the method.
   */
  async paymentChainFor(paymentId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select p.id as payment_id, p.org_id, p.invoice_id, p.status as payment_status,
                p.connection_id, p.amount as payment_amount, p.currency as payment_currency,
                i.subscription_id, i.currency as invoice_currency, i.lines, i.period_end
           from payments p
           join invoices i on i.id = p.invoice_id
          where p.id = $1`,
        [paymentId],
      );
      return rows[0] ?? null;
    });
  },
};
