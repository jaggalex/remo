import { PLAN_LIMITS, countsOf } from "./limits.mjs";
import { planBounds } from "./layout.mjs";

const MAX_WARNINGS = 100;

/**
 * The identity of a finding, independent of its wording.
 *
 * A plan carries the warnings of the pass that produced it; estimating that plan again
 * must not turn one finding into two rows. The server stores a plan and its estimate,
 * and the apply path re-validates the plan — both would otherwise re-report the same
 * `PLAN_OUT_OF_BOUNDS` or overlap (ADR-142, M3).
 */
function warningKey(warning) {
  if (!warning || typeof warning !== "object") return String(warning);
  const tempIds = Array.isArray(warning.tempIds)
    ? warning.tempIds.map(String).sort().join(",")
    : "";
  return [
    warning.code ?? "",
    warning.tempId ?? "",
    tempIds,
    warning.column ?? "",
  ].join("|");
}

function collectWarnings(incoming) {
  const warnings = [];
  const seen = new Set();
  const add = (warning) => {
    const key = warningKey(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    warnings.push(warning);
    return true;
  };
  for (const warning of incoming) add(warning);
  return { warnings, add };
}

function parentMap(objects) {
  const parents = new Map();
  for (const object of objects) {
    if (object.parentRef) parents.set(object.tempId, object.parentRef);
  }
  return parents;
}

/** Is `ancestorId` above `id` in the plan's parent chain? Guards malformed plans too. */
function isAncestor(parents, ancestorId, id) {
  const seen = new Set();
  let current = parents.get(id);
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parents.get(current);
  }
  return false;
}

function overlaps(a, b) {
  const width =
    Math.min(a.x + a.width / 2, b.x + b.width / 2) -
    Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const height =
    Math.min(a.y + a.height / 2, b.y + b.height / 2) -
    Math.max(a.y - a.height / 2, b.y - b.height / 2);
  return width > 0.5 && height > 0.5;
}

function outOfBounds(object) {
  const limit = PLAN_LIMITS.coordinate;
  return (
    Math.abs(object.x) > limit ||
    Math.abs(object.y) > limit ||
    Math.abs(object.x - object.width / 2) > limit ||
    Math.abs(object.x + object.width / 2) > limit ||
    Math.abs(object.y - object.height / 2) > limit ||
    Math.abs(object.y + object.height / 2) > limit
  );
}

/**
 * Dry run: what the plan would create, where it would land, and what looks wrong.
 *
 * Read-only and pure. Overlap is a warning, not a refusal: an agent may deliberately
 * place a label on a shape, and the person approving the plan is the one who decides.
 * A plan close to the ceiling also warns, so a large request is split before it is
 * applied rather than failing halfway (ADR-142).
 */
export function estimatePlan(plan) {
  const objects = Array.isArray(plan?.objects) ? plan.objects : [];
  const connectors = Array.isArray(plan?.connectors) ? plan.connectors : [];
  const placements = Array.isArray(plan?.placements) ? plan.placements : [];
  const counts = countsOf(objects, connectors, placements);
  // A plan may already carry bounds that include placed objects: their geometry is on
  // the board, not in the plan, so recomputing from created objects alone would make a
  // tidy plan look smaller than it is (ADR-143).
  const bounds =
    plan?.bounds &&
    Number.isFinite(Number(plan.bounds.width)) &&
    Number.isFinite(Number(plan.bounds.height))
      ? {
          x: Number(plan.bounds.x) || 0,
          y: Number(plan.bounds.y) || 0,
          width: Number(plan.bounds.width),
          height: Number(plan.bounds.height),
        }
      : planBounds(objects);
  const incoming = Array.isArray(plan?.warnings) ? plan.warnings : [];
  const { warnings, add } = collectWarnings(incoming);

  if (counts.objects > PLAN_LIMITS.warnObjects) {
    add({
      code: "PLAN_LARGE",
      message: `${counts.objects} objects is close to the ${PLAN_LIMITS.objects}-object ceiling`,
    });
  }
  for (const object of objects) {
    if (outOfBounds(object)) {
      add({
        code: "PLAN_OUT_OF_BOUNDS",
        message: `object ${object.tempId} is outside ±${PLAN_LIMITS.coordinate}`,
        tempId: object.tempId,
      });
    }
  }

  const parents = parentMap(objects);
  for (let first = 0; first < objects.length; first += 1) {
    for (let second = first + 1; second < objects.length; second += 1) {
      const a = objects[first];
      const b = objects[second];
      // A frame and its child share a rectangle by design; nesting is not a collision.
      if (isAncestor(parents, a.tempId, b.tempId) || isAncestor(parents, b.tempId, a.tempId)) {
        continue;
      }
      if (!overlaps(a, b)) continue;
      add({
        code: "OVERLAP",
        message: `${a.tempId} overlaps ${b.tempId}`,
        tempIds: [a.tempId, b.tempId],
      });
      if (warnings.length >= MAX_WARNINGS) break;
    }
    if (warnings.length >= MAX_WARNINGS) break;
  }
  if (warnings.length >= MAX_WARNINGS) {
    add({
      code: "WARNINGS_TRUNCATED",
      message: `warnings were truncated at ${MAX_WARNINGS}`,
    });
  }

  return {
    ...counts,
    bounds,
    width: bounds.width,
    height: bounds.height,
    warnings,
  };
}
