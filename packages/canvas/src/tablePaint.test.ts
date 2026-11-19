import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { DEFAULT_PALETTE } from "./palette";
import { drawTable } from "./tablePaint";

function fakeContext() {
  const calls: string[] = [];
  const fonts: string[] = [];
  const marks: Array<{ fill: unknown; align: unknown }> = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") {
        return (text: string) => ({ width: String(text).length * 6.6 });
      }
      if (key === "fillText") {
        return (..._args: unknown[]) => {
          calls.push("fillText");
          fonts.push(String(target.font));
          marks.push({ fill: target.fillStyle, align: target.textAlign });
          return undefined;
        };
      }
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fonts, marks };
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

  it("scales header text with the camera, like table content", () => {
    const fontAt = (zoom: number) => {
      const { ctx, fonts } = fakeContext();
      drawTable(ctx, frame, [], zoom, DEFAULT_PALETTE, "sans-serif");
      expect(fonts.length).toBeGreaterThan(0);
      return new Set(fonts);
    };
    // The font is a world-unit size, so the same string is used at every zoom and the
    // canvas transform scales it on screen. Dividing by zoom would pin it to the screen.
    expect(fontAt(1)).toEqual(new Set(["400 12px sans-serif"]));
    expect(fontAt(2)).toEqual(new Set(["400 12px sans-serif"]));
    expect(fontAt(0.5)).toEqual(new Set(["400 12px sans-serif"]));
  });

  it("paints the table-level header typography (ADR-220)", () => {
    const { ctx, fonts, marks } = fakeContext();
    drawTable(
      ctx,
      {
        ...frame,
        layout: {
          ...frame.layout!,
          appearance: {
            headerText: {
              size: 20,
              weight: "bold",
              italic: true,
              color: "#123456",
              align: "center",
            },
          },
        },
      },
      [],
      1,
      DEFAULT_PALETTE,
      "sans-serif",
    );
    expect(fonts).toContain("italic 600 20px sans-serif");
    expect(marks).toContainEqual({ fill: "#123456", align: "center" });
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
