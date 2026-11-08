import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { layerKey } from "@remo/model";
import { SpatialIndex, spatialIndex } from "./spatial";
import { containsPoint, intersectsRect, pick, pickInRect } from "./hit";

function note(id: string, x: number, y: number, width = 100, height = 100): Widget {
  return { id, type: "sticky_note", parentId: null, x, y, width, height };
}

/** Deterministic pseudo-random, so a failure is reproducible. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function scene(count: number): Widget[] {
  const next = random(42);
  const widgets: Widget[] = [];
  for (let index = 0; index < count; index += 1) {
    widgets.push(
      note(
        `w${index}`,
        Math.round((next() - 0.5) * 20_000),
        Math.round((next() - 0.5) * 20_000),
        40 + Math.round(next() * 300),
        40 + Math.round(next() * 300),
      ),
    );
  }
  return widgets;
}

function brutePick(widgets: Widget[], point: { x: number; y: number }) {
  let best: Widget | null = null;
  let bestRank = -Infinity;
  for (const widget of widgets) {
    if (widget.type === "connector") continue;
    if (!containsPoint(widget, point)) continue;
    const rank = layerKey(widget);
    if (rank >= bestRank) {
      best = widget;
      bestRank = rank;
    }
  }
  return best;
}

describe("spatial index (P6)", () => {
  it("returns the same topmost widget as a full scan", () => {
    const widgets = scene(3000);
    const next = random(7);
    for (let index = 0; index < 200; index += 1) {
      const point = {
        x: Math.round((next() - 0.5) * 22_000),
        y: Math.round((next() - 0.5) * 22_000),
      };
      expect(pick(widgets, point, () => false)?.id ?? null).toBe(brutePick(widgets, point)?.id ?? null);
    }
  });

  it("returns the same marquee set as a full scan, in document order", () => {
    const widgets = scene(3000);
    const next = random(11);
    for (let index = 0; index < 60; index += 1) {
      const rect = {
        x: Math.round((next() - 0.5) * 20_000),
        y: Math.round((next() - 0.5) * 20_000),
        width: Math.round(next() * 5000),
        height: Math.round(next() * 5000),
      };
      const expected = widgets
        .filter(
          (widget) =>
            widget.type !== "frame" &&
            widget.type !== "connector" &&
            intersectsRect(widget, rect),
        )
        .map((widget) => widget.id);
      expect(pickInRect(widgets, rect, () => false).map((widget) => widget.id)).toEqual(expected);
    }
  });

  it("checks a widget too large to index cell by cell", () => {
    const frame: Widget = {
      id: "frame",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 2_000_000,
      height: 2_000_000,
    };
    const index = new SpatialIndex([frame, note("near", 10, 10)]);
    expect(index.queryPoint({ x: 900_000, y: 900_000 }).map((widget) => widget.id)).toContain(
      "frame",
    );
    expect(index.queryPoint({ x: 10, y: 10 }).map((widget) => widget.id).sort()).toEqual([
      "frame",
      "near",
    ]);
  });

  it("caches by snapshot identity and rebuilds for a new array", () => {
    const first = [note("a", 0, 0)];
    expect(spatialIndex(first)).toBe(spatialIndex(first));
    const second = [note("a", 0, 0), note("b", 500, 500)];
    expect(spatialIndex(second)).not.toBe(spatialIndex(first));
    expect(spatialIndex(second).queryPoint({ x: 500, y: 500 }).map((widget) => widget.id)).toEqual([
      "b",
    ]);
  });
});
