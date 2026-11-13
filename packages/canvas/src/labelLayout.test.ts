import { describe, expect, it } from "vitest";
import {
  LABEL_MAX_LINES,
  LABEL_MAX_WIDTH,
  LABEL_MIN_WIDTH,
  LABEL_WRAP_LINES,
  layoutLabel,
  type Measure,
} from "./labelLayout";

/**
 * A connector's label chip (ADR-213).
 *
 * The measure is a stub: seven units per character is enough to pin the rules without a
 * browser. What matters here is the shape of the answer — which lines, how many, how
 * wide the chip — because the painter and the editor both read it.
 */
const measure: Measure = { measureText: (text) => ({ width: text.length * 7 }) };
const FONT = 13;

describe("layoutLabel (ADR-213)", () => {
  it("keeps an explicit newline as a line", () => {
    const metrics = layoutLabel(measure, "Первая\nВторая", FONT);
    expect(metrics.lines).toEqual(["Первая", "Вторая"]);
    expect(metrics.truncated).toBe(false);
  });

  it("wraps a paragraph and stops at three lines with an ellipsis", () => {
    const metrics = layoutLabel(measure, "word ".repeat(40).trim(), FONT);
    expect(metrics.lines).toHaveLength(LABEL_WRAP_LINES);
    expect(metrics.lines.at(-1)?.endsWith("…")).toBe(true);
    expect(metrics.truncated).toBe(true);
  });

  it("keeps four explicit lines, because Enter is the person's decision", () => {
    const metrics = layoutLabel(measure, "a\nb\nc\nd", FONT);
    expect(metrics.lines).toEqual(["a", "b", "c", "d"]);
    expect(metrics.truncated).toBe(false);
  });

  it("guards against a pasted wall of text at eight lines", () => {
    const metrics = layoutLabel(measure, Array.from({ length: 20 }, () => "line").join("\n"), FONT);
    expect(metrics.lines).toHaveLength(LABEL_MAX_LINES);
    expect(metrics.lines.at(-1)?.endsWith("…")).toBe(true);
  });

  it("never makes a chip narrower than the floor", () => {
    const metrics = layoutLabel(measure, "да", FONT);
    expect(metrics.width).toBe(LABEL_MIN_WIDTH);
  });

  it("never lets the chip exceed the ceiling", () => {
    const metrics = layoutLabel(measure, "x".repeat(200), FONT);
    expect(metrics.width).toBeLessThanOrEqual(LABEL_MAX_WIDTH);
    expect(metrics.width).toBeGreaterThan(LABEL_MIN_WIDTH);
    // A single unbreakable word is broken rather than allowed to run past the chip.
    const padding = FONT * 0.46 * 2;
    expect(
      metrics.lines.every((line) => measure.measureText(line).width <= LABEL_MAX_WIDTH - padding),
    ).toBe(true);
  });

  it("caps every paragraph at three lines, even when the label has explicit breaks", () => {
    const metrics = layoutLabel(measure, `${"word ".repeat(40)}first\nsecond`, FONT);
    expect(metrics.lines.slice(0, 3)).toHaveLength(3);
    expect(metrics.lines[2]?.endsWith("…")).toBe(true);
    expect(metrics.lines.at(-1)).toBe("second");
  });

  it("sizes the height by the line count", () => {
    const metrics = layoutLabel(measure, "one\ntwo", FONT);
    const lineHeight = Math.round(FONT * 1.25);
    expect(metrics.lineHeight).toBe(lineHeight);
    expect(metrics.height).toBeCloseTo(2 * lineHeight + FONT * 0.3 * 2, 5);
  });
});
