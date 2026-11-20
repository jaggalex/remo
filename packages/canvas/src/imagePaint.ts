import type { Rect, Widget } from "@remo/model";
import { roundRect } from "./path";
import { withAlpha, type CanvasPalette } from "./palette";

/**
 * Painting a picture, and the two states before it can be painted (ADR-249).
 *
 * The painter does no loading and touches no DOM: the app picks a variant from the
 * cache and hands `paintImage` a bitmap or `null`, so the same function serves the
 * screen, an export and a test. The variant rule lives here rather than at the call
 * sites because the screen and the export must agree on it (`spec/images.md` §6).
 */

/** The variants the store keeps, smallest first. */
export type ImageVariant = "w256" | "w1024" | "w2048";

/**
 * The fields an image object carries flat in the widget (ADR-249, §3.2).
 *
 * Declared here, next to their only reader, rather than as a second storage shape:
 * `Widget` stays the one place an object's fields live.
 */
export interface ImageFields {
  fileId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** `#rrggbb`; the instant placeholder while the bitmap loads. */
  dominantColor?: string;
  /** The accessible description, not a caption and never painted. */
  alt?: string;
}

/** Read the image fields from a widget that may or may not be one. */
export function imageFieldsOf(widget: Widget): ImageFields {
  const candidate = widget as Widget & ImageFields;
  return {
    fileId: typeof candidate.fileId === "string" ? candidate.fileId : undefined,
    naturalWidth:
      typeof candidate.naturalWidth === "number" && candidate.naturalWidth > 0
        ? candidate.naturalWidth
        : undefined,
    naturalHeight:
      typeof candidate.naturalHeight === "number" && candidate.naturalHeight > 0
        ? candidate.naturalHeight
        : undefined,
    dominantColor:
      typeof candidate.dominantColor === "string" ? candidate.dominantColor : undefined,
    alt: typeof candidate.alt === "string" ? candidate.alt : undefined,
  };
}

/**
 * The variant for an object's on-screen size.
 *
 * The size is the longest side in device pixels, because that is what has to stay
 * sharp: a 900-unit picture at 200% on a retina screen needs the 2048 variant even
 * though the object is not "big" on the board.
 */
export function imageVariantFor(
  screenWidth: number,
  screenHeight: number,
  devicePixelRatio = 1,
): ImageVariant {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixels = Math.max(0, screenWidth, screenHeight) * dpr;
  if (pixels <= 256) return "w256";
  if (pixels <= 1024) return "w1024";
  return "w2048";
}

/** The variant a widget needs at a camera zoom (screen size is world size × zoom). */
export function imageVariantForWidget(
  widget: Widget,
  zoom: number,
  devicePixelRatio = 1,
): ImageVariant {
  return imageVariantFor(widget.width * zoom, widget.height * zoom, devicePixelRatio);
}

/**
 * What to paint while the variant the size asks for is still loading.
 *
 * A larger decoded file is sharp enough for a smaller box and a smaller one is better
 * than a colour plate; either beats blinking back to the placeholder every time the
 * camera crosses a boundary. The wanted variant is always first (`spec/images.md` §6:
 * "the variant changes only after the new one has loaded").
 */
export function imageVariantFallbacks(variant: ImageVariant): ImageVariant[] {
  if (variant === "w256") return ["w256", "w1024", "w2048"];
  if (variant === "w1024") return ["w1024", "w2048", "w256"];
  return ["w2048", "w1024", "w256"];
}

/**
 * Fit a picture inside its object's box without stretching it.
 *
 * The box is the object; the picture is centred in it. An image object is created at
 * its natural proportion and the resize handle keeps that proportion, so this mostly
 * guards against an imported or half-migrated record.
 */
export function imageFit(box: Rect, naturalWidth: number, naturalHeight: number): Rect {
  if (naturalWidth <= 0 || naturalHeight <= 0 || box.width <= 0 || box.height <= 0) {
    return { ...box };
  }
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** `#rrggbb` only: the value comes from a file row, but a placeholder must not trust it. */
function placeholderColour(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export interface ImagePaintOptions {
  /** The decoded picture, or null while it loads or after it failed. */
  bitmap: ImageBitmap | null;
  dominantColor?: string;
  /** The load failed (or the file is gone), so the placeholder says so. */
  unavailable?: boolean;
  palette: CanvasPalette;
  fontFamily: string;
  /** Copy for the unavailable placeholder; the app passes its translation. */
  unavailableLabel?: string;
}

/**
 * Paint one image object.
 *
 * Three states, one function: the picture (fitted, never stretched), the loading
 * placeholder (the file's dominant colour and a thin glyph) and the unavailable
 * placeholder (a muted plate, a crossed glyph and, when there is room, a sentence).
 * `spec/images.md` §9.6.
 */
export function paintImage(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  zoom: number,
  options: ImagePaintOptions,
): void {
  if (box.width <= 0 || box.height <= 0) return;
  const { palette } = options;
  const radius = Math.min(4, box.width / 8, box.height / 8);

  ctx.save();
  if (options.bitmap) {
    // The picture is contained, not stretched: the object's own proportion is what the
    // resize handle preserved, and a legacy record must not distort it either.
    const bitmap = options.bitmap;
    const fit = imageFit(box, bitmap.width, bitmap.height);
    roundRect(ctx, box.x, box.y, box.width, box.height, radius);
    ctx.clip();
    // A dominant fill under a picture with transparency keeps the object readable
    // against a same-coloured board instead of showing it through.
    if (options.dominantColor) {
      ctx.fillStyle = placeholderColour(options.dominantColor, palette.panel);
      ctx.fillRect(box.x, box.y, box.width, box.height);
    }
    ctx.drawImage(bitmap, fit.x, fit.y, fit.width, fit.height);
    ctx.restore();
    return;
  }

  if (options.unavailable) {
    ctx.fillStyle = palette.hover;
    roundRect(ctx, box.x, box.y, box.width, box.height, radius);
    ctx.fill();
    ctx.strokeStyle = palette.borderSubtle;
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();

    const screenWidth = box.width * zoom;
    const iconSize = Math.min(44, box.width * 0.32, box.height * 0.32);
    const label = options.unavailableLabel ?? "Image unavailable";
    const withLabel = screenWidth >= 120 && box.height * zoom >= 56;
    const centreY = withLabel ? box.y + box.height / 2 - iconSize * 0.35 : box.y + box.height / 2;
    drawGlyph(ctx, box.x + box.width / 2, centreY, iconSize, palette.textMuted, 1 / zoom, true);

    if (withLabel) {
      ctx.fillStyle = palette.textSecondary;
      ctx.font = `400 ${Math.min(13, Math.max(9, box.height / 5))}px ${options.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, box.x + box.width / 2, centreY + iconSize * 0.62 + 10 / zoom);
    }
    ctx.restore();
    return;
  }

  // Loading: the dominant colour is known from the file row, so the object appears in
  // its own colour before a single byte has arrived.
  ctx.fillStyle = placeholderColour(options.dominantColor, palette.hover);
  roundRect(ctx, box.x, box.y, box.width, box.height, radius);
  ctx.fill();

  const iconSize = Math.min(40, box.width * 0.3, box.height * 0.3);
  drawGlyph(
    ctx,
    box.x + box.width / 2,
    box.y + box.height / 2,
    iconSize,
    withAlpha(palette.textMuted, 0.6),
    1 / zoom,
    false,
  );
  ctx.restore();
}

/**
 * The thin picture glyph: a frame, a hill and a sun.
 *
 * Drawn rather than loaded from an icon file because the canvas paints in world units
 * and has to stay legible at any zoom; a crossed diagonal turns it into "unavailable".
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  size: number,
  colour: string,
  hairline: number,
  crossed: boolean,
): void {
  if (size < 8) return;
  const width = size;
  const height = size * 0.76;
  const left = centreX - width / 2;
  const top = centreY - height / 2;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(hairline, size * 0.055);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  roundRect(ctx, left, top, width, height, size * 0.1);
  ctx.stroke();

  // Sun.
  ctx.beginPath();
  ctx.arc(left + width * 0.72, top + height * 0.3, size * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Hill: a line from the lower left to a peak and down to the lower right.
  ctx.beginPath();
  ctx.moveTo(left + width * 0.12, top + height * 0.78);
  ctx.lineTo(left + width * 0.42, top + height * 0.45);
  ctx.lineTo(left + width * 0.62, top + height * 0.68);
  ctx.lineTo(left + width * 0.74, top + height * 0.56);
  ctx.lineTo(left + width * 0.9, top + height * 0.78);
  ctx.stroke();

  if (crossed) {
    ctx.beginPath();
    ctx.moveTo(left + width * 0.16, top + height * 0.18);
    ctx.lineTo(left + width * 0.84, top + height * 0.82);
    ctx.stroke();
  }
  ctx.restore();
}
