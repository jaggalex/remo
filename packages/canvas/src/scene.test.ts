import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { isVisible, rectsOverlap, visibleFraction, visibleWorldRect, widgetRect } from "./scene";

const widget = (id: string, x: number, y: number, width = 100, height = 100): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width,
  height,
});

describe("visible world rectangle", () => {
  it("is centred on the camera and scaled by zoom", () => {
    const rect = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 600 }, 0);
    expect(rect).toEqual({ x: -400, y: -300, width: 800, height: 600 });

    const zoomedOut = visibleWorldRect({ x: 100, y: 50, zoom: 0.5 }, { width: 800, height: 600 }, 0);
    expect(zoomedOut).toEqual({ x: -700, y: -550, width: 1600, height: 1200 });
  });

  it("grows by the margin so partially visible objects and shadows survive", () => {
    const withMargin = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { width: 100, height: 100 }, 25);
    expect(withMargin).toEqual({ x: -75, y: -75, width: 150, height: 150 });
  });
});

describe("culling", () => {
  const visible = { x: 0, y: 0, width: 1000, height: 1000 };

  it("keeps what overlaps the viewport and drops the rest", () => {
    expect(isVisible(widget("inside", 500, 500), visible)).toBe(true);
    expect(isVisible(widget("edge", 1005, 500), visible)).toBe(true); // half in
    expect(isVisible(widget("outside", 2000, 500), visible)).toBe(false);
    expect(isVisible(widget("above", 500, -400), visible)).toBe(false);
  });

  it("treats touching edges as not overlapping", () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it("reports the share of widgets that would be drawn", () => {
    const widgets = [
      widget("a", 100, 100),
      widget("b", 900, 900),
      widget("c", 5000, 5000),
      widget("d", -5000, 5000),
    ];
    expect(visibleFraction(widgets, visible)).toBeCloseTo(0.5, 5);
    expect(visibleFraction([], visible)).toBe(1);
  });

  it("converts a widget to its bounding box", () => {
    expect(widgetRect(widget("a", 10, 20, 40, 60))).toEqual({
      x: -10,
      y: -10,
      width: 40,
      height: 60,
    });
  });
});
