import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import {
  CHIP_INSET,
  CHIP_VIEWPORT_MARGIN,
  chipPlacement,
  connectorLabelBoxes,
  labelWidth,
  screenBox,
  type Box,
} from "./chipPlacement";

/**
 * The counter's position is a rule, not a number that looked right once
 * (ADR-119.3): same corner for every object, inside the object, clear of
 * connector labels and neighbours, and always inside the canvas.
 */
const viewport = { width: 1440, height: 900 };
const chip = { width: 60, height: 32 };

function objectAt(x: number, y: number, width = 168, height = 168): Box {
  return { x, y, width, height };
}

describe("chip placement", () => {
  it("pins the same corner of every object: 8 px inside the bottom-right", () => {
    const first = chipPlacement({
      object: objectAt(100, 100),
      chip,
      viewport,
      obstacles: [],
    });
    const second = chipPlacement({
      object: objectAt(700, 400),
      chip,
      viewport,
      obstacles: [],
    });

    expect(first.left).toBe(100 + 168 - CHIP_INSET - chip.width);
    expect(first.top).toBe(100 + 168 - CHIP_INSET - chip.height);
    // The offset is the object's own, so the second object gets the same one.
    expect(700 + 168 - CHIP_INSET - chip.width).toBe(second.left);
    expect(400 + 168 - CHIP_INSET - chip.height).toBe(second.top);
  });

  it("slides left along the bottom edge instead of covering a connector label", () => {
    const object = objectAt(100, 100);
    const corner = chipPlacement({ object, chip, viewport, obstacles: [] });
    // The label sits on the chip's corner, as in the reported screenshot.
    const label: Box = {
      x: corner.left + 4,
      y: corner.top + 4,
      width: 40,
      height: 20,
    };

    const placed = chipPlacement({ object, chip, viewport, obstacles: [label] });

    expect(placed.top).toBe(corner.top);
    expect(placed.left).toBeLessThan(corner.left);
    const rect = { x: placed.left, y: placed.top, width: chip.width, height: chip.height };
    expect(rect.x + rect.width <= label.x || label.x + label.width <= rect.x ||
      rect.y + rect.height <= label.y || label.y + label.height <= rect.y).toBe(true);
  });

  it("keeps the corner when the object is too narrow to slide inside", () => {
    const object = objectAt(100, 100, 40, 40);
    const corner = chipPlacement({ object, chip, viewport, obstacles: [] });
    const label: Box = { x: corner.left, y: corner.top, width: 20, height: 20 };

    const placed = chipPlacement({ object, chip, viewport, obstacles: [label] });

    // Nowhere to go without leaving the object: the corner stays, the object never moves.
    expect(placed).toEqual(corner);
  });

  it("clamps into the canvas instead of moving the object", () => {
    const object = objectAt(-40, -40);

    const placed = chipPlacement({ object, chip, viewport, obstacles: [] });

    expect(placed.left).toBeGreaterThanOrEqual(CHIP_VIEWPORT_MARGIN);
    expect(placed.top).toBeGreaterThanOrEqual(CHIP_VIEWPORT_MARGIN);
  });

  it("clamps at the right and bottom edges of the canvas", () => {
    const object = objectAt(viewport.width - 40, viewport.height - 40);

    const placed = chipPlacement({ object, chip, viewport, obstacles: [] });

    expect(placed.left + chip.width).toBeLessThanOrEqual(viewport.width - CHIP_VIEWPORT_MARGIN);
    expect(placed.top + chip.height).toBeLessThanOrEqual(viewport.height - CHIP_VIEWPORT_MARGIN);
  });
});

describe("screen projection", () => {
  it("follows the camera: the same world box lands elsewhere after a pan or zoom", () => {
    const box = { x: 100, y: 50, width: 200, height: 100 };
    const at = screenBox(box, { x: 0, y: 0, zoom: 1 }, viewport);
    expect(at).toEqual({ x: 820, y: 500, width: 200, height: 100 });

    const panned = screenBox(box, { x: 100, y: 50, zoom: 2 }, viewport);
    expect(panned).toEqual({ x: 720, y: 450, width: 400, height: 200 });
  });
});

describe("connector label width", () => {
  it("grows with the text and never passes the painter's truncation", () => {
    const plain = labelWidth("тест", 13, "Inter");
    const longer = labelWidth("тест вдвое длиннее", 13, "Inter");
    const huge = labelWidth("x".repeat(400), 13, "Inter");

    expect(plain).toBeGreaterThan(0);
    expect(longer).toBeGreaterThan(plain);
    expect(huge).toBeLessThan(260 + 13 * 0.92 + 1);
  });
});

describe("connector label boxes", () => {
  const note = (id: string, x: number, y: number): Widget => ({
    id,
    type: "sticky_note",
    parentId: null,
    x,
    y,
    width: 160,
    height: 160,
  });
  const widgets: Widget[] = [
    note("a", 100, 100),
    note("b", 500, 100),
    {
      id: "line",
      type: "connector",
      parentId: null,
      x: 300,
      y: 100,
      width: 400,
      height: 0,
      content: "тест",
      start: { item: "a" },
      end: { item: "b" },
    },
  ];
  const resolve = (id: string) => widgets.find((widget) => widget.id === id);

  it("puts the label where the painter draws it — on the line, not on an endpoint", () => {
    const boxes = connectorLabelBoxes({ widgets, resolve, stubs: {}, fontFamily: "Inter" });

    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    // The line runs from the left note's right side to the right note's left side, and
    // the label sits on its middle.
    expect(box.x + box.width / 2).toBeCloseTo(300, 0);
    expect(box.y + box.height / 2).toBeCloseTo(100, 0);
    expect(box.width).toBeGreaterThan(labelWidth("тест", 13, "Inter") - 1);
  });

  it("ignores lines without text, and lines whose endpoints are gone", () => {
    const bare = [{ ...widgets[2]!, content: "" }];
    expect(connectorLabelBoxes({ widgets: bare, resolve, stubs: {}, fontFamily: "Inter" })).toEqual([]);
    expect(
      connectorLabelBoxes({
        widgets: [widgets[2]!],
        resolve: () => undefined,
        stubs: {},
        fontFamily: "Inter",
      }),
    ).toEqual([]);
  });
});
