/**
 * Entitlements: the one place that answers "what may this organisation do" (ADR-247,
 * `spec/billing.md` §2.2).
 *
 * No route compares plan names. A limit or feature is checked against the object this
 * module returns, so the catalogue is the only place a plan is described and this module
 * is the only place a plan is chosen.
 *
 * With `REMO_BILLING=off` — the default and the AGPL self-host case — nothing is
 * limited and no row is read: the product works exactly as before billing existed.
 */
import { ALL_PAID, PLANS } from "./billing-catalog.mjs";

/** Short enough that an operator grant or a failed renewal is visible, long enough for `/auth/me`. */
const CACHE_TTL_MS = 60_000;

/** orgId → { expiresAt, value }. Cleared by any billing event of that organisation. */
const cache = new Map();

const NO_LIMIT = Object.freeze({
  seats: null,
  rooms: null,
  agentTasksPerMonth: null,
  trashDays: null,
  storageBytes: null,
});

export function billingEnabled(env = process.env) {
  return env.REMO_BILLING === "on";
}

/**
 * The self-host answer. Built per call rather than shared, so a caller that mutates the
 * feature set (it should not) cannot poison the next request.
 */
function unlimited() {
  return {
    plan: "unlimited",
    status: "active",
    limits: { ...NO_LIMIT },
    features: new Set(ALL_PAID),
    reason: "plan",
  };
}

/**
 * The catalogue shape of an entitlement. Only the five limited fields are copied, so an
 * extra catalogue key (`trialDays`) never leaks into the API answer.
 */
function forPlan(planName, status, reason) {
  const plan = PLANS[planName];
  return {
    plan: planName,
    status,
    limits: {
      seats: plan.seats,
      rooms: plan.rooms,
      agentTasksPerMonth: plan.agentTasksPerMonth,
      trashDays: plan.trashDays,
      storageBytes: plan.storageBytes,
    },
    features: new Set(plan.features),
    reason,
  };
}

/** Free whatever the subscription says: the plan is not a thing a personal org can have. */
function free(reason = "plan", status = "active") {
  return forPlan("free", status, reason);
}

/**
 * Resolve the plan from the live subscription.
 *
 * `orgs` and `subscriptions` are tenant tables, so the reads happen inside
 * `withTenant(orgId, …)`. When the request already runs in that tenant the call is a
 * no-op — the same function serves a route and `/auth/me`'s per-organisation loop.
 */
async function resolve(store, orgId) {
  return store.withTenant(orgId, async () => {
    const org = await store.billingOrg(orgId);
    // A personal organisation is always Free: to work as a team you create a shared one.
    if (!org || org.kind === "personal") return free();

    const subscription = await store.liveSubscription(orgId);
    if (!subscription) return free();

    // Suspension keeps the data and the room access, but the plan's limits and features
    // are gone until a payment arrives (§3.1).
    if (subscription.status === "suspended") return free("suspended", "suspended");

    // An unknown name is a data bug, not a paid plan; free is the safe answer.
    const planName = Object.hasOwn(PLANS, subscription.plan) ? subscription.plan : "free";
    if (planName === "free") return free();

    // A failed renewal keeps the plan for the grace period, and the client says why.
    if (subscription.status === "past_due") {
      return forPlan(planName, "past_due", "past_due_grace");
    }
    return forPlan(planName, subscription.status, "plan");
  });
}

/**
 * The entitlements of an organisation. `store` is the Postgres store (or a double with
 * `withTenant`, `billingOrg` and `liveSubscription`); `now` exists so a test can cross
 * the cache window without waiting a minute.
 *
 * The returned object is shared for the cache window: treat it as read-only.
 */
export async function entitlementsFor(
  store,
  orgId,
  { env = process.env, now = Date.now() } = {},
) {
  if (!billingEnabled(env)) return unlimited();

  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await resolve(store, orgId);
  cache.set(orgId, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

/** Any billing event of this organisation makes the next read ask the database again. */
export function invalidateEntitlements(orgId) {
  cache.delete(orgId);
}

/**
 * Drop every cached answer. Tests use it when they switch `REMO_BILLING` on or off in
 * one process; production never needs it because the setting is fixed at start.
 */
export function resetEntitlementCache() {
  cache.clear();
}
