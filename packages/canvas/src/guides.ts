import type { Rect } from "@remo/model";
import type { KanbanLayout } from "./layout";

/**
 * Alignment guides and snapping for a drag (ADR-026).
 *
 * The source product shows dashed lines while an object is dragged, and pulls the
 * object a few pixels so it lines up exactly with what it is near. Both halves come
 * from the same computation: candidate alignments are collected, the closest one per
 * axis wins, and every candidate that agrees with the winning offset becomes a guide
 * line. A guide is therefore never decorative — it is drawn only where the object
 * really snapped.
 *
 * The tolerance is in world units, so the caller divides the screen tolerance by the
 * zoom: snapping must feel the same at 20 % and at 200 %.
 */
export type GuideAxis = "x" | "y";

export interface AlignmentGuide {
  /**
   * `x` is a vertical line at `position`; `y` is a horizontal one. Named after the
   * coordinate that is fixed, which is how the line is drawn.
   */
  axis: GuideAxis;
  /** World coordinate of the line. */
  position: number;
  /** Extent along the other axis, covering the object and everything it aligns to. */
  from: number;
  to: number;
  kind: "edge" | "center";
}

export interface SnapResult {
  /** Extra offset to add to the drag delta. */
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

/**
 * A box to line up with.
 *
 * `centers` is off for grid structures — a kanban column's centre is where its cards
 * sit, so aligning a note's left edge to it is noise, while its edges are the grid
 * people actually use.
 */
export interface SnapTarget extends Rect {
  centers?: boolean;
}

interface Anchor {
  value: number;
  kind: "edge" | "center";
}

/** Left and right edges — always available. */
function edgesX(box: Rect): Anchor[] {
  return [
    { value: box.x, kind: "edge" },
    { value: box.x + box.width, kind: "edge" },
  ];
}

function edgesY(box: Rect): Anchor[] {
  return [
    { value: box.y, kind: "edge" },
    { value: box.y + box.height, kind: "edge" },
  ];
}

/** Edges plus the centre line, which is what an object-to-object alignment uses. */
function anchorsX(box: SnapTarget): Anchor[] {
  if (box.centers === false) return edgesX(box);
  return [...edgesX(box), { value: box.x + box.width / 2, kind: "center" }];
}

function anchorsY(box: SnapTarget): Anchor[] {
  if (box.centers === false) return edgesY(box);
  return [...edgesY(box), { value: box.y + box.height / 2, kind: "center" }];
}

interface Candidate {
  axis: GuideAxis;
  /** Offset that would align this pair exactly. */
  delta: number;
  position: number;
  kind: "edge" | "center";
  /** Span of the target along the other axis. */
  from: number;
  to: number;
}

function candidatesForAxis(
  moving: Rect,
  targets: readonly SnapTarget[],
  axis: GuideAxis,
): Candidate[] {
  const movingAnchors = axis === "x" ? anchorsX(moving) : anchorsY(moving);
  const out: Candidate[] = [];

  for (const target of targets) {
    const targetAnchors = axis === "x" ? anchorsX(target) : anchorsY(target);
    for (const m of movingAnchors) {
      for (const t of targetAnchors) {
        out.push({
          axis,
          delta: t.value - m.value,
          position: t.value,
          // A centre-to-centre match is worth drawing differently from an edge.
          kind: m.kind === "center" && t.kind === "center" ? "center" : "edge",
          from: axis === "x" ? target.y : target.x,
          to: axis === "x" ? target.y + target.height : target.x + target.width,
        });
      }
    }
  }
  return out;
}

/** Smallest absolute offset within tolerance, or null when nothing is near enough. */
function bestDelta(candidates: readonly Candidate[], tolerance: number): number | null {
  let best: number | null = null;
  for (const candidate of candidates) {
    if (Math.abs(candidate.delta) > tolerance) continue;
    if (best == null || Math.abs(candidate.delta) < Math.abs(best)) best = candidate.delta;
  }
  return best;
}

function sameOffset(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

/**
 * Snap `moving` to the nearest alignment with any of `targets`.
 *
 * Movement is axis-independent: an object can line up horizontally with one neighbour
 * and vertically with another at the same time, which is exactly what the dashed
 * cross in the source product shows.
 */
export function snapMove(
  moving: Rect,
  targets: readonly SnapTarget[],
  tolerance: number,
): SnapResult {
  if (!targets.length || tolerance <= 0) return { dx: 0, dy: 0, guides: [] };

  const xCandidates = candidatesForAxis(moving, targets, "x");
  const yCandidates = candidatesForAxis(moving, targets, "y");

  const dx = bestDelta(xCandidates, tolerance) ?? 0;
  const dy = bestDelta(yCandidates, tolerance) ?? 0;

  const snapped: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };

  const guides: AlignmentGuide[] = [];
  const add = (candidate: Candidate): void => {
    const existing = guides.find(
      (guide) => guide.axis === candidate.axis && sameOffset(guide.position, candidate.position),
    );
    const movingFrom = candidate.axis === "x" ? snapped.y : snapped.x;
    const movingTo = candidate.axis === "x" ? snapped.y + snapped.height : snapped.x + snapped.width;

    if (existing) {
      existing.from = Math.min(existing.from, movingFrom, candidate.from);
      existing.to = Math.max(existing.to, movingTo, candidate.to);
      return;
    }
    guides.push({
      axis: candidate.axis,
      position: candidate.position,
      from: Math.min(movingFrom, candidate.from),
      to: Math.max(movingTo, candidate.to),
      kind: candidate.kind,
    });
  };

  // Every candidate that agrees with the winning offset is a real alignment at the
  // snapped position, so every one of them gets a line.
  for (const candidate of xCandidates) {
    if (sameOffset(candidate.delta, dx)) add(candidate);
  }
  for (const candidate of yCandidates) {
    if (sameOffset(candidate.delta, dy)) add(candidate);
  }

  // Deterministic order, so the same drag always paints the same list.
  guides.sort((a, b) => (a.axis === b.axis ? a.position - b.position : a.axis === "x" ? -1 : 1));

  return { dx, dy, guides };
}

/** Union box of rectangles, or null for an empty list. */
export function unionBox(boxes: readonly Rect[]): Rect | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Guides for a card being dropped into a kanban cell.
 *
 * A card has no free coordinates — its place is the cell, and the matrix decides the
 * exact box. So these lines do not describe a snap the pointer performed; they show
 * the edges the card will occupy the moment it is dropped, which is the only claim
 * that stays true after the mouse is released.
 */
export function cellGuides(
  layout: KanbanLayout,
  cell: { columnId: string; swimlaneId: string },
): AlignmentGuide[] {
  const column = layout.columns.find((entry) => entry.id === cell.columnId);
  const lane = layout.lanes.find((entry) => entry.id === cell.swimlaneId);
  if (!column || !lane) return [];

  const from = lane.top;
  const to = lane.top + lane.height;
  return [
    { axis: "x", position: column.left + layout.padding, from, to, kind: "edge" },
    { axis: "x", position: column.left + column.width - layout.padding, from, to, kind: "edge" },
  ];
}
