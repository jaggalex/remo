import type { Rect } from "@remo/model";
import { roundRect } from "./render";

/**
 * The lock badge on a locked object (ADR-193).
 *
 * The badge is chrome, not content: it is painted by the overlay layer in screen pixels,
 * so it keeps its size at every zoom and never reaches an export or a presentation. The
 * placement is a pure function so the painter and its test cannot disagree about where
 * the mark sits.
 */

/** Visual size of the badge in screen pixels (ADR-193). */
export const LOCK_BADGE_SIZE = 16;
/** Gap between the badge and the object's top and right edges, in screen pixels. */
export const LOCK_BADGE_MARGIN = 4;

/**
 * Where the badge sits inside a widget's box, in world units.
 *
 * `zoom` converts the fixed screen size to world units. A widget smaller than the badge
 * keeps its top-left corner as the anchor: the badge yields no space (ADR-193), so it may
 * cover the object rather than leave the bounds on the left or top.
 */
export function lockBadgeRect(box: Rect, zoom: number): Rect {
  const safeZoom = Math.max(zoom, 0.0001);
  const size = LOCK_BADGE_SIZE / safeZoom;
  const margin = LOCK_BADGE_MARGIN / safeZoom;
  const x = box.x + Math.max(0, box.width - size - margin);
  const y = box.y + Math.max(0, Math.min(margin, (box.height - size) / 2));
  return { x, y, width: size, height: size };
}

/**
 * Paint the `lock-on` glyph inside `rect`, in the caller's ink.
 *
 * The path is the 16-grid lock: a filled body and a stroked shackle. Drawing it with
 * primitives keeps the painter independent of `Path2D` and of the DOM icon set.
 */
export function drawLockBadge(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  ink: string,
): void {
  const scale = rect.width / LOCK_BADGE_SIZE;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.5;

  // Shackle: from the body's top edge up and over to the other side. A quadratic
  // curve keeps the top round at every scale; an arc's direction is easy to get
  // wrong and reads as two prongs at 16 px.
  ctx.beginPath();
  ctx.moveTo(5.5, 7.5);
  ctx.lineTo(5.5, 5.5);
  ctx.quadraticCurveTo(5.5, 3.5, 8, 3.5);
  ctx.quadraticCurveTo(10.5, 3.5, 10.5, 5.5);
  ctx.lineTo(10.5, 7.5);
  ctx.stroke();

  // Body: the filled part of `lock-on`.
  roundRect(ctx, 3.5, 7.5, 9, 6, 1.5);
  ctx.fill();

  ctx.restore();
}
