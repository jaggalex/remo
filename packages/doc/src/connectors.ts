import {
  canConnect,
  DEFAULT_LINE_PRESET,
  newId,
  rigidWaypoints,
  routingOf,
  withRouting,
  MAX_WAYPOINTS,
  type ConnectorRouting,
  type ConnectorShape,
  type ConnectorSide,
  type ConnectorWaypoint,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Connectors: creation, routing, waypoints and the questions asked about them.
 *
 * A connector stores its two endpoints and (optionally) rigid waypoints; the path is
 * derived by the canvas package on every paint, which is why moving an object cannot
 * leave a stale line behind. Automatic points are geometry, not document state
 * (ADR-077).
 */

/** How an old-style setting value maps to the new routing. */
export function routingFromShape(shape: ConnectorShape): ConnectorRouting {
  return shape === "elbowed" ? "elbow" : shape;
}

/**
 * Join two objects with a connector.
 *
 * Only the endpoints and rigid waypoints are stored; the line is derived when it is
 * drawn. Connecting two shapes gives an arrow, matching the diagramming path.
 */
export interface ConnectorOptions {
  /** New routing. `shape` remains for settings/old callers and is mapped. */
  routing?: ConnectorRouting;
  shape?: ConnectorShape;
  arrow?: "none" | "end" | "both" | "start";
  startSide?: ConnectorSide;
  endSide?: ConnectorSide;
  strokeColor?: string;
  strokeStyle?: "normal" | "dashed" | "dotted";
  strokeWidth?: number;
}

export function createConnector(
  board: BoardDocument,
  id: string,
  fromId: string,
  toId: string,
  options: ConnectorOptions = {},
): string | null {
  // ADR-077: a self-loop is rejected in v1.
  if (fromId === toId) return null;
  let created: string | null = null;

  board.transact(() => {
    const from = board.widgets.get(fromId);
    const to = board.widgets.get(toId);
    if (!from || !to) return;
    if (!canConnect(from) || !canConnect(to)) return;
    // A connector between two objects that already have one is noise.
    for (const widget of board.widgets.values()) {
      if (widget.type !== "connector") continue;
      const pair = [widget.start?.item, widget.end?.item];
      if (pair.includes(fromId) && pair.includes(toId)) return;
    }

    const arrow =
      options.arrow ?? (from.type === "shape" || to.type === "shape" ? "end" : "none");
    board.widgets.set(id, {
      id,
      type: "connector",
      parentId: null,
      // Midpoint of the two ends; the real line is derived from the endpoints.
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
      start: {
        item: fromId,
        ...(options.startSide ? { side: options.startSide } : {}),
      },
      end: {
        item: toId,
        ...(options.endSide ? { side: options.endSide } : {}),
      },
      arrow,
      // Elbow by default: a diagram line that turns reads as a route rather than as a
      // line that happens to touch two boxes (ADR-030).
      routing: options.routing ?? (options.shape ? routingFromShape(options.shape) : "elbow"),
      style: {
        // The line Plain preset: a new line rings its own sample on the first open,
        // and no swatch-less hex is written (ADR-129).
        strokeColor: options.strokeColor ?? DEFAULT_LINE_PRESET.color,
        strokeWidth: options.strokeWidth ?? DEFAULT_LINE_PRESET.width,
        ...(options.strokeStyle ? { strokeStyle: options.strokeStyle } : {}),
      },
    });
    created = id;
  });

  return created;
}

/* ------------------------------------------------- connector properties --- */

export interface ConnectorPatch {
  routing?: ConnectorRouting;
  /** Legacy settings value; mapped to `routing` and never written as-is. */
  connectorShape?: ConnectorShape;
  arrow?: "none" | "end" | "both" | "start";
  strokeColor?: string;
  strokeStyle?: "normal" | "dashed" | "dotted";
  strokeWidth?: number;
  /** Where the label sits along the line, and how far off it. */
  labelAt?: { t?: number; offset?: number };
}

/** Change how a connector looks. One transaction, so one undo step. */
export function setConnectorProps(
  board: BoardDocument,
  ids: readonly string[],
  patch: ConnectorPatch,
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "connector") continue;
      if (widget.locked) continue;
      let next: Widget = { ...widget, style: { ...widget.style } };
      if (patch.routing !== undefined) next = withRouting(next, patch.routing);
      else if (patch.connectorShape !== undefined) next = withRouting(next, routingFromShape(patch.connectorShape));
      if (patch.arrow !== undefined) next.arrow = patch.arrow;
      if (patch.strokeColor !== undefined) next.style = { ...next.style, strokeColor: patch.strokeColor };
      if (patch.strokeStyle !== undefined) next.style = { ...next.style, strokeStyle: patch.strokeStyle };
      if (patch.strokeWidth !== undefined) next.style = { ...next.style, strokeWidth: patch.strokeWidth };
      if (patch.labelAt !== undefined) next.labelAt = { ...patch.labelAt };
      board.widgets.set(id, next);
    }
  });
}

/** Change routing without touching rigid waypoints (ADR-077). */
export function setConnectorRouting(
  board: BoardDocument,
  ids: readonly string[],
  routing: ConnectorRouting,
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "connector" || widget.locked) continue;
      board.widgets.set(id, withRouting(widget, routing));
    }
  });
}

/* --------------------------------------------------------- waypoints --- */

function connectorWithRoute(connector: Widget): Widget {
  // A write turns a legacy record into the new shape, so the old special-case
  // fields can never disagree with `routing` + `waypoints` (ADR-077).
  return connector.routing ? connector : withRouting(connector, routingOf(connector));
}

/**
 * Add one rigid point. Returns its id, or null when the line already has 32.
 *
 * The caller commits this on release of a drag from a segment midpoint: one gesture,
 * one undo entry.
 */
export function addConnectorWaypoint(
  board: BoardDocument,
  id: string,
  x: number,
  y: number,
  waypointId = newId("wp"),
  index?: number,
): string | null {
  const current = board.widgets.get(id);
  if (!current || current.type !== "connector" || current.locked) return null;
  if (rigidWaypoints(current).length >= MAX_WAYPOINTS) return null;

  let created: string | null = null;
  board.transact(() => {
    const connector = connectorWithRoute(current);
    const points = [...rigidWaypoints(connector)];
    const at = index == null ? points.length : Math.min(Math.max(index, 0), points.length);
    points.splice(at, 0, { id: waypointId, x, y, rigid: true });
    board.widgets.set(id, { ...connector, waypoints: points });
    created = waypointId;
  });
  return created;
}

/** Move one rigid point. Call once per gesture, not once per pointer event. */
export function moveConnectorWaypoint(
  board: BoardDocument,
  id: string,
  waypointId: string,
  x: number,
  y: number,
): void {
  board.transact(() => {
    const current = board.widgets.get(id);
    if (!current || current.type !== "connector" || current.locked) return;
    const connector = connectorWithRoute(current);
    const waypoints = rigidWaypoints(connector).map((point) =>
      point.id === waypointId ? { ...point, x, y } : point,
    );
    board.widgets.set(id, { ...connector, waypoints });
  });
}

/** Delete one rigid point; the two adjacent segments merge (ADR-077). */
export function deleteConnectorWaypoint(
  board: BoardDocument,
  id: string,
  waypointId: string,
): void {
  board.transact(() => {
    const current = board.widgets.get(id);
    if (!current || current.type !== "connector" || current.locked) return;
    const connector = connectorWithRoute(current);
    const waypoints = rigidWaypoints(connector).filter((point) => point.id !== waypointId);
    board.widgets.set(id, { ...connector, waypoints });
  });
}

/** Reattach one end to another object/port. Self-loops are rejected (ADR-077). */
export function reattachConnectorEnd(
  board: BoardDocument,
  id: string,
  end: "start" | "end",
  item: string,
  side?: ConnectorSide,
): boolean {
  let ok = false;
  board.transact(() => {
    const current = board.widgets.get(id);
    if (!current || current.type !== "connector" || current.locked) return;
    const other = end === "start" ? current.end?.item : current.start?.item;
    if (!item || item === other) return;
    const target = board.widgets.get(item);
    if (!target || !canConnect(target)) return;
    const next: Widget = { ...current };
    next[end] = { item, ...(side ? { side } : {}) };
    board.widgets.set(id, next);
    ok = true;
  });
  return ok;
}

/**
 * Swap which object the line starts from.
 *
 * The arrow moves with the direction, so "swap ends" flips the meaning of the link
 * rather than leaving the head pointing at the object it starts from.
 */
export function swapConnectorEnds(board: BoardDocument, ids: readonly string[]): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.widgets.get(id);
      if (!widget || widget.type !== "connector") continue;
      if (widget.locked || !widget.start || !widget.end) continue;
      const arrow =
        widget.arrow === "start" ? "end" : widget.arrow === "end" ? "start" : widget.arrow;
      // The route is read from start to end, so the rigid points reverse with it.
      board.widgets.set(id, {
        ...widget,
        start: widget.end,
        end: widget.start,
        waypoints: [...rigidWaypoints(widget)].reverse(),
        arrow,
      });
    }
  });
}

/** Connectors attached to any of these widgets. */
export function connectorsTo(board: BoardDocument, ids: string[]): string[] {
  const wanted = new Set(ids);
  const found: string[] = [];
  for (const widget of board.widgets.values()) {
    if (widget.type !== "connector") continue;
    const start = widget.start?.item;
    const end = widget.end?.item;
    if ((start && wanted.has(start)) || (end && wanted.has(end))) found.push(widget.id);
  }
  return found;
}

/** Rigid waypoints of a connector, for callers that need the stored intent. */
export function connectorWaypoints(board: BoardDocument, id: string): ConnectorWaypoint[] {
  const widget = board.widgets.get(id);
  return widget?.type === "connector" ? rigidWaypoints(widget) : [];
}
