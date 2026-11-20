/**
 * Where a plan is applied (ADR-247, `spec/billing.md` §2.4).
 *
 * A route asks a named question — "is there room for one more room, seat or task?" — and
 * gets either `null` or a problem object. The two response helpers below turn that object
 * into the one 402 shape of §2.4. `entitlementsFor` is called only here, so no route ever
 * compares plan names and the catalogue stays the only place a plan is described.
 *
 * With `REMO_BILLING=off` every answer is "allowed": `entitlementsFor` returns the
 * `unlimited` entitlement without reading a row, and a null limit never refuses.
 */
import { entitlementsFor } from "./billing.mjs";

/** A wording for the client when it has no translation for the limit code. */
const LIMIT_MESSAGES = {
  rooms: (plan, max) => `the ${plan} plan allows ${max} active rooms`,
  seats: (plan, max) => `the ${plan} plan allows ${max} seats`,
  agentTasksPerMonth: (plan, max) => `the ${plan} plan allows ${max} agent tasks per month`,
};

/** The problem shape of §2.4, or null while the ceiling still has room. */
function overLimit(entitlements, limit, current) {
  const max = entitlements.limits[limit];
  // `null` is "no limit", not zero: every paid catalogue line and the self-host answer.
  if (max === null || max === undefined) return null;
  if (current < max) return null;
  return { limit, current, max, plan: entitlements.plan };
}

/** Is there room for one more active room (not in the trash)? */
export async function roomLimit(store, orgId) {
  const entitlements = await entitlementsFor(store, orgId);
  if (entitlements.limits.rooms === null) return null;
  // The count is a database trip, so it is skipped on a plan that does not limit rooms.
  const current = await store.activeRoomCount(orgId);
  return overLimit(entitlements, "rooms", current);
}

/**
 * Is there room for `adding` more seats (§2.3)? An invitation adds one; a guest promoted
 * to editor also adds one, because that is the moment they start occupying a seat.
 */
export async function seatLimit(store, orgId, { adding = 1 } = {}) {
  const entitlements = await entitlementsFor(store, orgId);
  const max = entitlements.limits.seats;
  if (max === null) return null;
  const current = await store.seatUsage(orgId);
  if (current + adding <= max) return null;
  return { limit: "seats", current, max, plan: entitlements.plan };
}

/**
 * Is there room for one more agent task this month?
 *
 * `agents.unlimited` is the priced way to lift the ceiling, so it is checked before the
 * counter: a plan that carries the feature does not even read `agent_tasks`.
 * `entitlements` is for a caller that already holds the answer (and for a test of a plan
 * shape the price list does not sell); production resolves it here.
 */
export async function agentTaskLimit(store, orgId, { entitlements = null } = {}) {
  const plan = entitlements ?? (await entitlementsFor(store, orgId));
  if (plan.features.has("agents.unlimited")) return null;
  if (plan.limits.agentTasksPerMonth === null) return null;
  const current = await store.agentTasksThisMonth(orgId);
  return overLimit(plan, "agentTasksPerMonth", current);
}

/** Does the plan open this feature? The `unlimited` self-host plan opens every one. */
export async function featureLimit(store, orgId, feature) {
  const entitlements = await entitlementsFor(store, orgId);
  if (entitlements.plan === "unlimited" || entitlements.features.has(feature)) return null;
  return { feature, plan: entitlements.plan };
}

function answer(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

/** The 402 of §2.4 for a limit. `fail()` cannot carry the counters. */
export function planLimitResponse(response, problem) {
  const message =
    LIMIT_MESSAGES[problem.limit]?.(problem.plan, problem.max) ??
    `the ${problem.plan} plan does not allow this`;
  answer(response, 402, {
    error: "PLAN_LIMIT",
    limit: problem.limit,
    current: problem.current,
    max: problem.max,
    plan: problem.plan,
    message,
  });
}

/** The 402 of §2.4 for a feature the plan does not include. */
export function planFeatureResponse(response, problem) {
  answer(response, 402, { error: "PLAN_FEATURE", feature: problem.feature, plan: problem.plan });
}

/* ------------------------------------------------------------- accepting -- */

/**
 * The rows §2.3 counts as a seat. The rule must stay the same as `store.seatUsage`; it is
 * written out again here because the accept path has to run it on its own transaction
 * client, and a store method would take a second connection and miss the lock's order.
 */
const SEAT_ROWS = `select m.user_id
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
     and (g.expires_at is null or g.expires_at > now())`;


/** Does this person already hold a seat? Asked only at the boundary, to let them keep it. */
async function occupiesSeat(query, orgId, userId) {
  const { rows } = await query.query(
    `select 1 from (${SEAT_ROWS}) occupied where occupied.user_id = $2 limit 1`,
    [orgId, userId],
  );
  return rows.length > 0;
}

/**
 * The seat verdict for accepting an invitation, inside the accepting transaction.
 *
 * The caller locks the `orgs` row and then calls this on the same client, so two
 * acceptances arriving together are counted one after the other instead of both seeing
 * the last free seat. A person who already holds a seat (an existing member, or a guest
 * who is already an editor here) may keep it: acceptance must not turn a free re-invite
 * into a refusal, and the count is reported as it is.
 */
export async function seatLimitInTransaction(store, client, orgId, { userId } = {}) {
  const entitlements = await entitlementsFor(store, orgId);
  const max = entitlements.limits.seats;
  if (max === null) return null;
  // The same rule as `store.seatUsage`, on the accepting transaction's client.
  const current = await store.seatUsage(orgId, { client });
  if (current < max) return null;
  if (userId && (await occupiesSeat(client, orgId, userId))) return null;
  return { limit: "seats", current, max, plan: entitlements.plan };
}
