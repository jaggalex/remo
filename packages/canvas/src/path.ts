/** Shared 2D path helpers. */

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * Device pixels per world unit. Shadows are not transformed by the canvas matrix, so a
 * shadow that belongs to an object is multiplied by this to follow the object.
 */
export function deviceScale(ctx: CanvasRenderingContext2D, zoom: number): number {
  const matrix = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  return matrix ? Math.hypot(matrix.a, matrix.b) : zoom;
}
