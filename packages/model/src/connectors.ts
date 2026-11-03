import type { ConnectorRouting, ConnectorWaypoint, Widget } from "./types";
import { MAX_WAYPOINTS } from "./types";

/**
 * Connector routing, with the one-release fallback for boards made before ADR-077.
 *
 * New code reads and writes `routing` + `waypoints`. Old records still carry
 * `connectorShape` (and the three special-case fields `bend`, `elbowFlip`, `curve`),
 * which the router understands until the migration window closes.
 */
export function routingOf(connector: Widget): ConnectorRouting {
  if (connector.routing) return connector.routing;
  switch (connector.connectorShape) {
    case "straight":
      return "straight";
    case "curved":
      return "curved";
    default:
      return "elbow";
  }
}

/** True when the record was written before `routing`/`waypoints` existed. */
export function hasLegacyConnectorShape(connector: Widget): boolean {
  return connector.routing === undefined && connector.waypoints === undefined;
}

/** Rigid points only: automatic geometry is not user intent and is not stored. */
export function rigidWaypoints(connector: Widget): ConnectorWaypoint[] {
  return (connector.waypoints ?? []).filter((point) => point.rigid !== false);
}

/**
 * True when both ends of a connector are inside `ids` (ADR-138).
 *
 * A line is a relation, not a third object: it travels with a selection, a copy and an
 * export only when both of the objects it joins do. A broken line — one end, or none —
 * joins nothing and is never included. This is the one predicate for that question;
 * the clipboard, the marquee and the export scope all ask it instead of re-deriving
 * "both ends" from `start`/`end` each in their own way.
 */
export function joinsWithin(connector: Widget, ids: ReadonlySet<string>): boolean {
  if (connector.type !== "connector") return false;
  const from = connector.start?.item;
  const to = connector.end?.item;
  return Boolean(from && to && ids.has(from) && ids.has(to));
}

/** ADR-077: self-loops are rejected and a line has at most 32 waypoints. */
export function connectorCanTakeWaypoint(connector: Widget): boolean {
  return rigidWaypoints(connector).length < MAX_WAYPOINTS;
}

/**
 * Copy a connector with new routing, dropping the legacy special cases.
 *
 * This is what every write goes through: once a line is edited it is a new-shape
 * record, and the old `bend`/`elbowFlip`/`curve` fields can no longer disagree with
 * `routing` and `waypoints`.
 */
export function withRouting(connector: Widget, routing: ConnectorRouting): Widget {
  const next: Widget = { ...connector, routing };
  delete next.connectorShape;
  delete next.bend;
  delete next.elbowFlip;
  delete next.curve;
  return next;
}
