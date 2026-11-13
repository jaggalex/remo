import type { Rect } from "@remo/model";

/**
 * Scaling a selection of many objects as one box (ADR-211).
 *
 * Pure geometry: no canvas, no React, no document. The gesture builds the boxes, the
 * command writes them, and this module answers the one question both must agree on —
 * which centre and which size every member gets when the block's box changes.
 *
 * A member whose kind cannot resize (an imported placeholder), whose instance is locked,
 * or whose box the table owns, keeps its size and only moves. That is a property of the
 * member, not of the gesture: the caller passes the flags, so the rule is visible in one
 * place instead of being repeated in the pointer handler.
 */

export interface ScaleItem {
  id: string;
  /** The object's box in world coordinates, left/top anchored — what `boxOf` returns. */
  box: Rect;
  /** Whether its size may change; a caller computes it from kind, lock and table. */
  scalable: boolean;
  /** Floor for this kind — `minimumSizeOf`. Ignored for a non-scalable member. */
  min: { width: number; height: number };
}

export interface ScaledBox {
  id: string;
  /** Centre-anchored, the way a widget stores its position (`types.ts`). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScaleResult {
  boxes: ScaledBox[];
  /** The factor actually applied on each axis, after the minimum floor. */
  factors: { x: number; y: number };
  /** True when a minimum stopped the block short of the pointer. */
  stopped: boolean;
}

/**
 * The smallest factor the scalable members allow on each axis.
 *
 * A ratio above 1 means the member is already smaller than its minimum; the caller
 * treats that as "do not shrink at all" rather than growing the block during a shrink.
 */
export function minScale(items: readonly ScaleItem[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const item of items) {
    if (!item.scalable) continue;
    if (item.box.width > 0) x = Math.max(x, item.min.width / item.box.width);
    if (item.box.height > 0) y = Math.max(y, item.min.height / item.box.height);
  }
  return { x, y };
}

/**
 * Every member's box after `from` is dragged to `to`.
 *
 * `from` and `to` are left/top boxes and must be normalised (non-negative sizes). The
 * result is centre-anchored, ready for a command. Gaps between scalable members keep
 * their proportion; a non-scalable member's centre follows the same factor.
 */
export function scaleBoxes(
  items: readonly ScaleItem[],
  from: Rect,
  to: Rect,
): ScaleResult {
  const rawX = from.width > 0 ? to.width / from.width : 1;
  const rawY = from.height > 0 ? to.height / from.height : 1;

  // The floor only matters while shrinking. `Math.min(1, …)` covers the odd document
  // where a member is already below its minimum: such a block refuses to shrink, it
  // never grows because of a floor above 1.
  const floor = minScale(items);
  const kx = rawX < 1 ? Math.max(rawX, Math.min(1, floor.x)) : rawX;
  const ky = rawY < 1 ? Math.max(rawY, Math.min(1, floor.y)) : rawY;

  const boxes: ScaledBox[] = items.map((item) => {
    const centreX = item.box.x + item.box.width / 2;
    const centreY = item.box.y + item.box.height / 2;
    return {
      id: item.id,
      x: to.x + (centreX - from.x) * kx,
      y: to.y + (centreY - from.y) * ky,
      width: item.scalable ? item.box.width * kx : item.box.width,
      height: item.scalable ? item.box.height * ky : item.box.height,
    };
  });

  return { boxes, factors: { x: kx, y: ky }, stopped: kx !== rawX || ky !== rawY };
}
