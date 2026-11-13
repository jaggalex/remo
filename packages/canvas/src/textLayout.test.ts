import { describe, expect, it } from "vitest";
import type { TextRun, Widget } from "@remo/model";
import {
  MAX_SHAPE_HEIGHT,
  MIN_NOTE_FONT,
  MIN_SHAPE_FONT,
  fitNoteFont,
  layoutRuns,
  lineHeightFor,
  noteFontSizeFor,
  notePadding,
  textClipped,
} from "./textLayout";

/**
 * A measuring context good enough for layout: every glyph is `perChar` wide and the
 * font string is ignored. Layout only ever asks for a width, which keeps these tests
 * about the fitting rule rather than about a font's metrics.
 */
function fakeCtx(perChar = 8): CanvasRenderingContext2D {
  return {
    font: "",
    measureText: (text: string) => ({ width: text.length * perChar }),
  } as unknown as CanvasRenderingContext2D;
}

describe("auto text size", () => {
  it("uses the largest allowed size when the text fits", () => {
    expect(fitNoteFont(fakeCtx(), [{ text: "short" }], 160, 180, 16)).toBe(16);
  });

  it("shrinks until the text fits, and never below the floor", () => {
    const runs: TextRun[] = [{ text: "word ".repeat(200) }];
    const size = fitNoteFont(fakeCtx(), runs, 160, 180, 16);
    expect(size).toBeLessThan(16);
    expect(size).toBeGreaterThanOrEqual(MIN_NOTE_FONT);

    // One pixel larger would not fit — so the result is the largest size that does.
    const ctx = fakeCtx();
    const bigger = size + 1;
    if (bigger <= 16) {
      const padding = notePadding(bigger);
      const lines = layoutRuns(ctx, runs, 160 - padding * 2, bigger);
      expect(lines.length * lineHeightFor(bigger)).toBeGreaterThan(180 - padding * 2);
    }
  });

  it("grows with the box: the same text fits at a larger size in a bigger note", () => {
    const runs: TextRun[] = [{ text: "a ".repeat(60) }];
    const small = fitNoteFont(fakeCtx(), runs, 160, 160, 16);
    const large = fitNoteFont(fakeCtx(), runs, 400, 400, 16);
    expect(large).toBeGreaterThan(small);
  });

  it("respects an explicit size instead of fitting", () => {
    expect(noteFontSizeFor([{ text: "x" }], 160, 180, 16, 24)).toBe(24);
  });

  it("gives Auto nothing to do with an empty note", () => {
    expect(fitNoteFont(fakeCtx(), [], 160, 180, 16)).toBe(16);
  });

  it("has a line height the painter and the fitter agree on", () => {
    expect(lineHeightFor(16)).toBe(20);
    expect(lineHeightFor(8)).toBe(10);
  });
});

/**
 * The clip state is one answer for the painter, the badge and the growth (ADR-214), so
 * these tests pin the predicate itself: growth stops exactly where the mark appears.
 */
describe("clip state", () => {
  const shape = (text: string, height: number): Widget =>
    ({
      id: "s",
      type: "shape",
      x: 0,
      y: 0,
      width: 200,
      height,
      content: text,
      style: { fontSize: 16 },
    }) as Widget;

  it("keeps the constant the growth and the mark share", () => {
    expect(MIN_SHAPE_FONT).toBe(10);
    expect(MAX_SHAPE_HEIGHT).toBe(1280);
    expect(MIN_SHAPE_FONT).toBeGreaterThan(MIN_NOTE_FONT);
  });

  it("calls an empty label fitted", () => {
    expect(textClipped(shape("", 40), 16, "sans", fakeCtx())).toBe(false);
  });

  it("calls a short label fitted", () => {
    expect(textClipped(shape("short", 200), 16, "sans", fakeCtx())).toBe(false);
  });

  it("stops clipping once the box is tall enough — the growth's own question", () => {
    const text = "word ".repeat(40);
    expect(textClipped(shape(text, 80), 16, "sans", fakeCtx())).toBe(true);
    expect(textClipped(shape(text, 600), 16, "sans", fakeCtx())).toBe(false);
  });

  it("answers null when there is no context to measure with", () => {
    expect(textClipped(shape("short", 200), 16, "sans", null)).toBeNull();
  });
});
