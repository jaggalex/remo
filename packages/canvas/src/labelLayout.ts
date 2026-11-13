/**
 * Layout of a connector's label chip (ADR-213).
 *
 * One function, two callers: the painter draws the lines it returns, and the editor sizes
 * its textarea with the same numbers. If they disagreed, the caret would sit at a
 * different width from the chip around it.
 *
 * The rules are the design's, not the painter's: an explicit newline is a line, automatic
 * wrapping stops at three lines and an ellipsis, eight lines is the guard against a pasted
 * wall of text, and the chip is 40…240 px wide.
 */

export const LABEL_MAX_WIDTH = 240;
export const LABEL_MIN_WIDTH = 40;
export const LABEL_WRAP_LINES = 3;
export const LABEL_MAX_LINES = 8;
const ELLIPSIS = "…";

export interface LabelMetrics {
  lines: string[];
  /** Chip width in world units, padding included. */
  width: number;
  /** Chip height in world units, padding included. */
  height: number;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  fontPx: number;
  /** True when the text did not fit and an ellipsis was added. */
  truncated: boolean;
}

export interface Measure {
  measureText(text: string): { width: number };
}

function pad(fontPx: number): { x: number; y: number } {
  return { x: fontPx * 0.46, y: fontPx * 0.3 };
}

/** Cut `text` until it fits `maxWidth` with an ellipsis appended. */
function ellipsize(measure: Measure, text: string, maxWidth: number): string {
  if (measure.measureText(`${text}${ELLIPSIS}`).width <= maxWidth) return `${text}${ELLIPSIS}`;
  let cut = text.length;
  while (cut > 0 && measure.measureText(`${text.slice(0, cut)}${ELLIPSIS}`).width > maxWidth) {
    cut -= 1;
  }
  return `${text.slice(0, cut)}${ELLIPSIS}`;
}

/** Greedy word wrap; a word wider than the chip is broken rather than allowed to overflow. */
function wrapParagraph(measure: Measure, paragraph: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (measure.measureText(rest).width > maxWidth && rest.length > 1) {
      let cut = rest.length;
      while (cut > 1 && measure.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  lines.push(line);
  return lines;
}

/**
 * Lines and chip size for `text`.
 *
 * `text` is the stored content: explicit newlines are paragraphs and are always kept.
 * A label without a newline wraps automatically and stops at three lines; one with
 * newlines keeps its paragraphs and stops at eight lines in total.
 */
export function layoutLabel(
  measure: Measure,
  text: string,
  fontPx: number,
  maxWidth: number = LABEL_MAX_WIDTH,
): LabelMetrics {
  const paragraphs = text.split("\n");
  const explicit = paragraphs.length > 1;
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    lines.push(...wrapParagraph(measure, paragraph, maxWidth));
  }

  const cap = explicit ? LABEL_MAX_LINES : LABEL_WRAP_LINES;
  let truncated = false;
  if (lines.length > cap) {
    lines.length = cap;
    lines[cap - 1] = ellipsize(measure, lines[cap - 1] ?? "", maxWidth);
    truncated = true;
  }

  const padding = pad(fontPx);
  const textWidth = Math.max(...lines.map((line) => measure.measureText(line).width), 0);
  const width = Math.min(
    Math.max(textWidth + padding.x * 2, LABEL_MIN_WIDTH),
    maxWidth + padding.x * 2,
  );
  const lineHeight = Math.round(fontPx * 1.25);
  return {
    lines,
    width,
    height: lines.length * lineHeight + padding.y * 2,
    paddingX: padding.x,
    paddingY: padding.y,
    lineHeight,
    fontPx,
    truncated,
  };
}

/* ------------------------------------------------------ measuring context --- */

let scratch: CanvasRenderingContext2D | null = null;

/**
 * A measuring context for callers outside the painter (the editor, tests with a DOM).
 * Returns null where no canvas exists; `layoutLabel` still works with any `Measure`.
 */
export function labelMeasure(): Measure | null {
  if (scratch) return scratch;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  scratch = canvas.getContext("2d");
  return scratch;
}

/** Metrics for the editor: the same layout the painter will use once it commits. */
export function labelMetrics(
  text: string,
  fontPx: number,
  family: string = "sans-serif",
): LabelMetrics | null {
  const measure = labelMeasure();
  if (!measure) return null;
  const previous = (measure as CanvasRenderingContext2D).font;
  (measure as CanvasRenderingContext2D).font = `500 ${fontPx}px ${family}`;
  const metrics = layoutLabel(measure, text, fontPx);
  (measure as CanvasRenderingContext2D).font = previous;
  return metrics;
}
