import type { Presence } from "@remo/doc";
import type { CanvasPalette } from "@remo/canvas";
import { DEFAULT_FONT_FAMILY, DEFAULT_PALETTE } from "@remo/canvas";
import { initials } from "./format";

/**
 * Another person's cursor.
 *
 * Drawn on the overlay, riding on top of everything (ADR-056). The shape is the asset in
 * `docs/design/assets/cursors/remo-remote-cursor.svg` (ADR-181): an ink arrow in a white
 * halo pointing up and right, a node at the tip, and the person's mark — a white circle with
 * their initials and one ring in their colour, the same mark as their avatar. The size is in
 * screen pixels, so it does not grow or shrink with zoom. Colour is only the ring: the
 * initials tell two people apart without it.
 */

/** The arrow, tip at the origin; screen pixels. */
const ARROW: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-19.5, 8.5],
  [-13, 11],
  [-15.5, 17.5],
  [-12.5, 19],
  [-9.7, 12.6],
  [-4.5, 18.5],
];
/** The node and the mark, relative to the tip. */
export const REMOTE_CURSOR = {
  halo: 5,
  node: { x: 3, y: -3, r: 2.25 },
  mark: { x: 11, y: -7, r: 9, ring: 1.5, font: 7.5 },
} as const;

export function drawRemoteCursor(
  ctx: CanvasRenderingContext2D,
  peer: Presence,
  zoom: number,
  palette: CanvasPalette = DEFAULT_PALETTE,
  fontFamily = DEFAULT_FONT_FAMILY,
): void {
  if (!peer.cursor) return;
  const { x, y } = peer.cursor;
  const px = 1 / zoom;
  const ink = palette.textPrimary;
  const halo = palette.panel;
  const at = (dx: number, dy: number) => [x + dx * px, y + dy * px] as const;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.beginPath();
  ARROW.forEach(([dx, dy], i) => {
    const [ax, ay] = at(dx, dy);
    if (i === 0) ctx.moveTo(ax, ay);
    else ctx.lineTo(ax, ay);
  });
  ctx.closePath();
  ctx.strokeStyle = halo;
  ctx.lineWidth = REMOTE_CURSOR.halo * px;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = px;
  ctx.stroke();

  const { node, mark } = REMOTE_CURSOR;
  const [nx, ny] = at(node.x, node.y);
  ctx.beginPath();
  ctx.arc(nx, ny, node.r * px, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.strokeStyle = halo;
  ctx.lineWidth = 1.5 * px;
  ctx.stroke();

  const [mx, my] = at(mark.x, mark.y);
  ctx.beginPath();
  ctx.arc(mx, my, mark.r * px, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();
  ctx.strokeStyle = peer.color;
  ctx.lineWidth = mark.ring * px;
  ctx.stroke();

  const letters = initials(peer.label ?? "");
  if (letters) {
    ctx.font = `600 ${mark.font * px}px ${fontFamily}`;
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letters, mx, my + 0.3 * px);
  }
  ctx.restore();
}
