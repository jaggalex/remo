import { DEFAULT_LINE_PRESET, newId, type Widget } from "@remo/model";
import {
  PlanError,
  validatePlan,
  type AgentPlan,
  type PlannedConnector,
  type PlannedObject,
} from "@remo/agent-plan";
import type { BoardDocument } from "./board";
import { LOCAL_ORIGIN } from "./origins";
import { seedTextField } from "./text";

/**
 * Applying an agent's plan: the one place a plan becomes objects (ADR-142).
 *
 * The whole plan is written in **one** transaction with the local origin, so ⌘Z takes
 * the entire structure back in one step. Ids are minted here, at apply time; a plan
 * carries tempIds and is never replayable by itself. Validation and a board preflight
 * run before the transaction, so a refused plan writes nothing.
 */

const ID_PREFIX: Record<string, string> = {
  sticky_note: "sticky",
  text: "text",
  shape: "shape",
  frame: "frame",
};

/** Kinds a line may join; mirrors the shared contract and `WIDGET_KINDS`. */
const CONNECTABLE = new Set(["sticky_note", "text", "shape", "card", "image", "stamp"]);

export interface ApplyAgentPlanOptions {
  /**
   * The person's explicit confirmation. Without it the plan is not applied: preview
   * is the default and a model answer is never auto-applied (ADR-142).
   */
  approved: boolean;
  /** Who is applying the plan; defaults to the document's author (ADR-046). */
  author?: string;
  /** Provenance stamped on every created object, when the plan came from an agent. */
  provenance?: Widget["agent"];
  /** One clock read for the whole plan, so a test or a session can pin it. */
  now?: number;
  /**
   * The selection a tidy plan was built from (ADR-143). A placement outside it is a
   * refusal, so a plan cannot reach an object the person never selected.
   */
  allowedIds?: string[];
}

export interface AppliedAgentPlan {
  /** tempId → created object id, for objects and connectors alike. */
  ids: Record<string, string>;
  objectIds: string[];
  connectorIds: string[];
  /** Existing objects this plan moved. */
  movedIds: string[];
}

function pairKey(from: string, to: string): string {
  return from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
}

/** The board facts the shared validator needs, read once. */
function boardFacts(board: BoardDocument) {
  const existingWidgets: Array<{
    id: string;
    type: string;
    locked?: boolean;
    parentId?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  const existingConnectors: Array<{ from: string; to: string }> = [];
  board.widgets.forEach((widget, key) => {
    existingWidgets.push({
      id: widget.id ?? key,
      type: widget.type,
      locked: widget.locked === true,
      parentId: widget.parentId ?? null,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
    });
    if (widget.type === "connector" && widget.start?.item && widget.end?.item) {
      existingConnectors.push({ from: widget.start.item, to: widget.end.item });
    }
  });
  return { existingWidgets, existingConnectors };
}

/** Board facts a plan may refer to, read once before the transaction. */
function preflight(
  board: BoardDocument,
  plan: AgentPlan,
  idMap: Map<string, string>,
  allowedIds?: string[],
): void {
  const allowed = allowedIds ? new Set(allowedIds) : null;
  for (const object of plan.objects) {
    if (!object.parentRef) continue;
    if (idMap.has(object.parentRef)) continue;
    const parent = board.widgets.get(object.parentRef);
    if (!parent) {
      throw new PlanError("PARENT_NOT_FOUND", `parent "${object.parentRef}" does not exist`);
    }
    if (parent.type !== "frame") {
      throw new PlanError("PARENT_NOT_FRAME", `parent "${object.parentRef}" is not a frame`);
    }
    if (parent.locked) {
      throw new PlanError("PARENT_LOCKED", `parent "${object.parentRef}" is locked`);
    }
  }

  for (const placement of plan.placements ?? []) {
    if (allowed && !allowed.has(placement.id)) {
      throw new PlanError(
        "OBJECT_NOT_ALLOWED",
        `object "${placement.id}" is not in the selection this plan was built from`,
      );
    }
    const widget = board.widgets.get(placement.id);
    if (!widget) {
      throw new PlanError(
        "OBJECT_NOT_FOUND",
        `object "${placement.id}" does not exist on this board`,
      );
    }
    if (widget.type === "frame" || widget.type === "connector") {
      throw new PlanError(
        "OBJECT_NOT_PLACED",
        `"${placement.id}" cannot be moved by a tidy plan`,
      );
    }
    if (!placement.parentRef) continue;
    if (idMap.has(placement.parentRef)) continue;
    const parent = board.widgets.get(placement.parentRef);
    if (!parent) {
      throw new PlanError("PARENT_NOT_FOUND", `parent "${placement.parentRef}" does not exist`);
    }
    if (parent.type !== "frame") {
      throw new PlanError("PARENT_NOT_FRAME", `parent "${placement.parentRef}" is not a frame`);
    }
    if (parent.locked) {
      throw new PlanError("PARENT_LOCKED", `parent "${placement.parentRef}" is locked`);
    }
  }

  if (!plan.connectors.length) return;
  const planned = new Map(plan.objects.map((object) => [object.tempId, object]));
  const taken = new Set<string>();
  board.widgets.forEach((widget) => {
    if (widget.type !== "connector") return;
    const from = widget.start?.item;
    const to = widget.end?.item;
    if (from && to) taken.add(pairKey(from, to));
  });

  const endpoint = (ref: string): void => {
    const object = planned.get(ref);
    if (object) {
      // A planned object is not on the board yet; its kind is the contract's.
      if (!CONNECTABLE.has(object.type)) {
        throw new PlanError("CONNECTOR_TARGET_INVALID", `"${ref}" cannot be an endpoint of a line`);
      }
      return;
    }
    const widget = board.widgets.get(ref);
    if (!widget) {
      throw new PlanError("CONNECTOR_TARGET_MISSING", `connector target "${ref}" does not exist`);
    }
    if (!CONNECTABLE.has(widget.type)) {
      throw new PlanError("CONNECTOR_TARGET_INVALID", `"${ref}" cannot be an endpoint of a line`);
    }
    if (widget.locked) {
      throw new PlanError("CONNECTOR_TARGET_LOCKED", `"${ref}" is locked`);
    }
  };

  for (const connector of plan.connectors) {
    endpoint(connector.from);
    endpoint(connector.to);
    // Two planned objects cannot already own a line; the pair check protects a plan
    // that joins objects already on the board.
    if (planned.has(connector.from) || planned.has(connector.to)) continue;
    const key = pairKey(connector.from, connector.to);
    if (taken.has(key)) {
      throw new PlanError("CONNECTOR_EXISTS", "these objects already have a connector");
    }
    taken.add(key);
  }
}

function plannedWidget(
  object: PlannedObject,
  id: string,
  parentId: string | null,
  author: string | null,
  provenance: Widget["agent"] | undefined,
  createdAt: number,
): Widget {
  return {
    id,
    type: object.type,
    parentId,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    ...(object.shapeKind ? { shapeKind: object.shapeKind } : {}),
    ...(object.title ? { title: object.title } : {}),
    ...(object.text ? { content: object.text } : {}),
    ...(object.style ? { style: { ...object.style } } : {}),
    ...(author ? { createdBy: author } : {}),
    createdAt,
    ...(provenance ? { agent: { ...provenance } } : {}),
  };
}

function plannedConnector(
  connector: PlannedConnector,
  id: string,
  from: Widget,
  to: Widget,
  author: string | null,
  provenance: Widget["agent"] | undefined,
  createdAt: number,
): Widget {
  return {
    id,
    type: "connector",
    parentId: null,
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
    start: { item: from.id },
    end: { item: to.id },
    // A line between shapes reads as a flow; between notes it is a link without a head.
    arrow: connector.arrow ?? (from.type === "shape" || to.type === "shape" ? "end" : "none"),
    // Elbow by default, the same choice a hand-drawn line makes (ADR-030).
    routing: connector.routing ?? "elbow",
    style: {
      // The line Plain preset, so a planned line rings its own sample (ADR-129).
      strokeColor: connector.style?.strokeColor ?? DEFAULT_LINE_PRESET.color,
      strokeWidth: connector.style?.strokeWidth ?? DEFAULT_LINE_PRESET.width,
      ...(connector.style?.strokeStyle ? { strokeStyle: connector.style.strokeStyle } : {}),
    },
    ...(author ? { createdBy: author } : {}),
    createdAt,
    ...(provenance ? { agent: { ...provenance } } : {}),
  };
}

/**
 * Apply a plan to the document as one undoable gesture.
 *
 * `validatePlan` is the shared client/server contract; `preflight` checks every ref the
 * plan leaves outside itself. Both run before the transaction: a plan that cannot be
 * applied in full is refused in full, never half-written.
 */
export function applyAgentPlan(
  board: BoardDocument,
  plan: AgentPlan,
  options: ApplyAgentPlanOptions,
): AppliedAgentPlan {
  if (options?.approved !== true) {
    throw new PlanError(
      "NOT_APPROVED",
      "a plan is applied only after a person confirms it",
    );
  }
  const facts = boardFacts(board);
  const checked = validatePlan(plan, {
    existingWidgets: facts.existingWidgets,
    existingConnectors: facts.existingConnectors,
    ...(options.allowedIds ? { allowedIds: options.allowedIds } : {}),
  });
  const author = options.author ?? (board.author || null);

  const idMap = new Map<string, string>();
  for (const object of checked.objects) {
    const prefix = ID_PREFIX[object.type] ?? "obj";
    let id = newId(prefix);
    while (board.widgets.has(id)) id = newId(prefix);
    idMap.set(object.tempId, id);
  }
  const connectorIds = new Map<string, string>();
  for (const [index, connector] of checked.connectors.entries()) {
    const tempId = connector.tempId ?? `tmp_conn_${index + 1}`;
    let id = newId("conn");
    while (board.widgets.has(id)) id = newId("conn");
    connectorIds.set(tempId, id);
  }

  preflight(board, checked, idMap, options.allowedIds);

  const createdAt = options.now ?? Date.now();
  const objectIds: string[] = [];
  const createdConnectors: string[] = [];
  const movedIds: string[] = [];
  const ids: Record<string, string> = {};

  board.transact(() => {
    for (const object of checked.objects) {
      const id = idMap.get(object.tempId)!;
      const parentId = object.parentRef ? (idMap.get(object.parentRef) ?? object.parentRef) : null;
      const widget = plannedWidget(
        object,
        id,
        parentId,
        author,
        options.provenance,
        createdAt,
      );
      board.widgets.set(id, widget);
      // The text map is the editable copy; the field stays for readers that do not
      // materialise text (templates and exports do the same, ADR-016).
      seedTextField(board, widget, object.text ?? object.title ?? "");
      objectIds.push(id);
      ids[object.tempId] = id;
    }

    // Existing objects move after the frames exist, so a placement can name a frame
    // created by this plan. Only x/y and membership change: sizes, texts and lines are
    // untouched (ADR-143), which also makes one ⌘Z enough for the whole arrangement.
    for (const placement of checked.placements ?? []) {
      const current = board.widgets.get(placement.id);
      if (!current || current.locked) continue;
      const parentId = placement.parentRef
        ? (idMap.get(placement.parentRef) ?? placement.parentRef)
        : current.parentId;
      const next: Widget = { ...current, x: placement.x, y: placement.y };
      if (parentId !== current.parentId) next.parentId = parentId;
      board.widgets.set(current.id, next);
      movedIds.push(current.id);
    }

    for (const [index, connector] of checked.connectors.entries()) {
      const tempId = connector.tempId ?? `tmp_conn_${index + 1}`;
      const id = connectorIds.get(tempId)!;
      const fromId = idMap.get(connector.from) ?? connector.from;
      const toId = idMap.get(connector.to) ?? connector.to;
      const from = board.widgets.get(fromId)!;
      const to = board.widgets.get(toId)!;
      board.widgets.set(
        id,
        plannedConnector(connector, id, from, to, author, options.provenance, createdAt),
      );
      createdConnectors.push(id);
      ids[tempId] = id;
    }
  }, LOCAL_ORIGIN);

  return { ids, objectIds, connectorIds: createdConnectors, movedIds };
}
