import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { ELEVATION_SHADOW } from "./elevation";
import { DEFAULT_PALETTE } from "./palette";
import { drawWidget } from "./render";

/** Records each call with the shadow in force when it was made. */
function recorder(scale = 1) {
  const calls: Array<{ name: string; args: unknown[]; shadowColor?: unknown; shadowBlur?: unknown; shadowOffsetY?: unknown }> = [];
  const stack: Array<Record<string | symbol, unknown>> = [];
  const state: Record<string | symbol, unknown> = { getTransform: () => ({ a: scale, b: 0 }) };
  const ctx = new Proxy(state, {
    get(target, key) {
      // Canvas state is a stack: `restore` must take the shadow off again.
      if (key === "save") return () => stack.push({ ...target });
      if (key === "restore") {
        return () => {
          const saved = stack.pop();
          if (!saved) return;
          for (const name of ["shadowColor", "shadowBlur", "shadowOffsetY", "fillStyle"]) target[name] = saved[name];
        };
      }
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => {
        calls.push({
          name: String(key),
          args,
          shadowColor: target.shadowColor,
          shadowBlur: target.shadowBlur,
          shadowOffsetY: target.shadowOffsetY,
        });
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const widget = (type: Widget["type"], elevation?: "raised" | "floating"): Widget => ({
  id: "w",
  type,
  parentId: null,
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  ...(type === "shape" ? { shapeKind: "ellipse" as const } : {}),
  ...(elevation ? { style: { elevation } } : {}),
});

const shadowed = (calls: ReturnType<typeof recorder>["calls"]) =>
  calls.filter((c) => c.name === "fill" && c.shadowColor && c.shadowColor !== "transparent");

describe("elevation painter (ADR-245)", () => {
  it("leaves a flat object without any shadow", () => {
    for (const type of ["frame", "kanban", "shape"] as const) {
      const { ctx, calls } = recorder();
      drawWidget(ctx, widget(type), 1);
      expect(calls.some((c) => c.name === "clip")).toBe(false);
      expect(shadowed(calls)).toEqual([]);
    }
  });

  it("casts the level's token colour and geometry, scaled to the device, outside the outline", () => {
    for (const type of ["frame", "kanban", "shape"] as const) {
      const { ctx, calls } = recorder(2);
      drawWidget(ctx, widget(type, "floating"), 2);
      const clip = calls.find((c) => c.name === "clip");
      expect(clip?.args).toEqual(["evenodd"]);
      const cast = shadowed(calls);
      expect(cast).toHaveLength(1);
      expect(cast[0]!.shadowColor).toBe(DEFAULT_PALETTE.floatCast);
      expect(cast[0]!.shadowBlur).toBe(ELEVATION_SHADOW.floating.blur * 2);
      expect(cast[0]!.shadowOffsetY).toBe(ELEVATION_SHADOW.floating.offset * 2);
      // The cast comes first: the object's own fill is painted over it, unclipped.
      expect(calls.indexOf(cast[0]!)).toBeLessThan(calls.findLastIndex((c) => c.name === "fill"));
    }
  });

  it("uses the raised colour for the lower level", () => {
    const { ctx, calls } = recorder();
    drawWidget(ctx, widget("frame", "raised"), 1);
    expect(shadowed(calls)[0]!.shadowColor).toBe(DEFAULT_PALETTE.raiseCast);
  });
});
