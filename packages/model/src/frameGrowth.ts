/**
 * How a frame grows to hold a member that got bigger (ADR-243).
 *
 * Invariants
 *  - Only the sides the child crosses move, each to the child's edge plus the margin;
 *    the other sides stay exactly where they were.
 *  - A frame that already holds the child is returned unchanged (same values), so the
 *    caller can tell "no change" and write nothing.
 *  - The result never is smaller than the frame: this only grows.
 *
 * Boxes are centre-anchored, as widgets are (types.ts).
 */
export interface CentreBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room left between a grown frame's edge and the member that made it grow. */
export const FRAME_GROW_MARGIN = 24;

export function frameBoxHolding(
  frame: CentreBox,
  child: CentreBox,
  margin = FRAME_GROW_MARGIN,
): CentreBox {
  let left = frame.x - frame.width / 2;
  let right = frame.x + frame.width / 2;
  let top = frame.y - frame.height / 2;
  let bottom = frame.y + frame.height / 2;
  const childLeft = child.x - child.width / 2;
  const childRight = child.x + child.width / 2;
  const childTop = child.y - child.height / 2;
  const childBottom = child.y + child.height / 2;

  if (childLeft < left) left = childLeft - margin;
  if (childRight > right) right = childRight + margin;
  if (childTop < top) top = childTop - margin;
  if (childBottom > bottom) bottom = childBottom + margin;

  const width = right - left;
  const height = bottom - top;
  if (width === frame.width && height === frame.height) return frame;
  return { x: left + width / 2, y: top + height / 2, width, height };
}
