import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { CARD_RADIUS, drawCardSheet } from "./cardSheet";
import { DEFAULT_PALETTE } from "./palette";
import { drawWidget } from "./render";

/** Records each call with the style in force when it was made. */
function recorder() {
  const calls: Array<{ name: string; args: unknown[]; strokeStyle?: unknown; shadowColor?: unknown }> = [];
  const state: Record<string | symbol, unknown> = { getTransform: () => ({ a: 1, b: 0 }) };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => {
        calls.push({ name: String(key), args, strokeStyle: target.strokeStyle, shadowColor: target.shadowColor });
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const box = { x: 0, y: 0, width: 200, height: 40 };

describe("card sheet (ADR-234)", () => {
  it("is paper: a fill with the sheet shadow and no outline", () => {
    const { ctx, calls } = recorder();
    drawCardSheet(ctx, box, 1);
    expect(calls.filter((c) => c.name === "stroke")).toEqual([]);
    const fill = calls.find((c) => c.name === "fill");
    expect(fill?.shadowColor).toBe(DEFAULT_PALETTE.stickerCast);
    // radius-md, not a pill: the first corner starts CARD_RADIUS in from the edge.
    expect(calls.find((c) => c.name === "moveTo")?.args).toEqual([CARD_RADIUS, 0]);
  });

  it("frames only the selection, outside the sheet", () => {
    const { ctx, calls } = recorder();
    drawCardSheet(ctx, box, 2, { selected: true });
    const strokes = calls.filter((c) => c.name === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.strokeStyle).toBe(DEFAULT_PALETTE.selectionStroke);
    const moves = calls.filter((c) => c.name === "moveTo");
    const [, y] = moves.at(-1)!.args as [number, number];
    expect(y).toBeLessThan(box.y);
  });

  it("paints a free card the same way, whatever its cardTheme", () => {
    const { ctx, calls } = recorder();
    const card = {
      id: "c1",
      type: "card",
      x: 100,
      y: 20,
      width: 200,
      height: 40,
      title: "Ship",
      style: { cardTheme: "#ffdd33" },
    } as unknown as Widget;
    drawWidget(ctx, card, 1, { selectedIds: [] });
    expect(calls.filter((c) => c.name === "stroke" && c.strokeStyle === "#ffdd33")).toEqual([]);
  });
});
