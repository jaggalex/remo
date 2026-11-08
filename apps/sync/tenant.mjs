/**
 * The tenant a request is allowed to see (ADR-178).
 *
 * Row-level security reads `app.org_id` from the session. A request acquires one
 * connection, sets the value once, and every store call in that request uses that
 * connection; the value is reset before the connection goes back to the pool. The
 * context is an `AsyncLocalStorage`, so two concurrent requests with different
 * organisations cannot see each other even though they share the pool.
 *
 * The setting is session-level (`set_config(..., false)`), not transaction-local: a
 * store method may open its own transaction on the same connection (many do), and a
 * `SET LOCAL` would be gone before its first query. The price is an explicit reset in
 * `finally`; a connection whose reset fails is destroyed rather than reused.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

/** `{ orgId, client }` for the request in flight, or null on a global path. */
export function currentTenant() {
  return storage.getStore() ?? null;
}

/** The request's connection, for the store's pool shim. */
export function currentTenantClient() {
  return storage.getStore()?.client ?? null;
}

/**
 * Run `fn` with no tenant context, even if the caller has one.
 *
 * Background work started from a request (a queued agent task, a scheduled tick) must
 * not inherit the request's connection: the response ends and releases it while the
 * work is still running. The detached call takes its own context.
 */
export function withoutTenant(fn) {
  return storage.exit(fn);
}

/** A UUID is the only shape an org id can have; a typo is a bug, not a wildcard. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` with `orgId` in scope. A missing org is a global path (auth, health, the
 * guide): it runs without a tenant setting and therefore sees no tenant rows once
 * policies are on.
 */
export async function withTenant(pool, orgId, fn) {
  const existing = currentTenant();
  if (existing) {
    // A nested request must not widen or switch the tenant. Same org is fine: the
    // store may call a helper that asks for the context again.
    if (orgId && existing.orgId !== orgId) {
      throw new Error("tenant context switched inside one request");
    }
    return fn();
  }
  if (!orgId) return fn();
  if (!UUID.test(String(orgId))) {
    throw new Error(`invalid organisation id: ${String(orgId).slice(0, 64)}`);
  }

  const client = await pool.connect();
  let set = false;
  try {
    await client.query("select set_config('app.org_id', $1, false)", [orgId]);
    set = true;
    return await storage.run({ orgId, client }, fn);
  } finally {
    if (set) {
      try {
        await client.query("reset app.org_id");
        client.release();
      } catch {
        // Never put a connection with an unknown setting back into the pool.
        client.release(true);
      }
    } else {
      client.release(true);
    }
  }
}
