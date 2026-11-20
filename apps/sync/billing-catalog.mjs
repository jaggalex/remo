/**
 * What a plan gives (ADR-247, `spec/billing.md` §2.1).
 *
 * The catalogue has two halves on purpose. Seats, limits and features are product
 * behaviour, so they live in code and change through a pull request. What a plan costs
 * is a commercial decision and lives in the `prices` table, which the operator edits
 * without a release. This file therefore never contains an amount.
 *
 * Limits are `null` for "no limit", not zero or a large number: every check reads the
 * value and treats `null` as unlimited, so a plan upgrade is one catalogue line.
 */

/** The closed feature list (`spec/billing.md` §2.2). A plan names only these. */
export const FEATURES = Object.freeze([
  "export.pdf",
  "export.no_watermark",
  "link.protect",
  "roles.advanced",
  "integrations",
  "agents.unlimited",
]);

/** Every paid plan opens every feature; only the limits differ. */
export const ALL_PAID = Object.freeze([...FEATURES]);

/**
 * `unlimited` is not here: it is the self-host answer of `entitlementsFor` when billing
 * is off, and it is never sold (`spec/billing.md` §2.2).
 */
export const PLANS = Object.freeze({
  free: Object.freeze({
    seats: 5,
    rooms: 5,
    agentTasksPerMonth: 10,
    trashDays: 7,
    storageBytes: null,
    features: Object.freeze([]),
  }),
  pro: Object.freeze({
    seats: 5,
    rooms: null,
    agentTasksPerMonth: null,
    trashDays: 90,
    storageBytes: null,
    trialDays: 0,
    features: ALL_PAID,
  }),
  team: Object.freeze({
    seats: 20,
    rooms: null,
    agentTasksPerMonth: null,
    trashDays: 90,
    storageBytes: null,
    trialDays: 14,
    features: ALL_PAID,
  }),
  business: Object.freeze({
    seats: 50,
    rooms: null,
    agentTasksPerMonth: null,
    trashDays: 90,
    storageBytes: null,
    trialDays: 14,
    features: ALL_PAID,
  }),
});

/** Sellable plans, cheapest first. `unlimited` is deliberately absent. */
export const PLAN_NAMES = Object.freeze(["free", "pro", "team", "business"]);
