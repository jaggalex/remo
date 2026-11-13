import { describe, expect, it } from "vitest";
import type { TextRun } from "@remo/model";
import {
  MIN_NOTE_FONT,
  MIN_SHAPE_FONT,
  fitNoteFont,
  layoutRuns,
  lineHeightFor,
  noteFontSizeFor,
  notePadding,
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
