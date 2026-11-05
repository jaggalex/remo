import {
  formatRemaining,
  inkFor,
  shade,
  stickyFill,
  stickyFontCap,
  timerPhase,
  timerRemainingMs,
  type CardStatus,
  type TextRun,
  type Widget,
} from "@remo/model";
import { drawCardMeta } from "./cardMeta";
import { arrowHead, connectorPath, labelPoint, type ConnectorPath } from "./connectors";
import { DEFAULT_PALETTE, withAlpha, type CanvasPalette } from "./palette";
import {
  DEFAULT_FONT_FAMILY,
  fontFor,
  layoutRuns,
  lineHeightFor,
  fitNoteFont,
  notePadding,
  type RichLine,
} from "./textLayout";

/**
 * Stacking order.
 *
 * The base order per type lives in the model (`layers.ts`) because it is not only a
 * painting detail any more: bring-to-front writes explicit layers, and the document
 * commands have to agree with the painter about what "above" means (ADR-039). These
 * re-exports keep the canvas package's API the same for its callers.
 */
export { PAINT_RANK, layerKey, paintOrder, rankOf } from "@remo/model";

/**
 * Draw one line of formatted text.
 *
 * `align` matters for the widget being painted: a sticky note is left-aligned, a
 * text block is centred, so the line is measured twice — once per segment to place
 * it, once in total to shift it.
 */
function drawRichLine(
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
  const probe = ctx.measureText("Mg");
  const ascent = probe.actualBoundingBoxAscent || fontPx * 0.8;
  const descent = probe.actualBoundingBoxDescent || fontPx * 0.2;
  const baseline = centre ? y + (ascent - descent) / 2 : y + ascent;

  ctx.textBaseline = "alphabetic";

  for (const segment of line.segments) {
    ctx.font = fontFor(fontPx, segment, family);
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
 * Outline left where a dragged object used to be.
 *
 * The object itself follows the pointer, so the original place has to keep saying
 * "something came from here" — without it, a drag looks like a copy. Neutral grey and
 * a dashed hairline, like a shadow rather than a second object. `radius` matches the
 * shape of what was lifted: cards are pills, everything else is a rectangle.
 */
export function drawDragOrigin(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  zoom: number,
  radius = 0,
  palette: CanvasPalette = DEFAULT_PALETTE,
): void {
  ctx.save();
  ctx.fillStyle = withAlpha(palette.textSecondary, 0.07);
  ctx.strokeStyle = withAlpha(palette.textSecondary, 0.6);
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  if (radius > 0) {
    roundRect(ctx, box.x, box.y, box.width, box.height, Math.min(radius, box.height / 2));
  } else {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * One alignment guide, drawn as a dashed line in the accent colour.
 *
 * The line is a hairline regardless of zoom, but the dash pattern is scaled so it
 * keeps the same rhythm on screen instead of turning into a solid stroke when zoomed
 * out or into long dashes when zoomed in.
 */
export function drawGuide(
  ctx: CanvasRenderingContext2D,
  guide: { axis: "x" | "y"; position: number; from: number; to: number },
  zoom: number,
  palette: CanvasPalette = DEFAULT_PALETTE,
): void {
  ctx.save();
  ctx.strokeStyle = palette.selectionStroke;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  if (guide.axis === "x") {
    ctx.moveTo(guide.position, guide.from);
    ctx.lineTo(guide.position, guide.to);
  } else {
    ctx.moveTo(guide.from, guide.position);
    ctx.lineTo(guide.to, guide.position);
  }
  ctx.stroke();
  ctx.restore();
}

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

/** Greedy word wrap; returns the lines that fit into `maxLines`. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 99,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) return lines;
      }
    }
    lines.push(line);
    if (lines.length >= maxLines) return lines;
  }
  return lines.slice(0, maxLines);
}

/** Truncate to one line so a caption never overflows its plate. */
function fitOneLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

export interface DrawWidgetOptions {
  /** Looks up a widget by id — connectors need their endpoints' boxes. */
  resolve?: (id: string) => Widget | undefined;
  selectedIds?: readonly string[];
  /** Font family and text-size caps chosen in settings. */
  theme?: PaintTheme;
}

/** Visual defaults that come from the person's settings. */
export interface PaintTheme {
  fontFamily: string;
  fontCap: { S: number; M: number; L: number };
  shapeStrokeWidth: number;
  /** Copy shown in an empty card; the app passes its translation. */
  cardPlaceholder: string;
  /** Copy shown on a finished shared timer; the app passes its translation. */
  timerExpired: string;
  /** Card status labels, passed by the app so the canvas stays language-neutral. */
  cardStatus: Record<CardStatus, string>;
  /** Colours resolved from the design-system tokens (`readCanvasTokens()`). */
  palette: CanvasPalette;
}

export const DEFAULT_THEME: PaintTheme = {
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
  fontCap: { S: 13, M: 16, L: 20 },
  shapeStrokeWidth: 2,
  cardPlaceholder: "Type something",
  timerExpired: "Time is up",
  cardStatus: { todo: "To do", in_progress: "In progress", done: "Done" },
  palette: DEFAULT_PALETTE,
};

/** Stroke a connector path: a polyline, or a cubic curve when it has one. */
function drawPath(ctx: CanvasRenderingContext2D, path: ConnectorPath): void {
  ctx.beginPath();
  const start = path.points[0]!;
  ctx.moveTo(start.x, start.y);
  if (path.curve) {
    const { c1, c2, to } = path.curve;
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    return;
  }
  for (let i = 1; i < path.points.length; i += 1) {
    ctx.lineTo(path.points[i]!.x, path.points[i]!.y);
  }
}

function fillHead(
  ctx: CanvasRenderingContext2D,
  head: { x: number; y: number }[],
  colour: string,
): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(head[0]!.x, head[0]!.y);
  ctx.lineTo(head[1]!.x, head[1]!.y);
  ctx.lineTo(head[2]!.x, head[2]!.y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a widget's text inside its box.
 *
 * Shared by sticky notes and shapes so both get the same Auto sizing, the same three
 * alignments, the same runs and the same underline placement. `clip` keeps text from
 * spilling over a physical object's edge.
 */
function drawTextInBox(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  box: { x: number; y: number; width: number; height: number },
  theme: PaintTheme,
  options: {
    cap: number;
    align: "left" | "center" | "right";
    vAlign: "top" | "middle" | "bottom";
    clip?: boolean;
  },
): void {
  const content = widget.content ?? "";
  const runs: TextRun[] = widget.runs?.length ? widget.runs : content ? [{ text: content }] : [];
  if (!runs.length) return;

  const explicit = widget.style?.fontSize;
  const size =
    explicit ?? fitNoteFont(ctx, runs, box.width, box.height, options.cap, undefined, theme.fontFamily);

  const padding = notePadding(size);
  const lines = layoutRuns(ctx, runs, Math.max(box.width - padding * 2, 8), size, theme.fontFamily);
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
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    drawRichLine(ctx, line, lineX, startY + i * lineHeight, size, options.align, false, theme.fontFamily);
  });
  ctx.restore();
}

/** Widgets whose paint already failed once; logged once each, not every frame. */
const failedPaints = new Set<string>();

/**
 * Paint one widget, isolated from every other (ADR-171).
 *
 * The board is painted in one loop on one frame. Without this boundary, one object the
 * painter cannot handle threw out of the loop and left the canvas empty for every
 * client in the room, on every frame, because the object is shared. Now the failure
 * costs that object only: the canvas state is restored, the rest of the board paints,
 * and the error is reported once per object so it reaches a bug report.
 */
export function drawWidget(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  zoom: number,
  options: DrawWidgetOptions = {},
): void {
  ctx.save();
  try {
    paintWidget(ctx, widget, zoom, options);
  } catch (error) {
    if (!failedPaints.has(widget.id)) {
      failedPaints.add(widget.id);
      console.error(`[canvas] could not paint ${widget.type} ${widget.id}`, error);
    }
  } finally {
    ctx.restore();
  }
}

function paintWidget(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  zoom: number,
  options: DrawWidgetOptions,
): void {
  const left = widget.x - widget.width / 2;
  const top = widget.y - widget.height / 2;
  const selected = options.selectedIds?.includes(widget.id) ?? false;
  const theme = options.theme ?? DEFAULT_THEME;
  const palette = theme.palette;

  switch (widget.type) {
    case "timer": {
      // One card, painted from the stored `endsAt` rather than from a local countdown:
      // two clients, a late joiner and a reconnect all show the same second (ADR-075).
      const timer = widget.timer;
      const phase = timerPhase(timer);
      const expires = phase === "expired";
      ctx.save();
      ctx.fillStyle = palette.panel;
      roundRect(ctx, left, top, widget.width, widget.height, 10);
      ctx.fill();
      ctx.strokeStyle = expires ? palette.danger : palette.borderStrong;
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();

      const pad = 14;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = expires ? palette.danger : palette.textPrimary;
      const value = expires ? "00:00" : formatRemaining(timerRemainingMs(timer));
      const size = Math.min(46, widget.height * 0.42);
      ctx.font = `600 ${size}px ${theme.fontFamily}`;
      ctx.fillText(value, left + pad, top + pad);

      const caption = expires
        ? theme.timerExpired
        : phase === "paused"
          ? `${timer?.setBy ?? ""}`.trim()
          : `${timer?.setBy ?? ""}`.trim();
      ctx.font = `400 ${Math.max(9, Math.min(13, size * 0.28))}px ${theme.fontFamily}`;
      ctx.fillStyle = palette.textSecondary;
      ctx.fillText(caption, left + pad, top + widget.height - pad - 12);

      if (phase === "running" || phase === "paused") {
        ctx.fillStyle = phase === "running" ? palette.accent : palette.warning;
        ctx.beginPath();
        ctx.arc(left + widget.width - pad - 4, top + pad + 4, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "frame": {
      ctx.fillStyle = withAlpha(palette.panel, 0.72);
      roundRect(ctx, left, top, widget.width, widget.height, 6);
      ctx.fill();
      ctx.strokeStyle = palette.borderStrong;
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      break;
    }
    case "sticky_note": {
      const fill = stickyFill(widget.style?.fillColor);
      ctx.save();
      ctx.shadowColor = withAlpha(palette.textPrimary, 0.18);
      ctx.shadowBlur = 6 / zoom;
      ctx.shadowOffsetY = 2 / zoom;
      ctx.fillStyle = fill;
      roundRect(ctx, left, top, widget.width, widget.height, 3);
      ctx.fill();
      ctx.restore();

      // A note has an edge: without one a pale note on the board's pale background is
      // a rectangle you have to guess at (ADR-030).
      ctx.strokeStyle = shade(fill, -0.16);
      ctx.lineWidth = 1 / zoom;
      roundRect(ctx, left + 0.5 / zoom, top + 0.5 / zoom, widget.width - 1 / zoom, widget.height - 1 / zoom, 3);
      ctx.stroke();

      // The text colour follows the fill unless it was chosen: a deep note with dark
      // text is a note whose content nobody can read (ADR-038).
      ctx.fillStyle = inkFor(fill, widget.style?.textColor);

      // Notes and shapes share one text block: same Auto sizing, same alignment,
      // same runs. Two implementations would drift (ADR-033).
      drawTextInBox(ctx, widget, { x: left, y: top, width: widget.width, height: widget.height }, theme, {
        cap: theme.fontCap[widget.style?.stickySize ?? "M"] ?? stickyFontCap(widget.style?.stickySize),
        align: widget.style?.textAlign ?? "center",
        vAlign: widget.style?.textVAlign ?? "middle",
        clip: true,
      });
      break;
    }
    case "text": {
      const size = widget.style?.fontSize ?? 16;
      ctx.fillStyle = widget.style?.color ?? palette.textPrimary;
      const runs: TextRun[] = widget.runs?.length
        ? widget.runs
        : [{ text: widget.title ?? widget.content ?? "" }];
      const hAlign = widget.style?.textAlign ?? "center";
      const lines = layoutRuns(ctx, runs, widget.width, size, theme.fontFamily);
      const lineHeight = size * 1.28;
      const offset = ((lines.length - 1) * lineHeight) / 2;
      const lineX =
        hAlign === "left" ? left : hAlign === "right" ? left + widget.width : widget.x;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      lines.forEach((line, i) => {
        drawRichLine(ctx, line, lineX, widget.y - offset + i * lineHeight, size, hAlign, true, theme.fontFamily);
      });
      break;
    }
    case "kanban": {
      ctx.fillStyle = palette.panel;
      ctx.strokeStyle = palette.borderSubtle;
      ctx.lineWidth = 1 / zoom;
      roundRect(ctx, left, top, widget.width, widget.height, 8);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = palette.borderSubtle;
      for (let i = 1; i < 3; i += 1) {
        const x = left + (widget.width / 3) * i;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + widget.height);
        ctx.stroke();
      }
      break;
    }
    case "card": {
      // `theme` is the paint theme here; a card's theme is its outline colour.
      const cardTheme = widget.style?.cardTheme ?? "#ffdd33";
      ctx.fillStyle = palette.panel;
      ctx.strokeStyle = cardTheme;
      ctx.lineWidth = 1.5 / zoom;
      roundRect(ctx, left, top, widget.width, widget.height, widget.height / 2.6);
      ctx.fill();
      ctx.stroke();
      const titleY = drawCardMeta(
        ctx,
        left,
        top,
        widget.width,
        widget.height,
        widget,
        { fontFamily: theme.fontFamily, palette, statusLabel: theme.cardStatus },
        zoom,
      );
      if (widget.title) {
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `13px ${theme.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const lines = wrapText(ctx, widget.title, widget.width - 24, 2);
        lines.forEach((line, i) => {
          ctx.fillText(line, left + 12, titleY + (i - (lines.length - 1) / 2) * 16);
        });
      } else {
        // The same placeholder the matrix paints, so a carried empty card does not
        // turn into a blank pill mid-drag.
        ctx.fillStyle = palette.textMuted;
        ctx.font = `13px ${theme.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(theme.cardPlaceholder, left + 12, titleY);
      }
      break;
    }
    case "shape": {
      const fill = widget.style?.fillColor ?? palette.panel;
      const stroke = widget.style?.strokeColor ?? palette.textPrimary;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      // Same rule as a connector: the outline is part of the object, so it scales,
      // with a pixel floor so a shape never loses its edge when zoomed out.
      ctx.lineWidth = Math.max(widget.style?.strokeWidth ?? theme.shapeStrokeWidth, 1 / zoom);
      // A dashed outline is the same decision as a dashed line (ADR-120): world units,
      // so the pattern scales with the shape instead of staying screen-sized.
      const dash = widget.style?.strokeStyle;
      if (dash === "dashed") ctx.setLineDash([8, 6]);
      else if (dash === "dotted") ctx.setLineDash([2, 5]);

      const kind = widget.shapeKind ?? "rectangle";
      if (kind === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(widget.x, widget.y, widget.width / 2, widget.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (kind === "diamond" || kind === "triangle") {
        ctx.beginPath();
        if (kind === "diamond") {
          ctx.moveTo(widget.x, top);
          ctx.lineTo(left + widget.width, widget.y);
          ctx.lineTo(widget.x, top + widget.height);
          ctx.lineTo(left, widget.y);
        } else {
          ctx.moveTo(widget.x, top);
          ctx.lineTo(left + widget.width, top + widget.height);
          ctx.lineTo(left, top + widget.height);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        roundRect(ctx, left, top, widget.width, widget.height, kind === "round_rectangle" ? widget.height * 0.3 : 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (widget.content || widget.runs?.length) {
        ctx.fillStyle = inkFor(fill, widget.style?.textColor);
        drawTextInBox(ctx, widget, { x: left, y: top, width: widget.width, height: widget.height }, theme, {
          cap: theme.fontCap.M,
          align: widget.style?.textAlign ?? "center",
          vAlign: widget.style?.textVAlign ?? "middle",
          clip: true,
        });
      }
      break;
    }
    case "connector": {
      // Derived from the endpoints, so it follows them without extra writes.
      const resolve = options.resolve;
      const path = resolve ? connectorPath(widget, resolve) : null;
      if (!path) break;

      // A line's thickness, its dashes and its arrow head are properties of the
      // *object*, not of the screen: zooming out must make the whole line smaller,
      // head included. Dividing by zoom here made a head the same 14 pixels at every
      // scale, so at 25% the arrows dwarfed the notes they pointed at (ADR-052).
      const stroke = widget.style?.strokeColor ?? palette.textPrimary;
      const strokeStyle = widget.style?.strokeStyle;

      // Selection is shown along the line, not around its box: a curved connector
      // bows outside the chord, so its bounding box outlines empty space and reads
      // as a second, wrong line (ADR-042).
      if (selected) {
        ctx.save();
        ctx.strokeStyle = withAlpha(palette.selectionStroke, 0.22);
        ctx.lineWidth = ((widget.style?.strokeWidth ?? 2) + 10) / zoom;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        drawPath(ctx, path);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = stroke;
      // World units, with a one-device-pixel floor: a 2-unit line at 13% is 0.26px,
      // which all but disappears, and an invisible line is worse than a slightly
      // thick one (ADR-052).
      ctx.lineWidth = Math.max(widget.style?.strokeWidth ?? 2, 1 / zoom);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (strokeStyle === "dashed") ctx.setLineDash([8, 6]);
      else if (strokeStyle === "dotted") ctx.setLineDash([2, 5]);
      drawPath(ctx, path);
      ctx.stroke();
      ctx.setLineDash([]);

      const size = 14;
      const first = path.points[0]!;
      const last = path.points[path.points.length - 1]!;
      // The head points along the last segment, not along the chord: on an elbow
      // or a curve those are different directions.
      const beforeLast = path.points[path.points.length - 2] ?? first;
      const afterFirst = path.points[1] ?? last;

      if (widget.arrow === "end" || widget.arrow === "both") {
        fillHead(ctx, arrowHead(last, beforeLast, size), stroke);
      }
      if (widget.arrow === "start" || widget.arrow === "both") {
        fillHead(ctx, arrowHead(first, afterFirst, size), stroke);
      }

      // A connector can carry text: a chip on its own path, so the label keeps its
      // place when either end moves. Its size and colour are the object's, like a
      // note's (ADR-041, ADR-043).
      const label = widget.content?.trim();
      if (label) {
        const at = labelPoint(path, widget.labelAt);
        const fontPx = widget.style?.fontSize ?? 13;
        ctx.font = `500 ${fontPx}px ${theme.fontFamily}`;
        const text = fitOneLine(ctx, label, 260);
        const textWidth = ctx.measureText(text).width;
        const padX = fontPx * 0.46;
        const padY = fontPx * 0.3;
        const chipWidth = textWidth + padX * 2;
        const chipHeight = fontPx + padY * 2;
        ctx.fillStyle = withAlpha(palette.panel, 0.96);
        ctx.strokeStyle = withAlpha(palette.textPrimary, 0.12);
        ctx.lineWidth = 1 / zoom;
        roundRect(ctx, at.x - chipWidth / 2, at.y - chipHeight / 2, chipWidth, chipHeight, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = widget.style?.textColor ?? palette.textPrimary;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, at.x, at.y + 0.5);
      }
      break;
    }
    case "stamp": {
      // A sticker: a tinted plate with an optional caption. It has no glyph or
      // reaction count — those came from the captured templates and are gone.
      const size = Math.min(widget.width, widget.height);
      const tint = widget.style?.fillColor ?? "#ffdd33";
      const radius = size * 0.22;

      ctx.fillStyle = withAlpha(tint, 0.22);
      ctx.strokeStyle = withAlpha(tint, 0.55);
      ctx.lineWidth = 2 / zoom;
      roundRect(ctx, left, top, widget.width, widget.height, radius);
      ctx.fill();
      ctx.stroke();

      if (widget.label) {
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `600 ${size * 0.115}px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const caption = fitOneLine(ctx, widget.label, widget.width - 10);
        ctx.fillText(caption, widget.x, top + widget.height * 0.78);
      }
      break;
    }
    case "unsupported": {
      if (widget.label) {
        // A vertical plate naming a roadmap horizon.
        ctx.save();
        ctx.translate(widget.x, widget.y);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = palette.panel;
        ctx.strokeStyle = palette.borderSubtle;
        ctx.lineWidth = 1 / zoom;
        roundRect(ctx, -widget.height / 2, -widget.width / 2, widget.height, widget.width, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = palette.textSecondary;
        ctx.font = `600 ${Math.min(widget.width * 0.5, 22)}px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(widget.label, 0, 0);
        ctx.restore();
        break;
      }

      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeStyle = palette.borderStrong;
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(left, top, widget.width, widget.height);
      ctx.setLineDash([]);
      break;
    }
    default: {
      ctx.fillStyle = palette.hover;
      ctx.strokeStyle = palette.borderStrong;
      ctx.lineWidth = 1 / zoom;
      roundRect(ctx, left, top, widget.width, widget.height, 4);
      ctx.fill();
      ctx.stroke();
    }
  }

  // A connector shows its selection along the path (above), so it never gets a box.
  if (selected && widget.type !== "connector") {
    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(left - 2 / zoom, top - 2 / zoom, widget.width + 4 / zoom, widget.height + 4 / zoom);
  }
}
