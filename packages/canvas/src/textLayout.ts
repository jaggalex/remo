/**
 * Text layout for note-like widgets.
 *
 * Kept in one place because two callers must agree exactly: the painter draws with
 * these metrics, and the editor asks them how tall the note should be. If the two
 * disagreed, a note would grow a little on every keystroke or jitter as you type.
 */
import type { TextMarks, TextRun, Widget } from "@remo/model";
import { measureContext } from "./measure";

export const STICKY_FONT_PX = 16;
export const STICKY_LINE_HEIGHT = 20;
export const STICKY_PADDING = 12;
/** Room for the drop shadow and the last line's descenders. */
export const STICKY_BOTTOM_PADDING = 8;

export interface TextMetrics {
  lines: string[];
  lineHeight: number;
  /** Height the note needs to show `lines` without clipping. */
  height: number;
}

/** Greedy word wrap; long words are broken rather than allowed to overflow. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);

      // A single word wider than the note is split at the boundary.
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }

  return lines;
}

export function stickyMetrics(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): TextMetrics {
  const maxWidth = Math.max(width - STICKY_PADDING * 2, 16);
  const previousFont = ctx.font;
  ctx.font = `${STICKY_FONT_PX}px "Helvetica Neue", Arial, sans-serif`;
  const lines = text ? wrapLines(ctx, text, maxWidth) : [];
  ctx.font = previousFont;

  return {
    lines,
    lineHeight: STICKY_LINE_HEIGHT,
    height: Math.max(
      lines.length * STICKY_LINE_HEIGHT + STICKY_PADDING * 2 + STICKY_BOTTOM_PADDING,
      STICKY_LINE_HEIGHT * 3,
    ),
  };
}

/**
 * Height a note needs, measured off-screen.
 *
 * The editor needs a measuring context but must not depend on a canvas being
 * mounted, so a 1x1 scratch canvas is used.
 */

/**
 * Height a note needs to show `text` without clipping.
 *
 * Callers decide whether to apply it: typing grows a note, it never shrinks one
 * (see the note in `setWidgetText`).
 */
export function stickyHeightFor(text: string, width: number): number | null {
  const ctx = measureContext();
  if (!ctx) return null;
  return stickyMetrics(ctx, text, width).height;
}

/* ------------------------------------------------------------ rich text ---- */

/** A run of formatted text: the painter draws each segment with its own font. */
export interface TextSegment extends TextMarks {
  text: string;
}

/** One laid-out line of rich text. */
export interface RichLine {
  segments: TextSegment[];
  width: number;
}

/** Canvas font string for a mark set, so the painter and the metrics agree. */
export function fontFor(
  fontPx: number,
  marks?: TextMarks,
  family: string = DEFAULT_FONT_FAMILY,
): string {
  const parts: string[] = [];
  if (marks?.italic) parts.push("italic");
  if (marks?.bold) parts.push("bold");
  parts.push(`${fontPx}px ${family}`);
  return parts.join(" ");
}

/**
 * The typeface of text on the board: Golos Text, the design system's `font-sans` (ADR-181),
 * so a note reads in the same letters as the chrome around it. Inter stays second for a
 * browser that cannot load the woff2. The app passes the family chosen in settings.
 */
export const DEFAULT_FONT_FAMILY = '"Golos Text", Inter, "Helvetica Neue", Arial, sans-serif';

/** Stacks that were the default before; a stored copy of one is not a person's choice. */
export const PREVIOUS_FONT_FAMILIES: readonly string[] = [
  '"Helvetica Neue", Arial, sans-serif',
  'Inter, "Helvetica Neue", Arial, sans-serif',
];

function marksOf(segment: TextMarks): TextMarks {
  const out: TextMarks = {};
  if (segment.bold) out.bold = true;
  if (segment.italic) out.italic = true;
  if (segment.underline) out.underline = true;
  if (segment.strike) out.strike = true;
  return out;
}

function segmentKey(marks: TextMarks): string {
  return `${marks.bold ? "b" : ""}${marks.italic ? "i" : ""}${marks.underline ? "u" : ""}${marks.strike ? "s" : ""}`;
}

/**
 * Greedy wrap over formatted text.
 *
 * Word-by-word, not run-by-run: a bold word in the middle of a sentence has to wrap
 * with its neighbours, so the runs are flattened into tokens that carry their marks
 * and measured with the font those marks produce.
 */
export function layoutRuns(
  ctx: CanvasRenderingContext2D,
  runs: readonly TextRun[],
  maxWidth: number,
  fontPx: number = STICKY_FONT_PX,
  family: string = DEFAULT_FONT_FAMILY,
): RichLine[] {
  const lines: RichLine[] = [];
  let current: RichLine = { segments: [], width: 0 };

  const measure = (text: string, marks: TextMarks): number => {
    ctx.font = fontFor(fontPx, marks, family);
    return ctx.measureText(text).width;
  };

  const addSegment = (text: string, marks: TextMarks, width: number): void => {
    const last = current.segments[current.segments.length - 1];
    if (last && segmentKey(last) === segmentKey(marks)) {
      last.text += text;
    } else {
      current.segments.push({ text, ...marks });
    }
    current.width += width;
  };

  const pushLine = (): void => {
    lines.push(current);
    current = { segments: [], width: 0 };
  };

  for (const run of runs) {
    if (!run.text) continue;
    const marks = marksOf(run);
    const paragraphs = run.text.split("\n");

    paragraphs.forEach((paragraph, index) => {
      if (index > 0) pushLine();
      if (!paragraph) return;

      for (const token of paragraph.split(/(\s+)/).filter((part) => part.length)) {
        const isSpace = /^\s+$/.test(token);
        let width = measure(token, marks);

        if (!isSpace && current.width > 0 && current.width + width > maxWidth) pushLine();

        // A word wider than the note is broken at the boundary, like the plain path.
        if (!isSpace && width > maxWidth) {
          let rest = token;
          while (measure(rest, marks) > maxWidth && rest.length > 1) {
            let cut = rest.length;
            while (cut > 1 && measure(rest.slice(0, cut), marks) > maxWidth) cut -= 1;
            addSegment(rest.slice(0, cut), marks, measure(rest.slice(0, cut), marks));
            pushLine();
            rest = rest.slice(cut);
          }
          if (rest) {
            width = measure(rest, marks);
            addSegment(rest, marks, width);
          }
          continue;
        }

        addSegment(token, marks, width);
      }
    });
  }

  lines.push(current);
  return lines;
}

/** Lines and height for formatted note text, with the plain metrics' numbers. */
export function richMetrics(
  ctx: CanvasRenderingContext2D,
  runs: readonly TextRun[],
  width: number,
  fontPx: number = STICKY_FONT_PX,
): TextMetrics & { richLines: RichLine[] } {
  const maxWidth = Math.max(width - STICKY_PADDING * 2, 16);
  const previousFont = ctx.font;
  const richLines = layoutRuns(ctx, runs, maxWidth, fontPx);
  ctx.font = previousFont;

  return {
    lines: richLines.map((line) => line.segments.map((segment) => segment.text).join("")),
    lineHeight: STICKY_LINE_HEIGHT,
    richLines,
    height: Math.max(
      richLines.length * STICKY_LINE_HEIGHT + STICKY_PADDING * 2 + STICKY_BOTTOM_PADDING,
      STICKY_LINE_HEIGHT * 3,
    ),
  };
}

/** Height formatted text needs, measured off-screen. */
export function runsHeightFor(runs: readonly TextRun[], width: number): number | null {
  const ctx = measureContext();
  if (!ctx) return null;
  return richMetrics(ctx, runs, width).height;
}

/* ----------------------------------------------------------- auto sizing --- */

/** Smallest text size Auto will shrink to before giving up. */
export const MIN_NOTE_FONT = 8;

/**
 * A shape's readable floor (ADR-214).
 *
 * A note may shrink its letters to 8 px because it is a physical object whose size is
 * the person's decision. A shape is a diagram node: below 10 px the label stops being
 * readable, so the shape grows instead.
 */
export const MIN_SHAPE_FONT = 10;

/** How tall a shape may grow for its text before the label is clipped (ADR-214). */
export const MAX_SHAPE_HEIGHT = 1280;

/** Line box for a text size; the painter and the fitter must agree exactly. */
export function lineHeightFor(fontPx: number): number {
  return Math.round(fontPx * 1.25);
}

/** Space a note keeps between its text and its border. */
export function notePadding(fontPx: number): number {
  return Math.max(8, Math.round(fontPx * 0.75));
}

/**
 * Largest text size that fits `runs` inside a box.
 *
 * Auto means "the note fits its text", not "the note grows": a sticky keeps its
 * physical size and the letters get smaller, which is what the source product does
 * and what keeps a board of notes the same size. The search is over whole pixels and
 * the predicate is monotonic (a smaller font wraps into fewer, shorter lines), so a
 * binary search is exact.
 */
export function fitNoteFont(
  ctx: CanvasRenderingContext2D,
  runs: readonly TextRun[],
  width: number,
  height: number,
  cap: number,
  min: number = MIN_NOTE_FONT,
  family: string = DEFAULT_FONT_FAMILY,
): number {
  const ceiling = Math.max(min, Math.round(cap));

  const fits = (size: number): boolean => {
    const padding = notePadding(size);
    const areaWidth = Math.max(width - padding * 2, 8);
    const lines = layoutRuns(ctx, runs, areaWidth, size, family);
    const total = lines.length * lineHeightFor(size);
    return total <= Math.max(height - padding * 2, lineHeightFor(size));
  };

  let lo = min;
  let hi = ceiling;
  let best = min;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Text size a note will actually paint at.
 *
 * The editor needs the same number the painter uses, or the caret would sit at a
 * different size from the letters around it. `explicit` wins; otherwise Auto fits the
 * text to the box. Returns null when no canvas is available (server-side render).
 */
export function noteFontSizeFor(
  runs: readonly TextRun[],
  width: number,
  height: number,
  cap: number,
  explicit?: number,
  family: string = DEFAULT_FONT_FAMILY,
): number | null {
  if (explicit) return explicit;
  const ctx = measureContext();
  if (!ctx) return null;
  return fitNoteFont(ctx, runs, width, height, cap, undefined, family);
}


/**
 * Whether the widget's text is clipped at the size it paints at (ADR-214).
 *
 * The badge needs the same answer the painter has; `null` means no canvas is available
 * (server-side render), and the caller then says nothing rather than guessing.
 */
export function textClipped(
  widget: Widget,
  cap: number,
  family: string = DEFAULT_FONT_FAMILY,
  /** The shared scratch canvas; a test passes a fake so it needs no browser. */
  ctx: CanvasRenderingContext2D | null = measureContext(),
): boolean | null {
  const runs: TextRun[] = widget.runs?.length
    ? widget.runs
    : widget.content
      ? [{ text: widget.content }]
      : [];
  if (!runs.length) return false;
  if (!ctx) return null;
  const explicit = widget.style?.fontSize;
  const size =
    explicit ??
    fitNoteFont(
      ctx,
      runs,
      widget.width,
      widget.height,
      cap,
      widget.type === "shape" ? MIN_SHAPE_FONT : undefined,
      family,
    );
  // The painter compares the lines' own height with the box inside its padding; adding
  // the padding on both sides would call a fitting label clipped (ADR-214).
  const padding = notePadding(size);
  const lines = layoutRuns(ctx, runs, Math.max(widget.width - padding * 2, 8), size, family);
  return lines.length * lineHeightFor(size) >
    Math.max(widget.height - padding * 2, lineHeightFor(size)) + 0.5;
}
