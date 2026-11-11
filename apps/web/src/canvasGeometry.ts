import {
  anchorPoint,
  boxOf,
  cellAt,
  layoutTable,
  pick,
  placementAt,
  sideNormal,
  simplify,
  stubLength,
  tableCellPlacement,
  tableHitAt,
  type ConnectorPath,
  type KanbanLayout,
  type TableGrid,
} from "@remo/canvas";
import {
  GATHERABLE_TYPES,
  connectedNoteCenter,
  noteGap,
  type GapOptions,
  type NoteDirection,
} from "@remo/doc";
import {
  canConnect,
  joinsWithin,
  layerKey,
  type ConnectorSide,
  type Rect,
  type Widget,
} from "@remo/model";

/**
 * Geometry the canvas needs but does not own.
 *
 * Anchors, the axis an elbow slides on, floating-bar placement and resize handles are
 * pure functions of what is on screen. They were the bottom third of
 * `BoardCanvas.tsx`, where they could not be tested in isolation and every reader had
 * to scroll past two thousand lines to find them (ADR-054).
 */

/**
 * Anchors sit a little outside the note.
 *
 * On the edge they fight with the border and the resize handles; just outside they read
 * as "pull a line from here" and leave the note's own edge visible, which is how the
 * source product draws them (ADR-030). Corner handles follow the same rule.
 */
export const ANCHOR_GAP = 9;

/**
 * Whether a selected object's ports are its edge "+" buttons (ADR-195, ADR-201).
 *
 * A note or a shape gets the DOM "+" on each side, which both continues and starts a
 * line; painting a port circle beside it would be a second control for the same side.
 * Other connectable objects keep their painted ports.
 */
export function portsAreEdgePlus(widget: Widget): boolean {
  return (widget.type === "sticky_note" || widget.type === "shape") && !widget.locked;
}
export const HANDLE_GAP = 7;

/**
 * Anchor of `widget` closest to a point.
 *
 * Uses the anchor's own position (on the edge, not the drawn dot outside it) so the
 * chosen side matches what the connector will actually attach to.
 */
export function nearestAnchor(
  widget: Widget,
  point: { x: number; y: number },
): { side: ConnectorSide; x: number; y: number } {
  let best: { side: ConnectorSide; x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const anchor of anchorsOf(widget)) {
    const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best!;
}

/**
 * Which way an elbow's middle run can slide, and between which two coordinates.
 *
 * Read from the line as it is: the middle run is perpendicular to the two stubs, so
 * the coordinate that changes is the one the first stub does not share with the
 * middle. Returning nothing means this elbow has a single corner and nothing to slide.
 */
export function bendAxis(
  connector: Widget,
  path: ConnectorPath,
  stubOptions: { max?: number; ratio?: number },
): { axis: "x" | "y"; from: number; to: number } | Record<string, never> {
  if (connector.connectorShape !== "elbowed") return {};

  // The turns are the only vertices that stay after the path is simplified, and the
  // straight run between them is exactly what `bend` slides.
  const points = simplify(path.points);
  const turns: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 0.01) {
      turns.push(b);
    }
  }
  if (turns.length < 2) return {};

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const stub = stubLength(Math.hypot(last.x - first.x, last.y - first.y), stubOptions);
  const towards = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / length) * stub, y: from.y + (dy / length) * stub };
  };
  const fromStub = towards(first, turns[0]!);
  const toStub = towards(last, turns[turns.length - 1]!);
  const verticalRun = Math.abs(turns[0]!.x - turns[1]!.x) < 0.01;

  // A vertical run slides in x between the two stub ends; a horizontal one in y.
  return verticalRun
    ? { axis: "x", from: fromStub.x, to: toStub.x }
    : { axis: "y", from: fromStub.y, to: toStub.y };
}

/** The note direction an anchor points at: the side the new note lands on. */
export function directionOfSide(side: ConnectorSide): NoteDirection {
  return side === "left" ? "left" : side === "right" ? "right" : side === "top" ? "up" : "down";
}

/** The side a copy grown in `direction` leaves from (the inverse of `directionOfSide`). */
export function sideOfDirection(direction: NoteDirection): ConnectorSide {
  return direction === "left" ? "left" : direction === "right" ? "right" : direction === "up" ? "top" : "bottom";
}

/** Height reserved for a floating bar, including the gap above the object. */
/**
 * Space above the object for the object bar.
 *
 * It must clear the 44 px edge "+" (centred 30 px outside the edge, ADR-195), or the
 * bar would sit on top of that button and make it unreachable.
 */
export const BAR_ROOM = 84;
/** A bar with no edge "+" to clear — the arrange and connector bars. */
export const COMPACT_BAR_ROOM = 52;

/**
 * Vertical placement of a floating bar over a box in screen space.
 *
 * Above the object when there is room, below it when there is not — and clamped into
 * the canvas either way. A tall selection or a note near the bottom edge used to
 * push the bar past the viewport, where it is invisible but still eats clicks.
 */
export function barTop(
  box: { top: number; height: number },
  viewport: { height: number },
  room = BAR_ROOM,
): number {
  const above = box.top - room;
  const below = box.top + box.height + 12;
  const lowest = Math.max(8, viewport.height - 40 - 8);
  if (above >= 8) return Math.min(above, lowest);
  if (below <= lowest) return below;
  return Math.min(Math.max(8, above), lowest);
}


/** Where a connector starts on an object: the middle of its right edge. */
/**
 * The four ports a connector can be drawn from (ADR-137).
 *
 * One per side, at the midpoint: the source product's dots. Corners are not ports —
 * a line leaving a corner reads as a line that missed the object, and a corner gave
 * one side three different addresses instead of one.
 */
export function anchorsOf(
  widget: Widget,
  gap = 0,
): Array<{ side: ConnectorSide; x: number; y: number }> {
  const box = boxOf(widget);
  const sides: ConnectorSide[] = ["top", "right", "bottom", "left"];
  return sides.map((side) => {
    const point = anchorPoint(box, side);
    const normal = sideNormal(side);
    return { side, x: point.x + normal.x * gap, y: point.y + normal.y * gap };
  });
}

/* ---------------------------------------------------------- resize handles --- */

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

const CORNERS: Array<{ corner: ResizeCorner; x: (box: Rect) => number; y: (box: Rect) => number }> = [
  { corner: "nw", x: (b) => b.x, y: (b) => b.y },
  { corner: "ne", x: (b) => b.x + b.width, y: (b) => b.y },
  { corner: "sw", x: (b) => b.x, y: (b) => b.y + b.height },
  { corner: "se", x: (b) => b.x + b.width, y: (b) => b.y + b.height },
];

/** The four handles, pushed out diagonally so they do not sit on the note's edge. */
export function cornerPoints(
  box: Rect,
  gap = 0,
): Array<{ corner: ResizeCorner; x: number; y: number }> {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  return CORNERS.map((entry) => {
    const x = entry.x(box);
    const y = entry.y(box);
    return {
      corner: entry.corner,
      x: x + (x < midX ? -gap : gap),
      y: y + (y < midY ? -gap : gap),
    };
  });
}

/** Corner of `box` under the pointer, if any is within `tolerance` world units. */
export function cornerAt(
  box: Rect,
  point: { x: number; y: number },
  tolerance: number,
  gap = 0,
): ResizeCorner | null {
  let best: ResizeCorner | null = null;
  let bestDistance = Infinity;
  for (const entry of cornerPoints(box, gap)) {
    const distance = Math.hypot(entry.x - point.x, entry.y - point.y);
    if (distance <= tolerance && distance < bestDistance) {
      best = entry.corner;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Box for a corner drag.
 *
 * The corner opposite the one being dragged stays put, which is what makes a resize
 * feel attached to the note rather than to the grid. The minimum keeps a note from
 * collapsing to a line under a fast flick.
 */
export function resizedBox(
  origin: Rect,
  corner: ResizeCorner,
  point: { x: number; y: number },
  minWidth: number,
  minHeight: number,
): Rect {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";

  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;

  const left = west ? Math.min(point.x, right - minWidth) : origin.x;
  const top = north ? Math.min(point.y, bottom - minHeight) : origin.y;
  const newRight = west ? right : Math.max(point.x, origin.x + minWidth);
  const newBottom = north ? bottom : Math.max(point.y, origin.y + minHeight);

  return { x: left, y: top, width: newRight - left, height: newBottom - top };
}

export function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function hoveredCell(
  layouts: Map<string, KanbanLayout>,
  point: { x: number; y: number },
): { columnId: string; swimlaneId: string } | null {
  for (const layout of layouts.values()) {
    const cell = cellAt(layout, point);
    if (cell) return cell;
  }
  return null;
}

export function placementOfCard(
  layouts: Map<string, KanbanLayout>,
  cardId: string,
): { x: number; y: number; width: number; height: number } | null {
  for (const layout of layouts.values()) {
    const placement = layout.placements.find((p) => p.cardId === cardId);
    if (placement) return placement;
  }
  return null;
}

/**
 * A card's box comes from its kanban placement, not from `widget.x/y` (ADR-113).
 * Every geometry consumer calls this before it turns a widget into a box.
 */
export function placedWidget(
  widget: Widget,
  layouts: Map<string, KanbanLayout>,
): Widget {
  if (widget.type !== "card") return widget;
  const placement = placementOfCard(layouts, widget.id);
  if (!placement) return widget;
  return {
    ...widget,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
}

/** Resolver for connector paths and picking: cards resolve through the matrix. */
export function connectorResolver(
  widgets: readonly Widget[],
  layouts: Map<string, KanbanLayout>,
): (id: string) => Widget | undefined {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  return (id) => {
    const widget = byId.get(id);
    return widget ? placedWidget(widget, layouts) : undefined;
  };
}

/** Placement of a card anywhere on the board, including its box. */
export function layoutForCard(
  layouts: Map<string, KanbanLayout>,
  cardId: string,
): { x: number; y: number; width: number; height: number } | null {
  return placementOfCard(layouts, cardId);
}

/**
 * What a connector being dragged should attach to.
 *
 * A card inside a kanban is not pickable as a widget (ADR-006), so placements are
 * checked first: dropping a line on a card must work. Containers are refused, so a
 * line can never attach to a whole kanban or frame by accident.
 */
/**
 * Nearest object a line can attach to.
 *
 * The pointer's own object wins; past that, the nearest connectable object within
 * `radius` (world units) is the target, which is what makes a line snap to a note
 * that is 160 screen pixels away instead of demanding a pixel-perfect drop
 * (ADR-077).
 */
export function connectTargetAt(
  point: { x: number; y: number },
  layouts: Map<string, KanbanLayout>,
  widgets: Widget[],
  isCardOfKanban: (widget: Widget) => boolean,
  radius = 0,
): Widget | null {
  for (const layout of layouts.values()) {
    const placement = placementAt(layout, point);
    if (!placement) continue;
    const card = widgets.find((w) => w.id === placement.cardId);
    if (card && canConnect(card)) return card;
  }

  const hit = pick(widgets, point, isCardOfKanban);
  if (hit && canConnect(hit)) return hit;
  if (radius <= 0) return null;

  let best: Widget | null = null;
  let bestDistance = radius;
  for (const widget of widgets) {
    if (!canConnect(widget) || isCardOfKanban(widget)) continue;
    const box = boxOf(widget);
    const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
    const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = widget;
      bestDistance = distance;
    }
  }
  return best;
}

/* ------------------------------------------------- anchor-click slot --- */

/** Where a clone grown from `source` would land, and the rectangle it would occupy. */
export interface CopySlot {
  center: { x: number; y: number };
  rect: Rect;
}

/**
 * Slot of the copy a port click would create (ADR-137).
 *
 * The centre is the source's extent plus the gap, not a constant: a note three times
 * as wide pushes its copy three times as far, so the source can never fall inside the
 * slot. The floor of one unit keeps a zero gap from producing touching rectangles
 * that a stricter intersection test could still call occupied.
 */
export function copySlot(
  source: Widget,
  direction: NoteDirection,
  options: GapOptions = {},
): CopySlot {
  const width = source.width;
  const height = source.height;
  const center = connectedNoteCenter(source, direction, options);
  return {
    center,
    rect: { x: center.x - width / 2, y: center.y - height / 2, width, height },
  };
}

/** Rectangles overlap when each one reaches into the other; touching is not overlap. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * The first free copy slot in `direction`, used by "Create new" in an occupied slot
 * (ADR-195).
 *
 * The preview and the command call this same function, so what the person sees before
 * the click is exactly where the copy lands. The search walks in whole source extents
 * plus the tuned gap; only connectable leaves block a slot, because a frame or a line
 * in it still leaves room for a note.
 */
export function freeConnectedCenter(
  source: Widget,
  direction: NoteDirection,
  widgets: readonly Widget[],
  layouts: Map<string, KanbanLayout>,
  options: GapOptions = {},
): CopySlot {
  const gap = noteGap(source.width, source.height, options);
  const stepX =
    direction === "right" ? source.width + gap : direction === "left" ? -(source.width + gap) : 0;
  const stepY =
    direction === "down" ? source.height + gap : direction === "up" ? -(source.height + gap) : 0;
  let center = connectedNoteCenter(source, direction, options);

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const rect = {
      x: center.x - source.width / 2,
      y: center.y - source.height / 2,
      width: source.width,
      height: source.height,
    };
    const occupied = widgets.some((widget) => {
      if (widget.id === source.id || !canConnect(widget)) return false;
      if (
        widget.type === "card" &&
        widget.parentId &&
        layouts.has(widget.parentId) &&
        !placementOfCard(layouts, widget.id)
      ) {
        return false;
      }
      return overlaps(rect, boxOf(placedWidget(widget, layouts)));
    });
    if (!occupied) return { center, rect };
    center = { x: center.x + stepX, y: center.y + stepY };
  }

  return {
    center,
    rect: {
      x: center.x - source.width / 2,
      y: center.y - source.height / 2,
      width: source.width,
      height: source.height,
    },
  };
}

/** What a port click does with the slot it computed. */
export type AnchorSlotDecision =
  | { kind: "clone" }
  | { kind: "connect"; target: Widget; endSide: ConnectorSide }
  | { kind: "duplicate"; target: Widget };

/** The transient preview the edge "+" paints before a click (ADR-195). */
export interface ContinuePreview {
  source: Widget;
  direction: NoteDirection;
  decision: AnchorSlotDecision;
  /** The free slot for a clone or "Create new"; absent for a pure connect. */
  freeCenter?: { x: number; y: number };
}

/**
 * Decide the outcome of a port click (ADR-137).
 *
 * Occupancy is a rectangle intersection with the copy's slot, never a centre test:
 * a wide object can reach into the slot without covering its middle, and a small one
 * can cover the middle without touching it. Only connectable leaves compete — a frame,
 * a kanban or a connector in the slot still leaves it free for a clone.
 *
 * The winner is: the same type as the source, then the nearest centre, then the
 * topmost paint layer. A pair that already has a line produces `duplicate`, which the
 * gesture turns into "nothing happens" rather than a second edge.
 */
export function anchorSlotDecision(
  source: Widget,
  direction: NoteDirection,
  widgets: readonly Widget[],
  layouts: Map<string, KanbanLayout>,
  options: GapOptions = {},
): AnchorSlotDecision {
  const slot = copySlot(source, direction, options);
  const candidates: Widget[] = [];

  for (const widget of widgets) {
    if (widget.id === source.id) continue;
    if (!canConnect(widget)) continue;
    // A card inside a kanban whose placement is gone is not on screen at all; its
    // stored coordinates are a stale capture (ADR-006, ADR-113).
    if (
      widget.type === "card" &&
      widget.parentId &&
      layouts.has(widget.parentId) &&
      !placementOfCard(layouts, widget.id)
    ) {
      continue;
    }
    const placed = placedWidget(widget, layouts);
    if (!overlaps(slot.rect, boxOf(placed))) continue;
    candidates.push(placed);
  }

  if (!candidates.length) return { kind: "clone" };

  const sameType = candidates.filter((widget) => widget.type === source.type);
  const pool = sameType.length ? sameType : candidates;
  let best = pool[0]!;
  let bestDistance = Math.hypot(best.x - slot.center.x, best.y - slot.center.y);
  for (const widget of pool.slice(1)) {
    const distance = Math.hypot(widget.x - slot.center.x, widget.y - slot.center.y);
    // Ties are settled by paint order: the object drawn last is the one the person
    // sees in the slot.
    if (distance < bestDistance - 0.001) {
      best = widget;
      bestDistance = distance;
    } else if (Math.abs(distance - bestDistance) <= 0.001 && layerKey(widget) > layerKey(best)) {
      best = widget;
    }
  }

  for (const widget of widgets) {
    if (widget.type !== "connector") continue;
    const ends = [widget.start?.item, widget.end?.item];
    if (ends.includes(source.id) && ends.includes(best.id)) {
      return { kind: "duplicate", target: best };
    }
  }

  const from = anchorPoint(boxOf(source), sideOfDirection(direction));
  return { kind: "connect", target: best, endSide: nearestAnchor(best, from).side };
}

/* ------------------------------------------------- selection members --- */

/**
 * The connectors a set of objects brings with it (ADR-138).
 *
 * A line is a relation, not a third object, and its stored box is the bounding box
 * captured when it was created — stale the moment an end moves. So it can never be
 * picked by its own geometry: the marquee skips lines and a click picks a line only on
 * the path itself. It becomes a member of a set when both objects it joins are in that
 * set, which is the same rule the clipboard uses for a copy (ADR-053) and the export
 * uses for a scope (ADR-071). One end, or a line that merely crosses the rectangle, is
 * not membership.
 *
 * `layouts` widens the set with the cards of a selected kanban: a kanban is its cards
 * (ADR-071), so a card endpoint into a selected board counts as inside.
 */
export function internalConnectors(
  widgets: readonly Widget[],
  ids: Iterable<string>,
  layouts?: Map<string, KanbanLayout>,
): Widget[] {
  const scope = new Set(ids);
  if (layouts) {
    for (const id of [...scope]) {
      const layout = layouts.get(id);
      if (!layout) continue;
      for (const placement of layout.placements) scope.add(placement.cardId);
    }
  }

  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const widget of widgets) {
    if (!joinsWithin(widget, scope)) continue;
    if (seen.has(widget.id)) continue;
    seen.add(widget.id);
    out.push(widget);
  }
  return out;
}


/** A data cell that can take a dragged selection, with the grid it came from. */
export interface TableDropTarget {
  frameId: string;
  rowId: string;
  columnId: string;
  grid: TableGrid;
  rect: Rect;
}

/**
 * What a drag is over: a data cell, a refused header, or no table at all.
 *
 * Read from the same `layoutTable`/`tableHitAt` pair the painter uses, so the cell a
 * person points at is the cell the drop lands in. Headers are returned as a refusal,
 * because a header never accepts objects (ADR-196).
 */
export function tableDropAt(
  widgets: readonly Widget[],
  point: { x: number; y: number },
): { kind: "cell"; target: TableDropTarget } | { kind: "header" } | null {
  for (const frame of [...widgets].reverse()) {
    if (frame.type !== "frame" || frame.layout?.kind !== "table") continue;
    if (frame.layout.active === false || frame.locked) continue;
    const grid = layoutTable(frame, widgets);
    if (!grid) continue;
    const hit = tableHitAt(grid, point);
    if (!hit) continue;
    if (hit.kind === "cell") {
      return {
        kind: "cell",
        target: {
          frameId: frame.id,
          rowId: hit.rowId,
          columnId: hit.columnId,
          grid,
          rect: hit.rect,
        },
      };
    }
    return { kind: "header" };
  }
  return null;
}

/** Whether every dragged object is an ordinary table member that may land in a cell. */
export function tableDropSelection(
  widgets: readonly Widget[],
  ids: readonly string[],
): boolean {
  if (!ids.length) return false;
  return ids.every((id) => {
    const widget = widgets.find((entry) => entry.id === id);
    return Boolean(widget && GATHERABLE_TYPES.has(widget.type));
  });
}

/** The one world offset that lands the selection in the target cell. */
export function tableDropOffset(
  target: TableDropTarget,
  widgets: readonly Widget[],
  ids: readonly string[],
): { x: number; y: number } | null {
  return tableCellPlacement(
    target.grid,
    target.rowId,
    target.columnId,
    widgets,
    ids,
  );
}

/** Whether every object already belongs to this exact cell. */
export function inTableCell(
  widget: Widget,
  target: { frameId: string; rowId: string; columnId: string },
): boolean {
  return (
    widget.parentId === target.frameId &&
    widget.cell?.rowId === target.rowId &&
    widget.cell?.columnId === target.columnId
  );
}
