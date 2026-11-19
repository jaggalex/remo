import { elevationOf, type Elevation, type Widget } from "@remo/model";
import type { CanvasPalette } from "./palette";
import { deviceScale } from "./path";

/**
 * Shadow geometry of each level, in board units at zoom 1 (ADR-245). The colours are
 * tokens (`canvas-raise-cast`, `canvas-float-cast`); only the shape of the shadow lives
 * here, and it follows the zoom like a note's paper shadow.
 */
export const ELEVATION_SHADOW: Record<Elevation, { offset: number; blur: number }> = {
  raised: { offset: 2, blur: 8 },
  floating: { offset: 10, blur: 28 },
};

/**
 * Cast the shadow of a raised kanban, frame or shape, and nothing else.
 *
 * `trace` builds the object's outline as a fresh path (it may call `beginPath`). The cast is
 * clipped to everything *outside* that outline: a frame's fill is translucent, and a
 * shadow under it would darken its inside. Call it before the object's own fill.
 */
export function castElevation(
  ctx: CanvasRenderingContext2D,
  widget: Pick<Widget, "type" | "style" | "x" | "y" | "width" | "height">,
  zoom: number,
  palette: CanvasPalette,
  trace: () => void,
): void {
  const level = elevationOf(widget);
  if (!level) return;
  const { offset, blur } = ELEVATION_SHADOW[level];
  // Far enough out that no part of the blur is cut by the clip's outer edge.
  const reach = offset + blur * 2;
  const left = widget.x - widget.width / 2 - reach;
  const top = widget.y - widget.height / 2 - reach;
  const scale = deviceScale(ctx, zoom);

  ctx.save();
  trace();
  ctx.rect(left, top, widget.width + reach * 2, widget.height + reach * 2);
  ctx.clip("evenodd");
  ctx.shadowColor = level === "floating" ? palette.floatCast : palette.raiseCast;
  ctx.shadowBlur = blur * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = offset * scale;
  // Opaque, because a shadow's strength is its colour times the fill's alpha. The fill
  // itself lies inside the outline and is clipped away; only its shadow remains.
  ctx.fillStyle = "#000";
  trace();
  ctx.fill();
  ctx.restore();
}
