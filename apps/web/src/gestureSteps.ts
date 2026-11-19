import {
  snapMove,
  tangentAtPath,
  type AlignmentGuide,
  type ConnectorPath,
  type SnapTarget,
} from "@remo/canvas";
import type { Rect } from "@remo/model";

/**
 * The arithmetic of a gesture, one function per handle.
 *
 * These were inline branches in `BoardCanvas.pointerMove`: a bend is a coordinate
 * divided by a span, a curve handle is a projection onto a normal, a flip is whichever
 * corner is nearer, a drag is a snap. Two interaction bugs came out of this code, and it
 * could only be exercised by dragging in a browser (ADR-057).
 */

/** Drag: the raw offset plus whatever the alignment snap adds. */
export function moveStep(args: {
  /** Union box of the dragged objects, captured when the gesture began. */
  box: Rect;
  /** Pointer travel since the gesture began, in world units. */
  raw: { dx: number; dy: number };
  /** What to snap against (neighbours, column edges). */
  targets: readonly SnapTarget[];
  /** Snap distance in world units; 0 disables snapping. */
  threshold: number;
}): { delta: { dx: number; dy: number }; guides: AlignmentGuide[] } {
  const { box, raw, targets, threshold } = args;
  if (threshold <= 0) return { delta: raw, guides: [] };

  const moved = { ...box, x: box.x + raw.dx, y: box.y + raw.dy };
  const snap = snapMove(moved, targets, threshold);
  return {
    delta: { dx: raw.dx + snap.dx, dy: raw.dy + snap.dy },
    guides: snap.guides,
  };
}

/** Elbow: where the middle run sits between its two stubs, clamped to the ends. */
export function bendStep(
  point: { x: number; y: number },
  axis: "x" | "y",
  from: number,
  to: number,
): number {
  const span = to - from || 1;
  return Math.min(1, Math.max(0, (point[axis] - from) / span));
}

/** L-shaped elbow: does the pointer sit nearer the other corner than the current one? */
export function flipStep(
  point: { x: number; y: number },
  current: { x: number; y: number },
  alternate: { x: number; y: number },
): boolean {
  const toAlternate = Math.hypot(point.x - alternate.x, point.y - alternate.y);
  const toCurrent = Math.hypot(point.x - current.x, point.y - current.y);
  return toAlternate < toCurrent;
}

/** Longest control length a curve handle may produce, in canvas units. */
export const MAX_CURVE = 1200;

/**
 * Curve: how far a control point is pulled out of its side.
 *
 * The pointer is projected onto the side's normal, so dragging sideways along the line
 * does not change the bulge — only pulling away from it does. That is what makes a
 * bezier handle feel attached to the curve instead of to the cursor.
 */
export function curveStep(args: {
  handle: "curveFrom" | "curveTo";
  point: { x: number; y: number };
  path: ConnectorPath;
  /** The lengths already stored (or the natural ones, for an untouched curve). */
  current: { from: number; to: number };
}): { from: number; to: number } {
  const { handle, point, path, current } = args;
  const start = path.points[0]!;
  const end = path.points[path.points.length - 1]!;
  const out = tangentAtPath(path, 0);
  const into = tangentAtPath(path, 1);

  const project = (
    from: { x: number; y: number },
    along: { x: number; y: number },
  ): number => (point.x - from.x) * along.x + (point.y - from.y) * along.y;

  if (handle === "curveFrom") {
    return {
      from: Math.min(MAX_CURVE, Math.max(0, project(start, out))),
      to: current.to,
    };
  }
  return {
    from: current.from,
    to: Math.min(MAX_CURVE, Math.max(0, project(end, { x: -into.x, y: -into.y }))),
  };
}
