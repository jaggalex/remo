import type { Presence } from "@remo/doc";
import type { CanvasPalette } from "@remo/canvas";
import { DEFAULT_PALETTE } from "@remo/canvas";

/**
 * Another person's cursor.
 *
 * Drawn on the overlay, in their colour, with their name — the only thing on the board
 * that belongs to somebody else's pointer riding on top of everything (ADR-056).
 */
export function drawRemoteCursor(
  ctx: CanvasRenderingContext2D,
  peer: Presence,
  zoom: number,
  palette: CanvasPalette = DEFAULT_PALETTE,
  fontFamily = 'Inter, "Helvetica Neue", Arial, sans-serif',
): void {
  if (!peer.cursor) return;
  const { x, y } = peer.cursor;
  const size = 6 / zoom;
  ctx.save();
  ctx.fillStyle = peer.color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + size * 1.6, y + size * 0.6);
  ctx.lineTo(x + size * 0.6, y + size * 1.6);
  ctx.closePath();
  ctx.fill();

  if (peer.label) {
    ctx.font = `600 ${11 / zoom}px ${fontFamily}`;
    const labelWidth = ctx.measureText(peer.label).width + 10 / zoom;
    const labelHeight = 16 / zoom;
    ctx.fillStyle = peer.color;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.roundRect(x + size * 1.4, y + size * 1.2, labelWidth, labelHeight, 4 / zoom);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.textOnPresence;
    ctx.textBaseline = "middle";
    ctx.fillText(peer.label, x + size * 1.4 + 5 / zoom, y + size * 1.2 + labelHeight / 2);
  }
  ctx.restore();
}
