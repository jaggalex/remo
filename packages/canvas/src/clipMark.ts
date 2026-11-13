import type { CanvasPalette } from "./palette";
import { roundRect } from "./path";

/**
 * The "···" that says the text did not fit (ADR-214).
 *
 * Screen-constant: 18 × 14 px at every zoom, inside the object's bottom-right corner, so
 * a clipped note is recognisable at 25 % and does not shout at 200 %.
 */
export function drawClipMark(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  zoom: number,
  palette: CanvasPalette,
): void {
  const width = 18 / zoom;
  const height = 14 / zoom;
  const inset = 4 / zoom;
  const x = box.x + box.width - width - inset;
  const y = box.y + box.height - height - inset;
  ctx.save();
  ctx.fillStyle = palette.markBg;
  ctx.strokeStyle = palette.markLine;
  ctx.lineWidth = 1 / zoom;
  roundRect(ctx, x, y, width, height, 3 / zoom);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = palette.markLine;
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.arc(x + width / 2 + (index - 1) * 4 / zoom, y + height / 2, 1 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

