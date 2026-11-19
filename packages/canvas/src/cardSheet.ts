import { DEFAULT_PALETTE, type CanvasPalette } from "./palette";
import { deviceScale, roundRect } from "./path";

/** `radius-md`: a card is a sheet with soft corners, not a pill (DESIGN.md §8). */
export const CARD_RADIUS = 10;
/**
 * The card's shadow under its bottom edge, in board units at zoom 1. The sticky note's
 * warm paper shadow (ADR-181), shorter, because a card is a thinner, smaller sheet.
 */
export const CARD_SHADOW = { offset: 3, blur: 8 } as const;
/** The selection frame, in screen pixels, drawn outside the sheet. */
const SELECTION_WIDTH = 2;

/**
 * One card face for every path that paints a card: the kanban matrix and the `card`
 * widget (ADR-234). Paper without an outline; the only frame a card ever has is the
 * selection, drawn outside the sheet so it does not eat into the content.
 */
export function drawCardSheet(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  zoom: number,
  options: { palette?: CanvasPalette; selected?: boolean } = {},
): void {
  const palette = options.palette ?? DEFAULT_PALETTE;
  const scale = deviceScale(ctx, zoom);
  ctx.save();
  ctx.shadowColor = palette.stickerCast;
  ctx.shadowBlur = CARD_SHADOW.blur * scale;
  ctx.shadowOffsetY = CARD_SHADOW.offset * scale;
  // `raised`, not `panel`: the card lies on the kanban's `panel` ground. In light both are
  // white and the shadow separates them; in dark the shadow barely shows, so the sheet
  // is one step lighter instead of outlined.
  ctx.fillStyle = palette.raised;
  roundRect(ctx, box.x, box.y, box.width, box.height, CARD_RADIUS);
  ctx.fill();
  ctx.restore();

  if (options.selected) {
    const width = SELECTION_WIDTH / zoom;
    const out = width / 2;
    ctx.save();
    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = width;
    roundRect(ctx, box.x - out, box.y - out, box.width + out * 2, box.height + out * 2, CARD_RADIUS + out);
    ctx.stroke();
    ctx.restore();
  }
}
