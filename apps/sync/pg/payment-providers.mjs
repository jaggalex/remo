/**
 * Payment connections and instance operators (ADR-248, `spec/payment-providers.md` §2–§3).
 *
 * Both tables are installation-level and live outside tenant RLS: an organisation never
 * brings its own shop, so none of these reads needs `withTenant`. The one tenant table
 * this module touches is `subscriptions`, and only from the operator CLI through
 * `withOwnerClient` — RLS would otherwise report "no live subscription" and let the
 * operator disable a connection that still renews paying customers.
 *
 * Secrets never leave this module in plain text: the caller seals them with
 * `encryptSecret` and passes the ready envelope as `sealed`. Every read returns the
 * fingerprint and a `has_secret` flag, never the ciphertext columns or the webhook token
 * (the token is only in `connectionById`, for the operator CLI's `webhook-url`).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { fakeProviderEnabled } from "../pay-fake.mjs";

/** Closed lists, mirrored by the check constraints in `schema.sql`. */
export const PROVIDERS = Object.freeze([
  "manual",
  "yookassa",
  "robokassa",
  "cloudpayments",
  "prodamus",
  "paddle",
  "fake",
]);
export const MODES = Object.freeze(["test", "live"]);
export const CONNECTION_STATUSES = Object.freeze([
  "draft",
  "ready",
  "active",
  "paused",
  "retiring",
  "disabled",
]);
export const METHOD_GROUPS = Object.freeze([
  "ru_card",
  "foreign_card",
  "invoice",
  "global_card",
]);

/**
 * The lifecycle of `spec/payment-providers.md` §2.
 *
 * `draft → active` is allowed on purpose: a provider with nothing to verify (manual)
 * has no meaningful `ready` step, and pretending otherwise would make `--activate` a
 * two-command ritual. Disabling is allowed from any working state; the CLI refuses it
 * while live subscriptions remain, but that rule belongs to the operator command, not
 * to a connection that must always be possible to switch off in an incident.
 */
const TRANSITIONS = Object.freeze({
  draft: Object.freeze(["ready", "active", "disabled"]),
  ready: Object.freeze(["draft", "active", "disabled"]),
  active: Object.freeze(["paused", "retiring", "disabled"]),
  paused: Object.freeze(["active", "retiring", "disabled"]),
  retiring: Object.freeze(["disabled"]),
  disabled: Object.freeze([]),
});

export function canTransition(from, to) {
  return from === to || Boolean(TRANSITIONS[from]?.includes(to));
}

function connectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function currenciesOf(value) {
  return [...new Set(list(value).map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
}

function methodGroupsOf(value) {
  return [...new Set(list(value).map((item) => String(item).trim()).filter(Boolean))];
}

/**
 * One connection as the operator and the catalogue see it. `has_secret` and
 * `secret_fingerprint` are the only traces of the sealed envelope; the webhook token is
 * omitted unless the caller explicitly asks (the `webhook-url` command).
 */
export function mapConnection(row, { withToken = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    mode: row.mode,
    status: row.status,
    currencies: row.currencies ?? [],
    methodGroups: row.method_groups ?? [],
    priority: row.priority,
    settings: row.settings ?? {},
    has_secret: Boolean(row.has_secret ?? row.ciphertext),
    secret_fingerprint: row.fingerprint ?? null,
    ...(withToken ? { webhookToken: row.webhook_token } : {}),
    verifiedAt: row.verified_at ?? null,
    lastHealthAt: row.last_health_at ?? null,
    lastHealthError: row.last_health_error ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** The columns every read shares; deliberately not `ciphertext`, `nonce`, … */
const PUBLIC_COLUMNS = `id, provider, name, mode, status, currencies, method_groups, priority,
  settings, ciphertext is not null as has_secret, fingerprint, verified_at, last_health_at,
  last_health_error, created_by, created_at, updated_at`;

/**
 * Route candidates, as one predicate. `routesFor` applies the same rule in SQL; this
 * function is what the unit tests pin down and what a future in-memory adapter can reuse.
 */
export function routeMatches(connection, { methodGroup, currency, testMode }) {
  const mode = testMode ? "test" : "live";
  if (connection.status !== "active") return false;
  if (connection.mode !== mode) return false;
  if (!list(connection.currencies).includes(currency)) return false;
  return list(connection.methodGroups ?? connection.method_groups).includes(methodGroup);
}

export const paymentProviderMethods = {
  /** Every connection, priority first, without the sealed columns or the webhook token. */
  async listConnections() {
    const { rows } = await this.pool.query(
      `select ${PUBLIC_COLUMNS}
         from payment_connections
        order by priority asc, created_at asc`,
    );
    return rows.map((row) => mapConnection(row));
  },

  /**
   * One connection with what only the runtime may see: the webhook token and the sealed
   * envelope. Never serialise this object into a response; `createCheckout`/the webhook
   * open the secret and pass it to an adapter.
   */
  async connectionById(id) {
    const { rows } = await this.pool.query(
      `select ${PUBLIC_COLUMNS}, webhook_token, ciphertext, nonce,
              dek_wrapped, dek_nonce, kek_id
         from payment_connections
        where id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...mapConnection(row, { withToken: true }),
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      dek_wrapped: row.dek_wrapped,
      dek_nonce: row.dek_nonce,
      kek_id: row.kek_id,
    };
  },

  /**
   * One provider event into the inbox, at most once. A webhook may be delivered twice and
   * a repeated key is a no-op, not an error (§5).
   */
  async recordProviderEvent({
    connectionId,
    providerEventKey,
    type,
    orgId = null,
    payload = {},
  }) {
    const { rows } = await this.pool.query(
      `insert into billing_provider_events
         (connection_id, provider_event_key, type, org_id, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (connection_id, provider_event_key) do nothing
       returning id`,
      [connectionId, providerEventKey, type, orgId, JSON.stringify(payload)],
    );
    return rows.length > 0;
  },

  /**
   * A connection is created in `draft` and recorded with one event. The id may be passed
   * explicitly because the caller must know it before sealing: the AAD binds the
   * ciphertext to this row, so `encryptSecret` cannot run before the id exists.
   */
  async createConnection({
    id,
    provider,
    name,
    mode,
    currencies,
    methodGroups,
    priority = 100,
    settings = {},
    sealed = null,
    webhookToken = null,
    createdBy = null,
  }) {
    if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider ${provider}`);
    // A fake connection is a development object: creating one in a production database
    // would leave a route that the runtime can never load, so the refusal belongs here.
    if (provider === "fake" && !fakeProviderEnabled()) {
      throw new Error(
        "the fake payment provider is available only outside production with REMO_PAY_FAKE=1",
      );
    }
    if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
    const trimmedName = String(name ?? "").trim();
    if (!trimmedName) throw new Error("a connection needs a name");
    const codes = currenciesOf(currencies);
    if (codes.length === 0) throw new Error("a connection needs at least one currency");
    const groups = methodGroupsOf(methodGroups);
    if (groups.length === 0 || groups.some((group) => !METHOD_GROUPS.includes(group))) {
      throw new Error(`method groups must be among ${METHOD_GROUPS.join(", ")}`);
    }
    if (!Number.isInteger(priority) || priority < 0) {
      throw new Error("priority must be a non-negative integer");
    }

    const connectionId = id ?? sealed?.id ?? randomUUID();
    // 24 random bytes make a guessed token impossible; the URL is not a secret store,
    // the token only proves the caller knows this particular connection.
    const token = webhookToken ?? randomBytes(24).toString("hex");

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: [row] } = await client.query(
        `insert into payment_connections
           (id, provider, name, mode, status, currencies, method_groups, priority, settings,
            ciphertext, nonce, dek_wrapped, dek_nonce, kek_id, fingerprint, webhook_token,
            created_by)
         values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8::jsonb,
                 $9, $10, $11, $12, $13, $14, $15, $16)
         returning ${PUBLIC_COLUMNS}`,
        [
          connectionId,
          provider,
          trimmedName,
          mode,
          codes,
          groups,
          priority,
          JSON.stringify(settings ?? {}),
          sealed?.ciphertext ?? null,
          sealed?.nonce ?? null,
          sealed?.dekWrapped ?? null,
          sealed?.dekNonce ?? null,
          sealed?.kekId ?? null,
          sealed?.fingerprint ?? null,
          token,
          createdBy,
        ],
      );
      await client.query(
        `insert into payment_connection_events (connection_id, type, to_status, reason, actor_id)
         values ($1, 'created', 'draft', $2, $3)`,
        [connectionId, `provider ${provider}, mode ${mode}`, createdBy],
      );
      await client.query("commit");
      return mapConnection(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Non-secret configuration only. A changed currency or method group is a routing
   * change, so it is recorded like any other configuration edit.
   */
  async updateConnectionSettings(
    id,
    { priority, settings, currencies, methodGroups, actorId = null, reason = null } = {},
  ) {
    const codes = currencies === undefined ? null : currenciesOf(currencies);
    if (codes !== null && codes.length === 0) {
      throw new Error("a connection needs at least one currency");
    }
    const groups = methodGroups === undefined ? null : methodGroupsOf(methodGroups);
    if (groups !== null && (groups.length === 0 || groups.some((g) => !METHOD_GROUPS.includes(g)))) {
      throw new Error(`method groups must be among ${METHOD_GROUPS.join(", ")}`);
    }
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) {
      throw new Error("priority must be a non-negative integer");
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: [row] } = await client.query(
        `update payment_connections
            set priority = coalesce($2, priority),
                settings = coalesce($3::jsonb, settings),
                currencies = coalesce($4::text[], currencies),
                method_groups = coalesce($5::text[], method_groups),
                updated_at = now()
          where id = $1
          returning ${PUBLIC_COLUMNS}`,
        [
          id,
          priority ?? null,
          settings === undefined ? null : JSON.stringify(settings ?? {}),
          codes,
          groups,
        ],
      );
      if (!row) {
        await client.query("rollback");
        throw connectionError("CONNECTION_NOT_FOUND", `connection ${id} does not exist`);
      }
      await client.query(
        `insert into payment_connection_events (connection_id, type, reason, actor_id)
         values ($1, 'config_changed', $2, $3)`,
        [id, reason, actorId],
      );
      await client.query("commit");
      return mapConnection(row);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Replace the sealed envelope and keep only the new fingerprint. The plaintext never
   * enters this method: the caller has already encrypted it with the same AAD.
   */
  async rotateConnectionSecret(id, sealed, { reason = null, actorId = null } = {}) {
    if (!sealed?.ciphertext || !sealed?.nonce || !sealed?.dekWrapped || !sealed?.dekNonce) {
      throw new Error("rotateConnectionSecret needs a complete sealed envelope");
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: [row] } = await client.query(
        `update payment_connections
            set ciphertext = $2, nonce = $3, dek_wrapped = $4, dek_nonce = $5,
                kek_id = $6, fingerprint = $7, updated_at = now()
          where id = $1
          returning ${PUBLIC_COLUMNS}`,
        [
          id,
          sealed.ciphertext,
          sealed.nonce,
          sealed.dekWrapped,
          sealed.dekNonce,
          sealed.kekId,
          sealed.fingerprint ?? null,
        ],
      );
      if (!row) {
        await client.query("rollback");
        throw connectionError("CONNECTION_NOT_FOUND", `connection ${id} does not exist`);
      }
      await client.query(
        `insert into payment_connection_events (connection_id, type, reason, actor_id)
         values ($1, 'secret_rotated', $2, $3)`,
        [id, reason, actorId],
      );
      await client.query("commit");
      return mapConnection(row);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * One transition, with the expected `from` as an optimistic lock: two operators must
   * not both pause and resume the same connection and end up with the last writer's
   * story in the journal. Repeating the same target status is a no-op, so a retried CLI
   * command does not add a duplicate event.
   */
  async setConnectionStatus(id, { from, to, reason = null, actorId = null }) {
    if (!CONNECTION_STATUSES.includes(to)) throw new Error(`unknown status ${to}`);
    if (!canTransition(from, to)) {
      throw connectionError(
        "CONNECTION_TRANSITION_NOT_ALLOWED",
        `a connection cannot go from ${from} to ${to}`,
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: [current] } = await client.query(
        "select status from payment_connections where id = $1 for update",
        [id],
      );
      if (!current) {
        await client.query("rollback");
        throw connectionError("CONNECTION_NOT_FOUND", `connection ${id} does not exist`);
      }
      if (current.status === to) {
        const { rows: [row] } = await client.query(
          `select ${PUBLIC_COLUMNS} from payment_connections where id = $1`,
          [id],
        );
        await client.query("commit");
        return mapConnection(row);
      }
      if (current.status !== from) {
        await client.query("rollback");
        throw connectionError(
          "CONNECTION_STATUS_CONFLICT",
          `connection ${id} is ${current.status}, not ${from}`,
        );
      }
      const { rows: [row] } = await client.query(
        `update payment_connections
            set status = $2, updated_at = now()
          where id = $1
          returning ${PUBLIC_COLUMNS}`,
        [id, to],
      );
      await client.query(
        `insert into payment_connection_events
           (connection_id, type, from_status, to_status, reason, actor_id)
         values ($1, 'status_changed', $2, $3, $4, $5)`,
        [id, from, to, reason, actorId],
      );
      await client.query("commit");
      return mapConnection(row);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** A health probe is a fact about the connection, not a lifecycle event. */
  async setConnectionHealth(id, { ok, error = null } = {}) {
    const { rowCount } = await this.pool.query(
      `update payment_connections
          set last_health_at = now(), last_health_error = $2, updated_at = now()
        where id = $1`,
      [id, ok ? null : (error ?? "health check failed")],
    );
    return rowCount > 0;
  },

  /**
   * Active connections that can charge this method group in this currency and mode,
   * best priority first (§3.3). Step 3 of the spec — "no route → 422" — is the caller's
   * decision: the catalogue asks the same question to decide what to show.
   */
  async routesFor({ methodGroup, currency, testMode = false }) {
    if (!METHOD_GROUPS.includes(methodGroup)) return [];
    const code = String(currency ?? "").trim().toUpperCase();
    if (!code) return [];
    const { rows } = await this.pool.query(
      `select ${PUBLIC_COLUMNS}
         from payment_connections
        where status = 'active'
          and mode = $3
          and $2 = any(currencies)
          and $1 = any(method_groups)
        order by priority asc, created_at asc`,
      [methodGroup, code, testMode ? "test" : "live"],
    );
    return rows.map((row) => mapConnection(row));
  },

  /**
   * The methods the catalogue may offer for one currency, ordered by the best priority
   * that can serve them. A group with no active connection is absent, which is exactly
   * the "currency narrows the providers" rule of ADR-247.
   */
  async methodGroupsFor({ currency, testMode = false }) {
    const code = String(currency ?? "").trim().toUpperCase();
    if (!code) return [];
    const { rows } = await this.pool.query(
      `select g as method_group, min(priority) as priority
         from payment_connections, unnest(method_groups) as g
        where status = 'active'
          and mode = $2
          and $1 = any(currencies)
        group by g
        order by min(priority) asc, g asc`,
      [code, testMode ? "test" : "live"],
    );
    return rows.map((row) => row.method_group);
  },

  /** The global operator role (`spec/payment-providers.md` §6.1). */
  async isInstanceOperator(userId) {
    const { rows } = await this.pool.query(
      "select 1 from instance_operators where user_id = $1",
      [userId],
    );
    return rows.length > 0;
  },

  /**
   * Grant the role by email, because the command is run from a shell and the operator
   * knows the address, not the uuid. Re-granting is idempotent and keeps the original
   * `granted_at`: the journal should show when the role first appeared.
   */
  async grantInstanceOperator({ email, grantedBy = null }) {
    const address = String(email ?? "").trim().toLowerCase();
    if (!address) throw new Error("--email is required");
    const { rows: [user] } = await this.pool.query(
      "select id, email from users where lower(email) = $1",
      [address],
    );
    if (!user) throw new Error(`no account with the address ${address}`);
    const { rows: [row] } = await this.pool.query(
      `insert into instance_operators (user_id, granted_by)
       values ($1, $2)
       on conflict (user_id) do update set granted_by = excluded.granted_by
       returning user_id, granted_at, granted_by`,
      [user.id, grantedBy],
    );
    return { userId: row.user_id, email: user.email, grantedAt: row.granted_at, grantedBy: row.granted_by };
  },

  /**
   * Live subscriptions still renewed through this connection. `subscriptions` is a tenant
   * table, so an installation-level read has to run as the owner; otherwise RLS answers
   * "none" and the CLI disables a connection that still has paying customers.
   */
  async liveSubscriptionsForConnection(connectionId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select id, org_id, plan, status, current_period_end
           from subscriptions
          where connection_id = $1
            and status in ('trialing', 'active', 'past_due', 'suspended')
          order by created_at asc`,
        [connectionId],
      );
      return rows;
    });
  },
};
