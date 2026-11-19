import { describe, expect, it } from "vitest";
import {
  buildTidyLayout,
  classifyByPrefix,
  naturalCompare,
  prefixOf,
  resolveStrategy,
} from "../src/index.mjs";

/**
 * The tidy layout is pure geometry (ADR-143): same items, same plan. These tests pin
 * the two promises a person notices — natural order and even columns — and the edges:
 * a frame's contents stay inside, a locked object is skipped by the caller, and a
 * foreign object is not covered.
 */

function note(id, x, y, text, extra = {}) {
  return {
    id,
    type: "sticky_note",
    text,
    x,
    y,
    width: 160,
    height: 180,
    ...extra,
  };
}

const scattered = [
  note("s5", 900, 700, "US-5: ship"),
  note("s2", 40, 500, "US-2: cart"),
  note("s10", 300, 100, "US-10: refund"),
  note("s1", 700, -200, "US-1: browse"),
  note("s3", -400, 300, "US-3: pay"),
];

describe("natural order", () => {
  it("puts US-2 before US-10", () => {
    expect(naturalCompare("US-2", "US-10")).toBeLessThan(0);
    expect(naturalCompare("US-10", "US-2")).toBeGreaterThan(0);
    expect(naturalCompare("US-10a", "US-10")).toBeGreaterThan(0);
    expect(naturalCompare("2", "02")).toBeLessThan(0);
  });

  it("reads the prefix a person already wrote", () => {
    expect(prefixOf("US-10: refund")).toEqual({ label: "US", number: 10 });
    expect(prefixOf("US 2 cart")).toEqual({ label: "US", number: 2 });
    expect(prefixOf("no prefix here")).toBeNull();
  });

  it("groups by prefix and sorts inside the group naturally", () => {
    const blocks = classifyByPrefix(scattered);
    expect(blocks.map((block) => block.label)).toEqual(["US"]);
    expect(blocks[0].items.map((item) => item.id)).toEqual(["s1", "s2", "s3", "s5", "s10"]);
  });
});

describe("tidy layout", () => {
  it("lays out a grid with no overlap and keeps every size", () => {
    const result = buildTidyLayout({ items: scattered, strategy: "grid", origin: { x: 0, y: 0 } });
    expect(result.strategy).toBe("grid");
    expect(result.placements).toHaveLength(5);
    expect(result.frames).toHaveLength(0);
    const boxes = result.placements.map((placement) => placement);
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const a = boxes[first];
        const b = boxes[second];
        const overlap =
          Math.abs(a.x - b.x) < 160 && Math.abs(a.y - b.y) < 180;
        expect(overlap).toBe(false);
      }
    }
  });

  it("makes one frame per prefix and puts its objects inside", () => {
    const result = buildTidyLayout({
      items: scattered,
      strategy: "prefix",
      origin: { x: 0, y: 0 },
    });
    expect(result.strategy).toBe("prefix");
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].title).toBe("US");
    expect(result.frames[0].type).toBe("frame");
    const frame = result.frames[0];
    for (const placement of result.placements) {
      expect(placement.parentRef).toBe(frame.tempId);
      expect(Math.abs(placement.x - frame.x)).toBeLessThanOrEqual(frame.width / 2);
      expect(Math.abs(placement.y - frame.y)).toBeLessThanOrEqual(frame.height / 2);
    }
    // A frame has a title band: the first object starts below it.
    expect(result.placements[0].y).toBeGreaterThan(frame.y - frame.height / 2 + 20);
  });

  it("lays out inside a selected frame without creating a nested frame", () => {
    const area = { x: 0, y: 0, width: 900, height: 700 };
    const result = buildTidyLayout({
      items: [
        note("a", 0, 0, "one", { containerId: "frame1" }),
        note("b", 500, 0, "two", { containerId: "frame1" }),
      ],
      strategy: "type",
      area,
      createBlocks: false,
      origin: { x: area.x, y: area.y },
    });
    expect(result.frames).toHaveLength(0);
    for (const placement of result.placements) {
      expect(placement.parentRef).toBe("frame1");
      expect(placement.x - 80).toBeGreaterThanOrEqual(area.x - 0.5);
      expect(placement.x + 80).toBeLessThanOrEqual(area.x + area.width + 0.5);
      expect(placement.y - 90).toBeGreaterThanOrEqual(area.y - 0.5);
      expect(placement.y + 90).toBeLessThanOrEqual(area.y + area.height + 0.5);
    }
  });

  it("clamps a grid to the canvas", () => {
    const result = buildTidyLayout({
      items: [note("a", 0, 0, "one")],
      strategy: "grid",
      origin: { x: 1_000_000, y: -1_000_000 },
    });
    const placement = result.placements[0];
    expect(placement.x).toBeLessThanOrEqual(1_000_000);
    expect(placement.y).toBeGreaterThanOrEqual(-1_000_000);
  });

  it("refuses when the objects cannot fit inside the frame", () => {
    expect(() =>
      buildTidyLayout({
        items: [note("a", 0, 0, "one"), note("b", 0, 0, "two")],
        strategy: "grid",
        area: { x: 0, y: 0, width: 200, height: 200 },
        origin: { x: 0, y: 0 },
      }),
    ).toThrow(/does not fit/);
  });

  it("moves the block down instead of covering a foreign object", () => {
    const foreign = [{ x: 0, y: 0, width: 400, height: 400 }];
    const result = buildTidyLayout({
      items: [note("a", 0, 0, "US-1")],
      strategy: "prefix",
      origin: { x: 0, y: 0 },
      foreign,
    });
    const frame = result.frames[0];
    const top = frame.y - frame.height / 2;
    expect(top).toBeGreaterThanOrEqual(400);
  });

  it("shifts a whole grid down rather than covering a foreign object", () => {
    const result = buildTidyLayout({
      items: [note("a", 0, 0, "one"), note("b", 400, 0, "two")],
      strategy: "grid",
      origin: { x: 0, y: 0 },
      foreign: [{ x: 0, y: 0, width: 800, height: 300 }],
    });
    const top = Math.min(...result.placements.map((placement) => placement.y - 90));
    expect(top).toBeGreaterThanOrEqual(300);
  });

  it("falls back to type when the model has no labels, and uses them when it does", () => {
    expect(resolveStrategy(scattered, "meaning", null)).toBe("prefix");
    const blocks = buildTidyLayout({
      items: [note("a", 0, 0, "alpha"), note("b", 400, 0, "beta")],
      strategy: "meaning",
      labels: [{ label: "Flow", ids: ["a", "b"] }],
      origin: { x: 0, y: 0 },
    });
    expect(blocks.strategy).toBe("meaning");
    expect(blocks.frames[0].title).toBe("Flow");
  });
});
