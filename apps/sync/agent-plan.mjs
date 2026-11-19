/**
 * Server-side validation and dry run of an agent authoring plan (ADR-142).
 *
 * The server owns the board facts — which ids exist, which parents are frames, which
 * connectors are already there — and the shared planner owns the rules. Nothing here
 * writes an object: in M1 the client applies the plan in one local transaction, so ⌘Z
 * takes the whole plan back.
 */
import { PlanError, estimatePlan, planFromOperations } from "@remo/agent-plan";

/** The document facts the planner needs, in the shape it expects. */
export function boardPlanFacts(ydoc) {
  const existingWidgets = [];
  const existingConnectors = [];
  const widgets = ydoc.getMap("widgets");
  widgets.forEach((widget, key) => {
    const id = String(widget?.id ?? key);
    const type = String(widget?.type ?? "");
    existingWidgets.push({
      id,
      type,
      locked: widget?.locked === true,
      parentId: widget?.parentId ? String(widget.parentId) : null,
      x: Number(widget?.x) || 0,
      y: Number(widget?.y) || 0,
      width: Number(widget?.width) || 0,
      height: Number(widget?.height) || 0,
    });
    if (type === "connector" && widget?.start?.item && widget?.end?.item) {
      existingConnectors.push({ from: String(widget.start.item), to: String(widget.end.item) });
    }
  });
  return { existingWidgets, existingConnectors };
}

/**
 * Validate operations against the live board and return the plan plus its estimate.
 *
 * `maxActions` is the task budget's action ceiling; a plan over it is refused before
 * anybody approves it. `allowedIds` is a tidy selection: a placement outside it is a
 * refusal, so a plan cannot touch an object the person did not select (ADR-143).
 * Callers map `PlanError.code` to a 422 with the same code, as the change-set route
 * already does (ADR-068).
 */
export function validateAgentPlan({
  ydoc,
  operations,
  origin = { x: 0, y: 0 },
  maxActions = null,
  allowedIds = null,
  allowPlacements = true,
}) {
  if (!ydoc || typeof ydoc.getMap !== "function") {
    throw new PlanError("NO_DOCUMENT", "the board document is not open");
  }
  const facts = boardPlanFacts(ydoc);
  const plan = planFromOperations(operations, {
    origin,
    existingWidgets: facts.existingWidgets,
    existingConnectors: facts.existingConnectors,
    ...(Array.isArray(allowedIds) ? { allowedIds } : {}),
    allowPlacements,
  });
  const estimate = estimatePlan(plan);
  if (maxActions !== null && maxActions !== undefined) {
    const limit = Number(maxActions);
    if (!Number.isFinite(limit)) {
      throw new PlanError("BAD_BUDGET", "maxActions must be a number");
    }
    if (estimate.actions > limit) {
      throw new PlanError(
        "BUDGET_ACTIONS",
        `the task allows ${limit} changes but the plan needs ${estimate.actions}`,
      );
    }
  }
  return { plan, estimate };
}
