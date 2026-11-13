/**
 * Text inside a box: one line drawer and one box drawer.
 *
 * Kept apart from the widget switch because both the note/shape box and the text
 * widget draw through them, and because the painter file has a line limit. The font,
 * the padding and the line height come from `textLayout`, so this file places lines
 * and never decides their size.
 */
import type { TextRun, Widget } from "@remo/model";
import {
  DEFAULT_FONT_FAMILY,
  fitNoteFont,
  fontFor,
  layoutRuns,
  lineHeightFor,
  linesClipped,
  notePadding,
  textFloorFor,
  type RichLine,
} from "./textLayout";

/**
 * Draw one line of formatted text.
 *
 * `align` matters for the widget being painted: a sticky note is left-aligned, a
 * text block is centred, so the line is measured twice — once per segment to place
 * it, once in total to shift it.
 */
export function drawRichLine(
  ctx: CanvasRenderingContext2D,
  line: RichLine,
  x: number,
  /** Top of the line box, or its vertical centre when `centre` is set. */
  y: number,
  fontPx: number,
  align: "left" | "center" | "right",
  centre = false,
  family: string = DEFAULT_FONT_FAMILY,
): void {
  let cursor = align === "center" ? x - line.width / 2 : align === "right" ? x - line.width : x;

  // Underline and strikethrough belong to the text's baseline, not to the line box:
  // with the baseline guessed from the box top they drifted into the letters.
  // The ascent must be measured with the font this line is drawn in: measuring it
  // before setting the font used whichever widget painted last, and the first line of
  // every block landed a few pixels off (a fitted label then looked clipped at the top).
  // The ascent is measured against the baseline, so the baseline mode must be set
  // before the probe: with the caller's `top` still active the ascent came out
  // negative and the first line of every block was drawn a few pixels too high.
  let font = fontFor(fontPx, line.segments[0], family);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  const probe = ctx.measureText("Mg");
  const ascent = probe.actualBoundingBoxAscent || fontPx * 0.8;
  const descent = probe.actualBoundingBoxDescent || fontPx * 0.2;
  const baseline = centre ? y + (ascent - descent) / 2 : y + ascent;

  for (const segment of line.segments) {
    // One font per mark set: the first segment already wears the font the probe used,
    // and most lines are plain, so a paint no longer parses the same font per segment.
    const next = fontFor(fontPx, segment, family);
    if (next !== font) {
      ctx.font = next;
      font = next;
    }
    ctx.fillText(segment.text, cursor, baseline);
    const width = ctx.measureText(segment.text).width;

    if (segment.underline || segment.strike) {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(1, fontPx / 14);
      const at = segment.underline ? baseline + fontPx * 0.13 : baseline - fontPx * 0.3;
      ctx.beginPath();
      ctx.moveTo(cursor, at);
      ctx.lineTo(cursor + width, at);
      ctx.stroke();
    }

    cursor += width;
  }
}


/**
 * Draw a widget's text inside its box.
 *
 * Shared by sticky notes and shapes so both get the same Auto sizing, the same three
 * alignments, the same runs and the same underline placement. `clip` keeps text from
 * spilling over a physical object's edge.
 */
export function drawTextInBox(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  box: { x: number; y: number; width: number; height: number },
  family: string,
  options: {
    cap: number;
    align: "left" | "center" | "right";
    vAlign: "top" | "middle" | "bottom";
    clip?: boolean;
  },
): boolean {
  const content = widget.content ?? "";
  const runs: TextRun[] = widget.runs?.length ? widget.runs : content ? [{ text: content }] : [];
  if (!runs.length) return false;

  const explicit = widget.style?.fontSize;
  const size =
    explicit ??
    fitNoteFont(ctx, runs, box.width, box.height, options.cap, textFloorFor(widget), family);

  const padding = notePadding(size);
  const lines = layoutRuns(ctx, runs, Math.max(box.width - padding * 2, 8), size, family);
  const lineHeight = lineHeightFor(size);
  const total = lines.length * lineHeight;
  const startY =
    options.vAlign === "top"
      ? box.y + padding
      : options.vAlign === "bottom"
        ? box.y + box.height - padding - total
        : box.y + (box.height - total) / 2;
  const lineX =
    options.align === "left"
      ? box.x + padding
      : options.align === "right"
        ? box.x + box.width - padding
        : box.x + box.width / 2;

  ctx.save();
  if (options.clip) {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
  }
  ctx.textAlign = "left";
  lines.forEach((line, i) => {
    drawRichLine(ctx, line, lineX, startY + i * lineHeight, size, options.align, false, family);
  });
  ctx.restore();
  // The mark comes from the lines this paint already laid out: asking again through
  // `textClipped` would fit and wrap every label a second time, per frame (ADR-214).
  return linesClipped(lines.length, lineHeight, box.height, padding);
}
