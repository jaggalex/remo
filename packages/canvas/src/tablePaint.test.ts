import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { DEFAULT_PALETTE } from "./palette";
import { drawTable } from "./tablePaint";

function fakeContext() {
  const calls: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (..._args: unknown[]) => {
        calls.push(String(key));
        return undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const frame: Widget = {
  id: "f",
  type: "frame",
  parentId: null,
  x: 0,
  y: 0,
  width: 600,
  height: 400,
  title: "Section",
  layout: {
    kind: "table",
    columns: [
      { id: "c1", title: "Now", vertical: true },
      { id: "c2", title: "Next" },
    ],
    rows: [{ id: "r1", title: "Step 1" }],
    appearance: { cells: { "r1:c2": "#ff0000" } },
  },
};

describe("drawTable (ADR-196)", () => {
  it("paints headers, cells and a rotated column header", () => {
    const { ctx, calls } = fakeContext();
    drawTable(ctx, frame, [], 1, DEFAULT_PALETTE, "sans-serif");
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");
    expect(calls).toContain("fillText");
    expect(calls).toContain("rotate");
    expect(calls.filter((call) => call === "strokeRect").length).toBeGreaterThanOrEqual(3);
  });

  it("does nothing for an inactive table", () => {
    const { ctx, calls } = fakeContext();
    drawTable(
      ctx,
      { ...frame, layout: { ...frame.layout!, active: false } },
      [],
      1,
      DEFAULT_PALETTE,
      "sans-serif",
    );
    expect(calls).toEqual([]);
  });
});
