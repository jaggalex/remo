import { describe, expect, it } from "vitest";
import { minScale, scaleBoxes, type ScaleItem } from "./scale";

/**
 * A block transform is one box and one factor per axis (ADR-211).
 *
 * These tests pin the three promises the hand-off makes: scalable members keep their
 * proportions and gaps, a member that cannot scale only travels, and a minimum stops
 * the whole block instead of squeezing one member.
 */

function item(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  options: { scalable?: boolean; min?: { width: number; height: number } } = {},
): ScaleItem {
  return {
    id,
    box,
    scalable: options.scalable ?? true,
    min: options.min ?? { width: 80, height: 60 },
  };
}

describe("scaleBoxes (ADR-211)", () => {
  it("maps centres through one factor and keeps gaps proportional", () => {
    const a = item("a", { x: 0, y: 0, width: 120, height: 120 }, { min: { width: 8, height: 8 } });
    const b = item("b", { x: 160, y: 0, width: 120, height: 120 }, { min: { width: 8, height: 8 } });

    const result = scaleBoxes([a, b], { x: 0, y: 0, width: 280, height: 120 }, { x: 0, y: 0, width: 140, height: 60 });

    expect(result.factors).toEqual({ x: 0.5, y: 0.5 });
    expect(result.stopped).toBe(false);
    expect(result.boxes).toEqual([
      { id: "a", x: 30, y: 30, width: 60, height: 60 },
      { id: "b", x: 110, y: 30, width: 60, height: 60 },
    ]);
    // The 40-unit gap becomes 20, exactly half.
    const gap = (result.boxes[1]!.x - result.boxes[1]!.width / 2) -
      (result.boxes[0]!.x + result.boxes[0]!.width / 2);
    expect(gap).toBeCloseTo(20, 6);
  });

  it("moves a member that cannot scale without changing its size", () => {
    const note = item("a", { x: 0, y: 0, width: 100, height: 100 }, { min: { width: 8, height: 8 } });
    const locked = item("b", { x: 200, y: 0, width: 100, height: 100 }, { scalable: false });

    const result = scaleBoxes(
      [note, locked],
      { x: 0, y: 0, width: 300, height: 100 },
      { x: 0, y: 0, width: 150, height: 50 },
    );

    expect(result.boxes[0]).toEqual({ id: "a", x: 25, y: 25, width: 50, height: 50 });
    expect(result.boxes[1]).toEqual({ id: "b", x: 125, y: 25, width: 100, height: 100 });
  });

  it("stops the whole block at the first minimum instead of squeezing one member", () => {
    const small = item("a", { x: 0, y: 0, width: 100, height: 100 }, { min: { width: 80, height: 80 } });
    const other = item("b", { x: 100, y: 0, width: 100, height: 100 }, { min: { width: 20, height: 20 } });

    const result = scaleBoxes(
      [small, other],
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 0, width: 50, height: 100 },
    );

    expect(result.factors.x).toBeCloseTo(0.8, 6);
    expect(result.factors.y).toBe(1);
    expect(result.stopped).toBe(true);
    expect(result.boxes.every((box) => box.width >= 80 || box.width === 100)).toBe(true);
    expect(result.boxes[0]!.width).toBeCloseTo(80, 6);
  });

  it("refuses to shrink a block that is already below a minimum", () => {
    const tiny = item("a", { x: 0, y: 0, width: 40, height: 40 }, { min: { width: 80, height: 80 } });

    const result = scaleBoxes([tiny], { x: 0, y: 0, width: 40, height: 40 }, { x: 0, y: 0, width: 20, height: 20 });

    expect(result.factors).toEqual({ x: 1, y: 1 });
    expect(result.stopped).toBe(true);
    expect(result.boxes[0]).toMatchObject({ width: 40, height: 40 });
  });

  it("treats a zero-size source as no scale on that axis", () => {
    const a = item("a", { x: 0, y: 0, width: 100, height: 100 });

    const result = scaleBoxes([a], { x: 0, y: 0, width: 0, height: 100 }, { x: 0, y: 0, width: 50, height: 200 });

    expect(result.factors.x).toBe(1);
    expect(result.factors.y).toBe(2);
    expect(result.boxes[0]).toMatchObject({ x: 50, y: 100, width: 100, height: 200 });
  });

  it("reports the floor the gesture can show as a limit", () => {
    const a = item("a", { x: 0, y: 0, width: 200, height: 100 }, { min: { width: 150, height: 75 } });
    expect(minScale([a])).toEqual({ x: 0.75, y: 0.75 });
  });

  it("ignores the minimum of a member that cannot scale", () => {
    const locked = item("l", { x: 0, y: 0, width: 100, height: 100 }, {
      scalable: false,
      min: { width: 400, height: 400 },
    });
    expect(minScale([locked])).toEqual({ x: 0, y: 0 });
  });
});
