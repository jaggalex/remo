/**
 * Subscription lifecycle and the saved payment method over HTTP (ADR-247 §3.2, §3.4;
 * `spec/billing.md` §6).
 *
 * Four routes, all `org_admin` actions (§3.2): cancel and resume move one flag on the live
 * subscription, `DELETE payment-method` detaches the card and stops renewal, and
 * `POST payment-method` refuses honestly until the provider widget exists. The period is
 * never recalculated here — a subscription that ends with its period keeps the end it has.
 *
 * The session and the organisation membership are resolved by the caller
 * (`billing-catalog-api.mjs`): a stranger already received `404` before this module runs.
 */
import { fail, json } from "./iam-http.mjs";

/** The owner-or-admin rule of §3.2: a member reads the plan, an admin changes it. */
async function adminOnly(store, orgId, userId, response, action) {
  if (await store.hasOrgRole(orgId, userId, "org_admin")) return true;
  fail(response, 403, "FORBIDDEN", `only the owner or an organisation admin can ${action}`);
  return false;
}

/** `POST …/billing/cancel` — the subscription runs out its paid period, then ends. */
async function cancel({ response, store, orgId, session }) {
  if (!(await adminOnly(store, orgId, session.user.id, response, "cancel the subscription"))) {
    return true;
  }
  const subscription = await store.cancelAtPeriodEnd(orgId);
  if (!subscription) {
    fail(response, 409, "NO_SUBSCRIPTION", "this organisation has no live subscription");
    return true;
  }
  json(response, 200, {
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: subscription.current_period_end,
  });
  return true;
}

/** `POST …/billing/resume` — take the cancellation back while the period still runs. */
async function resume({ response, store, orgId, session }) {
  if (!(await adminOnly(store, orgId, session.user.id, response, "resume the subscription"))) {
    return true;
  }
  const subscription = await store.resumeSubscription(orgId);
  if (!subscription) {
    fail(response, 409, "NO_SUBSCRIPTION", "this organisation has no live subscription");
    return true;
  }
  json(response, 200, { cancelAtPeriodEnd: subscription.cancel_at_period_end });
  return true;
}

/**
 * `DELETE …/billing/payment-method` — detach the card and turn autopay off. The store does
 * both in one transaction, so a revocation cannot leave a renewing subscription behind
 * (§13.5). A method that is already gone is `404`, not a silent success.
 */
async function detachPaymentMethod({ response, store, orgId, session }) {
  if (!(await adminOnly(store, orgId, session.user.id, response, "detach the payment method"))) {
    return true;
  }
  const result = await store.revokePaymentMethod(orgId);
  if (result.revoked === 0) {
    return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no saved payment method"), true;
  }
  json(response, 200, { ok: true });
  return true;
}

/**
 * `POST …/billing/payment-method` — replacing a card needs the provider's widget, which is
 * not shipped. `501` says so instead of accepting a request that would store nothing
 * (§6, `spec/payment-providers.md` §4).
 */
async function replacePaymentMethod({ response, store, orgId, session }) {
  if (!(await adminOnly(store, orgId, session.user.id, response, "replace the payment method"))) {
    return true;
  }
  return fail(
    response,
    501,
    "NOT_IMPLEMENTED",
    "замена карты появится вместе с виджетом провайдера",
  ), true;
}

/** Routes under `/orgs/:id/billing/…`; the caller has already resolved the organisation. */
export async function handleSubscriptionRoutes({ request, response, store, orgId, rest, session }) {
  const method = request.method ?? "GET";
  const known = rest === "cancel" || rest === "resume" || rest === "payment-method";
  if (!known) return false;
  if (
    typeof store.cancelAtPeriodEnd !== "function" ||
    typeof store.revokePaymentMethod !== "function"
  ) {
    fail(response, 501, "BILLING_UNAVAILABLE", "the subscription routes need the postgres store");
    return true;
  }

  if (rest === "cancel") {
    if (method !== "POST") return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST"), true;
    return cancel({ response, store, orgId, session });
  }
  if (rest === "resume") {
    if (method !== "POST") return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST"), true;
    return resume({ response, store, orgId, session });
  }
  if (rest !== "payment-method") return false;

  if (method === "DELETE") return detachPaymentMethod({ response, store, orgId, session });
  if (method === "POST") return replacePaymentMethod({ response, store, orgId, session });
  return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST or DELETE"), true;
}
