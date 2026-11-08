import type { Vec2, Widget } from "@remo/model";
import { connectorPath, distanceToPath, pathPolyline } from "./connectors";
import { layerKey } from "@remo/model";
import { spatialIndex } from "./spatial";

export function containsPoint(widget: Widget, point: Vec2): boolean {
  return (
    point.x >= widget.x - widget.width / 2 &&
    point.x <= widget.x + widget.width / 2 &&
    point.y >= widget.y - widget.height / 2 &&
    point.y <= widget.y + widget.height / 2
  );
}

export function intersectsRect(
  widget: Widget,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const left = widget.x - widget.width / 2;
  const top = widget.y - widget.height / 2;
  return (
    left < rect.x + rect.width &&
    left + widget.width > rect.x &&
    top < rect.y + rect.height &&
    top + widget.height > rect.y
  );
}

/**
 * Topmost widget under the cursor.
 *
 * "Topmost" follows *paint* order, not insertion order: a sticky dropped on top of a
 * kanban is drawn above it and must therefore be picked before it, and an object the
 * person brought to the front (its own layer) is picked before everything below it. Cards inside a
 * kanban are skipped — the kanban is a single object and card placement is derived
 * (ADR-006). Connectors are skipped as well: their stored box is the bounding box of
 * the two ends, so it would swallow every click in a large empty rectangle. A
 * connector is picked by its line instead — see `pickConnector`.
 */
export function pick(
  widgets: Widget[],
  point: Vec2,
  isHandledElsewhere: (widget: Widget) => boolean,
): Widget | null {
  let best: Widget | null = null;
  let bestRank = -Infinity;

  // The grid returns candidates in document order, but "topmost" is layer rank, so the
  // loop is unchanged: only the set of widgets to check is smaller.
  for (const widget of spatialIndex(widgets).queryPoint(point)) {
    if (widget.type === "connector") continue;
    if (isHandledElsewhere(widget)) continue;
    if (!containsPoint(widget, point)) continue;
    const rank = layerKey(widget);
    if (rank >= bestRank) {
      best = widget;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Connector whose line passes within `tolerance` world units of the point.
 *
 * A line is one pixel wide, so a bounding-box test would be either unusable (a
 * diagonal connector's box is most of the board) or impossible to hit (the box of
 * a horizontal line has zero height). Distance to the segment is the honest test,
 * and it is what makes a connector selectable — and therefore deletable.
 */
export function pickConnector(
  widgets: Widget[],
  point: Vec2,
  tolerance: number,
  resolve: (id: string) => Widget | undefined,
  stubOptions?: { max?: number; ratio?: number },
): Widget | null {
  let best: Widget | null = null;
  let bestDistance = Infinity;

  for (const widget of widgets) {
    if (widget.type !== "connector") continue;
    const path = connectorPath(widget, resolve, stubOptions);
    if (!path) continue;
    const distance = distanceToPath(point, pathPolyline(path));
    if (distance <= tolerance && distance < bestDistance) {
      best = widget;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Widgets touched by a marquee. Frames are containers rather than items, and
 * kanban cards are skipped because the widget itself is the object. Connectors are
 * skipped too: their box is the bounding rectangle of both ends and would be
 * selected by almost any marquee that crosses the gap between two objects.
 */
export function pickInRect(
  widgets: Widget[],
  rect: { x: number; y: number; width: number; height: number },
  isHandledElsewhere: (widget: Widget) => boolean,
): Widget[] {
  return spatialIndex(widgets).query(rect).filter((widget) => {
    if (widget.type === "frame") return false;
    if (widget.type === "connector") return false;
    if (isHandledElsewhere(widget)) return false;
    return intersectsRect(widget, rect);
  });
}

/** Normalise two corners into a positive-size rectangle. */
export function rectFrom(
  a: Vec2,
  b: Vec2,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
