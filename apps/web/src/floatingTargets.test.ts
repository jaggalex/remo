import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { arrangeBarTarget, commonColour, connectorBarTarget, edgeContinueTargets, noteBarTarget, type Frame } from "./floatingTargets";
import { BAR_ROOM, COMPACT_BAR_ROOM } from "./canvasGeometry";
import { DEFAULT_SETTINGS } from "./settings";

/**
 * Where the floating bars land.
 *
 * These placements were two hundred lines inside `BoardCanvas.tsx`, where the only way to
 * check a bar was to open one and look at it. They are arithmetic on a camera and a box,
 * so they are tested as arithmetic (ADR-055).
 */

const frame: Frame = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { width: 800, height: 600 } };

const note = (id: string, x: number, y: number, extra: Partial<Widget> = {}): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width: 100,
  height: 100,
  style: { fillColor: "#ffdd33" },
  ...extra,
});

const connector = (x: number, y: number, extra: Partial<Widget> = {}): Widget => ({
  id: "line",
  type: "connector",
  parentId: null,
  x,
  y,
  width: 200,
  height: 0,
  start: { item: "a", side: "right" },
  end: { item: "b", side: "left" },
  connectorShape: "straight",
  ...extra,
});

const resolveWith = (widgets: Widget[]) => (id: string) => widgets.find((w) => w.id === id);

describe("the note bar", () => {
  it("sits above the note, centred and clamped to the canvas", () => {
    // One colour sample instead of seven chips: the bar fits the design viewport.
    const wide: Frame = { ...frame, viewport: { width: 1440, height: 600 } };
    const target = noteBarTarget({
      widget: note("n", 0, 0),
      frame: wide,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.rect).toMatchObject({ left: 670, top: 250, width: 100, height: 100 });
    expect(target.placement.left).toBe(720 - 258);
    expect(target.placement.top).toBe(250 - BAR_ROOM);
  });

  it("goes below a note that is too close to the top", () => {
    const target = noteBarTarget({
      widget: note("n", 0, -240),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.placement.top).toBeGreaterThan(target.rect.top);
  });

  it("never leaves the canvas on a narrow viewport", () => {
    const narrow: Frame = { ...frame, viewport: { width: 300, height: 600 } };
    const target = noteBarTarget({
      widget: note("n", 0, 0),
      frame: narrow,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.placement.left).toBeGreaterThanOrEqual(8);
    expect(target.placement.left).toBeLessThanOrEqual(narrow.viewport.width - 8);
  });

  it("centres a shape's bar on the shape, not off the right edge", () => {
    const wide: Frame = { ...frame, viewport: { width: 1440, height: 900 } };
    const shape = note("s", 0, 0, { type: "shape", shapeKind: "rectangle" });
    const shapeBar = noteBarTarget({ widget: shape, frame: wide, settings: DEFAULT_SETTINGS, marks: null })!;
    const noteBar = noteBarTarget({ widget: note("n", 0, 0), frame: wide, settings: DEFAULT_SETTINGS, marks: null })!;
    // The shape bar has no S/M/L row, so it is narrower than the note's.
    expect(shapeBar.placement.left).toBe(720 - 213);
    expect(noteBar.placement.left).toBe(720 - 258);
  });

  it("gives a free text object its own kind and its own ink", () => {
    const textWidget = note("t", 0, 0, {
      type: "text",
      style: { color: "#8a35d6" },
    });
    const target = noteBarTarget({
      widget: textWidget,
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.kind).toBe("text");
    expect(target.textColor).toBe("#8a35d6");
    expect(target.ink).toBe("#8a35d6");
  });

  it("has nothing to show for a connector or a card", () => {
    for (const widget of [connector(0, 0), note("c", 0, 0, { type: "card" })]) {
      expect(
        noteBarTarget({ widget, frame, settings: DEFAULT_SETTINGS, marks: null }),
      ).toBeNull();
    }
  });

  it("marks a locked note as not editable", () => {
    const target = noteBarTarget({
      widget: note("n", 0, 0, { locked: true }),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.editable).toBe(false);
  });

  it("shows the ink the painter would draw", () => {
    const light = noteBarTarget({
      widget: note("n", 0, 0, { style: { fillColor: "#ffdd33" } }),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    const dark = noteBarTarget({
      widget: note("d", 0, 0, { style: { fillColor: "#1a1a1a" } }),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(light.ink).toBe("#1a1a1a");
    expect(dark.ink).toBe("#ffffff");
  });
});

describe("the arrange bar", () => {
  it("counts two objects as two units", () => {
    const widgets = [note("a", -100, 0), note("b", 100, 0)];
    const target = arrangeBarTarget({
      selectedIds: ["a", "b"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.units).toBe(2);
    expect(target.canArrange).toBe(true);
    // Union box centre (400) minus half of the 500 px arrange bar.
    expect(target.placement.left).toBe(400 - 250);
    expect(target.placement.top).toBe(250 - COMPACT_BAR_ROOM);
  });

  it("names the selection by type, the biggest group first", () => {
    const widgets = [
      note("a", -100, 0),
      note("b", 0, 0),
      note("c", 100, 0),
      note("s", 200, 0, { type: "shape", shapeKind: "rectangle" }),
    ];
    const target = arrangeBarTarget({
      selectedIds: ["a", "b", "c", "s"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.objects).toBe(4);
    expect(target.types).toEqual([
      { type: "sticky_note", count: 3 },
      { type: "shape", count: 1 },
    ]);
  });

  it("needs two units: one object or one group is not arrangeable", () => {
    const single = [note("a", 0, 0)];
    expect(
      arrangeBarTarget({ selectedIds: ["a"], frame, resolve: resolveWith(single) }),
    ).toBeNull();

    const grouped = [note("a", -100, 0, { groupId: "g" }), note("b", 0, 0, { groupId: "g" })];
    expect(
      arrangeBarTarget({
        selectedIds: ["a", "b"],
        frame,
        resolve: resolveWith(grouped),
      }),
    ).toBeNull();
  });

  it("counts a group as one unit next to a loose note", () => {
    const widgets = [
      note("a", -100, 0, { groupId: "g" }),
      note("b", 0, 0, { groupId: "g" }),
      note("c", 200, 0),
    ];
    const target = arrangeBarTarget({
      selectedIds: ["a", "b", "c"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.units).toBe(2);
    // The name of the selection is the count of objects, not of movable units.
    expect(target.objects).toBe(3);
  });

  it("shows a pair of lines for their shared colour, with nothing to arrange", () => {
    const widgets = [
      connector(0, 0, { id: "l1" }),
      connector(0, 100, { id: "l2" }),
    ];
    const target = arrangeBarTarget({
      selectedIds: ["l1", "l2"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.canArrange).toBe(false);
    expect(target.colour).toEqual({ role: "line", value: "#1a1a1a", mixed: false });
  });

  it("ignores cards as units of their own", () => {
    const widgets = [note("c1", 0, 0, { type: "card" }), note("c2", 200, 0, { type: "card" })];
    expect(
      arrangeBarTarget({
        selectedIds: ["c1", "c2"],
        frame,
        resolve: resolveWith(widgets),
      }),
    ).toBeNull();
  });
});

describe("the shared colour role", () => {
  it("is the fill when every selected object paints one", () => {
    expect(commonColour([note("a", 0, 0), note("b", 0, 0)])).toEqual({
      role: "fill",
      value: "#ffdd33",
      mixed: false,
    });
    const mixed = commonColour([
      note("a", 0, 0, { style: { fillColor: "#ffdd33" } }),
      note("b", 0, 0, { type: "shape", style: { fillColor: "#ffffff" } }),
    ])!;
    expect(mixed.role).toBe("fill");
    expect(mixed.mixed).toBe(true);
  });

  it("is absent when the selection mixes a note with a line", () => {
    expect(commonColour([note("a", 0, 0), connector(0, 0)])).toBeNull();
  });
});

describe("the connector bar", () => {
  // The bar is the widest of the floating bars, so it is measured against the design
  // viewport rather than the 800 px test frame it would be pinned inside.
  const wide: Frame = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { width: 1440, height: 900 } };

  it("sits over the line, not over its chord", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    const target = connectorBarTarget({
      widget: connector(200, 0),
      frame: wide,
      settings: DEFAULT_SETTINGS,
      resolve: resolveWith(widgets),
    })!;
    // Path centre (720 + 200) minus half of the label-less bar.
    expect(target.placement.left).toBe(920 - 220);
    expect(target.placement.top).toBeLessThan(400);
  });

  it("centres the wider bar once the line carries text", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    const target = connectorBarTarget({
      widget: connector(200, 0, { content: "ok" }),
      frame: wide,
      settings: DEFAULT_SETTINGS,
      resolve: resolveWith(widgets),
    })!;
    // The label adds its size controls; its colour lives in the same window (ADR-127).
    expect(target.hasLabel).toBe(true);
    expect(target.placement.left).toBe(920 - 270);
  });

  it("is absent for a locked line, and for anything that is not a connector", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    expect(
      connectorBarTarget({
        widget: connector(200, 0, { locked: true }),
        frame,
        settings: DEFAULT_SETTINGS,
        resolve: resolveWith(widgets),
      }),
    ).toBeNull();
    expect(
      connectorBarTarget({
        widget: note("n", 0, 0),
        frame,
        settings: DEFAULT_SETTINGS,
        resolve: resolveWith(widgets),
      }),
    ).toBeNull();
  });

  it("shows the line's own controls", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    const target = connectorBarTarget({
      widget: connector(200, 0, {
        routing: "elbow",
        arrow: "both",
        content: "ok",
        style: { strokeColor: "#e03131", strokeWidth: 4, strokeStyle: "dashed", textColor: "#305bab" },
      }),
      frame,
      settings: DEFAULT_SETTINGS,
      resolve: resolveWith(widgets),
    })!;
    expect(target).toMatchObject({
      routing: "elbow",
      arrow: "both",
      strokeColor: "#e03131",
      strokeWidth: 4,
      strokeStyle: "dashed",
      hasLabel: true,
      ink: "#305bab",
    });
  });
});

describe("the edge continue targets (ADR-195)", () => {
  it("puts four 44 px hit areas on the side midpoints", () => {
    const targets = edgeContinueTargets(note("n", 0, 0), frame);
    expect(targets.map((target) => target.direction).sort()).toEqual([
      "down",
      "left",
      "right",
      "up",
    ]);
    expect(targets.find((target) => target.direction === "right")).toMatchObject({
      left: 458,
      top: 278,
    });
    expect(targets.find((target) => target.direction === "left")).toMatchObject({
      left: 298,
      top: 278,
    });
  });
});
