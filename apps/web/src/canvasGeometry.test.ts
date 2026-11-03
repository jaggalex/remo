import { describe, expect, it } from "vitest";
import type { NoteDirection } from "@remo/doc";
import { minimumSizeOf, type ConnectorSide, type Widget } from "@remo/model";
import {
  ANCHOR_GAP,
  anchorSlotDecision,
  anchorsOf,
  barTop,
  connectTargetAt,
  copySlot,
  bendAxis,
  cornerAt,
  cornerPoints,
  directionOfSide,
  internalConnectors,
  nearestAnchor,
  placedWidget,
  resizedBox,
  sideOfDirection,
} from "./canvasGeometry";

/**
 * The canvas geometry is pure, so it is tested directly instead of through a browser.
 *
 * These functions were the bottom third of BoardCanvas.tsx and changed whenever a
 * gesture did — with no test between them and the screen (ADR-054).
 */

const note = (x = 0, y = 0, width = 100, height = 100): Widget => ({
  id: "n",
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width,
  height,
});

describe("anchors", () => {
  it("picks the side whose anchor is nearest the pointer", () => {
    const widget = note(0, 0, 200, 100);
    expect(nearestAnchor(widget, { x: 200, y: 0 }).side).toBe("right");
    expect(nearestAnchor(widget, { x: -200, y: 0 }).side).toBe("left");
    expect(nearestAnchor(widget, { x: 0, y: -200 }).side).toBe("top");
    expect(nearestAnchor(widget, { x: 0, y: 200 }).side).toBe("bottom");
  });

  it("answers with a point on the edge, not the dot outside it", () => {
    const widget = note(0, 0, 200, 100);
    const right = nearestAnchor(widget, { x: 500, y: 0 });
    // The drawn dot sits ANCHOR_GAP outside; the attachment point is the edge itself.
    expect(right.x).toBe(100);
    expect(ANCHOR_GAP).toBeGreaterThan(0);
  });

  it("offers four anchors: one at each side midpoint", () => {
    const anchors = anchorsOf(note(0, 0, 200, 100));
    expect(anchors).toHaveLength(4);
    expect(anchors.map((a) => a.side).sort()).toEqual(["bottom", "left", "right", "top"]);
    expect(anchors.every((a) => a.x !== undefined && a.y !== undefined)).toBe(true);
    // Corners are not ports: the point nearest a corner resolves to one side, never
    // to an offset along it (ADR-137). A wide note's corner belongs to its short side.
    expect(nearestAnchor(note(0, 0, 200, 100), { x: 100, y: -50 }).side).toBe("right");
    expect(nearestAnchor(note(0, 0, 200, 100), { x: -100, y: -50 }).side).toBe("left");
  });

  it("finds a connectable object within the 160 px target radius", () => {
    const widgets = [note(0, 0), note(700, 0)];
    const from = { x: 300, y: 0 };
    expect(connectTargetAt(from, new Map(), widgets, () => false, 160)).toBeNull();
    expect(connectTargetAt({ x: 180, y: 0 }, new Map(), widgets, () => false, 160)?.id).toBe("n");
  });

  it("maps a side to the direction a chained note would go", () => {
    const expected: Record<ConnectorSide, NoteDirection> = {
      left: "left",
      right: "right",
      top: "up",
      bottom: "down",
    };
    for (const [side, direction] of Object.entries(expected)) {
      expect(directionOfSide(side as ConnectorSide)).toBe(direction);
    }
  });
});

describe("floating bar placement", () => {
  const viewport = { height: 600 };

  it("sits above the object when there is room", () => {
    expect(barTop({ top: 200, height: 100 }, viewport)).toBe(148);
  });

  it("drops below the object when the top is too close to the edge", () => {
    // top 20 leaves no room for a 52px bar, so it goes under the object instead.
    expect(barTop({ top: 20, height: 100 }, viewport)).toBe(132);
  });

  it("stays inside the canvas when neither side has room", () => {
    // A tall selection: above is negative, below is past the bottom.
    const top = barTop({ top: 10, height: 580 }, viewport);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(viewport.height - 48);
  });

  it("never pushes the bar past the bottom on a short canvas", () => {
    const top = barTop({ top: 0, height: 500 }, { height: 300 });
    expect(top).toBeLessThanOrEqual(300 - 48);
    expect(top).toBeGreaterThanOrEqual(8);
  });
});

describe("resize handles", () => {
  const box = { x: 0, y: 0, width: 200, height: 100 };

  it("puts four handles outside the corners", () => {
    const points = cornerPoints(box, 7);
    expect(points.map((entry) => entry.corner)).toEqual(["nw", "ne", "sw", "se"]);
    // Pushed out diagonally, away from the box centre.
    expect(points[0]).toMatchObject({ x: -7, y: -7 });
    expect(points[3]).toMatchObject({ x: 207, y: 107 });
  });

  it("finds the handle under the pointer and ignores the middle of the box", () => {
    expect(cornerAt(box, { x: -7, y: -7 }, 10, 7)).toBe("nw");
    expect(cornerAt(box, { x: 207, y: 107 }, 10, 7)).toBe("se");
    expect(cornerAt(box, { x: 100, y: 50 }, 10, 7)).toBeNull();
    // Just outside the tolerance: no handle.
    expect(cornerAt(box, { x: -30, y: -30 }, 10, 7)).toBeNull();
  });

  it("keeps the opposite corner fixed while dragging", () => {
    const resized = resizedBox(box, "se", { x: 300, y: 220 }, 40, 30);
    expect(resized).toEqual({ x: 0, y: 0, width: 300, height: 220 });

    const fromNorthWest = resizedBox(box, "nw", { x: -50, y: -20 }, 40, 30);
    expect(fromNorthWest).toEqual({ x: -50, y: -20, width: 250, height: 120 });
  });

  it("refuses to collapse the box past its minimum", () => {
    const tiny = resizedBox(box, "se", { x: -100, y: -100 }, 40, 30);
    expect(tiny.width).toBeGreaterThanOrEqual(40);
    expect(tiny.height).toBeGreaterThanOrEqual(30);
    expect(tiny.x).toBe(0);
    expect(tiny.y).toBe(0);
  });

  it("keeps a frame above the floor its kind declares (ADR-141)", () => {
    const floor = minimumSizeOf("frame");
    const tiny = resizedBox(
      { x: 0, y: 0, width: 640, height: 420 },
      "se",
      { x: 1, y: 1 },
      floor.width,
      floor.height,
    );
    expect(tiny).toMatchObject({ x: 0, y: 0, width: 160, height: 120 });
  });

  it("clamps a shape to the same 80 × 60 floor as a note (ADR-145)", () => {
    const floor = minimumSizeOf("shape");
    expect(floor).toEqual({ width: 80, height: 60 });
    const tiny = resizedBox(
      { x: 0, y: 0, width: 260, height: 160 },
      "nw",
      { x: 250, y: 150 },
      floor.width,
      floor.height,
    );
    // The opposite corner stays put: only the dragged corner stops at the floor.
    expect(tiny).toMatchObject({ x: 180, y: 100, width: 80, height: 60 });
  });

  it("puts a shape's ports on the box the resize wrote (ADR-145)", () => {
    const floor = minimumSizeOf("shape");
    const box = resizedBox(
      { x: -130, y: -80, width: 260, height: 160 },
      "se",
      { x: 60, y: 50 },
      floor.width,
      floor.height,
    );
    const resized: Widget = {
      id: "s",
      type: "shape",
      parentId: null,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      width: box.width,
      height: box.height,
    };
    const ports = anchorsOf(resized);
    // Nothing about a port is stored: it is the midpoint of the new edge.
    expect(ports.find((port) => port.side === "right")).toMatchObject({
      x: box.x + box.width,
      y: box.y + box.height / 2,
    });
    expect(ports.find((port) => port.side === "bottom")).toMatchObject({
      x: box.x + box.width / 2,
      y: box.y + box.height,
    });
  });
});

describe("elbow reshaping", () => {
  const elbow = {
    id: "c",
    type: "connector" as const,
    parentId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    connectorShape: "elbowed" as const,
  };

  it("slides the middle run in x when the run is vertical", () => {
    // A Z route: out of a right side, into a left side, with a vertical run at x=200.
    const path = {
      points: [
        { x: 50, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 350, y: 200 },
      ],
    };
    const axis = bendAxis(elbow, path, {});
    expect(axis.axis).toBe("x");
    expect(axis.to! - axis.from!).toBeGreaterThan(0);
  });

  it("has nothing to slide when the route has a single corner", () => {
    const path = {
      points: [
        { x: 0, y: 50 },
        { x: 0, y: 300 },
        { x: 350, y: 300 },
      ],
    };
    expect(bendAxis(elbow, path, {})).toEqual({});
  });

  it("ignores a line that is not an elbow", () => {
    const straight = { ...elbow, connectorShape: "straight" as const };
    const path = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    expect(bendAxis(straight, path, {})).toEqual({});
  });
});

describe("cards as connector endpoints", () => {
  it("resolves a card's box through its kanban placement", () => {
    const card = { ...note(999, 999, 400, 80), type: "card" as const, parentId: "k1" };
    const layouts = new Map([
      ["k1", { placements: [{ cardId: "n", x: 120, y: 240, width: 400, height: 80 }] }],
    ]) as never;
    expect(placedWidget(card, layouts)).toMatchObject({
      x: 120,
      y: 240,
      width: 400,
      height: 80,
    });
    // A non-card is returned unchanged.
    expect(placedWidget(note(5, 6), layouts)).toMatchObject({ x: 5, y: 6 });
  });
});

describe("port click and the copy slot (ADR-137)", () => {
  const item = (
    id: string,
    x: number,
    y: number,
    width = 100,
    height = 100,
    type: Widget["type"] = "sticky_note",
    z?: number,
  ): Widget => ({ id, type, parentId: null, x, y, width, height, ...(z !== undefined ? { z } : {}) });

  // A predictable gap: the copy of a 100×100 note starts 60 units to the right.
  const gap = { ratio: 0, min: 60 };
  const source = item("a", 0, 0);

  it("places the copy's slot clear of the source even for a large object", () => {
    const big = item("big", 0, 0, 900, 300);
    const slot = copySlot(big, "right", { ratio: 0, min: 0 });
    expect(slot.rect.x).toBeGreaterThanOrEqual(big.x + big.width / 2);
    expect(slot.rect.width).toBe(900);
    expect(copySlot(source, "down", gap).center).toEqual({ x: 0, y: 160 });
  });

  it("calls the slot occupied by intersection, not by the object's centre", () => {
    // A wide note reaches into the slot; its centre (350) is outside the copy (110…210).
    const wide = item("wide", 350, 0, 400, 100);
    expect(anchorSlotDecision(source, "right", [source, wide], new Map(), gap)).toMatchObject({
      kind: "connect",
      target: { id: "wide" },
    });
    // A note that merely sits nearby without touching the slot leaves it free.
    const nearby = item("near", 300, 0);
    expect(anchorSlotDecision(source, "right", [source, nearby], new Map(), gap).kind).toBe("clone");
  });

  it("ignores a frame, a kanban and a connector standing in the slot", () => {
    const frame = item("f", 160, 0, 300, 300, "frame");
    const kanban = item("k", 160, 0, 300, 300, "kanban");
    const line = item("l", 160, 0, 300, 300, "connector");
    expect(
      anchorSlotDecision(source, "right", [source, frame, kanban, line], new Map(), gap).kind,
    ).toBe("clone");
  });

  it("prefers the source's own type over a nearer object of another type", () => {
    const shape = item("shape", 160, 0, 100, 100, "shape");
    const sticky = item("sticky", 180, 0);
    expect(
      anchorSlotDecision(source, "right", [source, shape, sticky], new Map(), gap),
    ).toMatchObject({ kind: "connect", target: { id: "sticky" } });
  });

  it("then takes the object nearest the copy's centre", () => {
    const near = item("near", 170, 0);
    const far = item("far", 205, 0);
    expect(
      anchorSlotDecision(source, "right", [source, far, near], new Map(), gap),
    ).toMatchObject({ kind: "connect", target: { id: "near" } });
  });

  it("then takes the topmost layer when two objects are equally near", () => {
    const low = item("low", 160, 0, 100, 100, "sticky_note", 1);
    const high = item("high", 160, 0, 100, 100, "sticky_note", 9);
    expect(
      anchorSlotDecision(source, "right", [source, high, low], new Map(), gap),
    ).toMatchObject({ kind: "connect", target: { id: "high" } });
  });

  it("never picks the source itself and always connects to the port facing A", () => {
    const target = item("b", 160, 0);
    expect(anchorSlotDecision(source, "right", [source], new Map(), gap).kind).toBe("clone");
    const decision = anchorSlotDecision(source, "right", [source, target], new Map(), gap);
    expect(decision).toMatchObject({ kind: "connect", target: { id: "b" }, endSide: "left" });
  });

  it("reports an existing pair instead of asking for a second line", () => {
    const target = item("b", 160, 0);
    const line: Widget = {
      ...item("line", 0, 0, 0, 0, "connector"),
      start: { item: "a" },
      end: { item: "b" },
    };
    expect(
      anchorSlotDecision(source, "right", [source, target, line], new Map(), gap).kind,
    ).toBe("duplicate");
  });

  it("resolves a card in the slot through its kanban placement", () => {
    const card: Widget = { ...item("card", 9999, 9999, 10, 10, "card"), parentId: "k1" };
    const layouts = new Map([
      ["k1", { placements: [{ cardId: "card", x: 160, y: 0, width: 100, height: 100 }] }],
    ]) as never;
    expect(
      anchorSlotDecision(source, "right", [source, card], layouts, gap),
    ).toMatchObject({ kind: "connect", target: { id: "card" } });
  });

  it("maps a direction back to the port it grows from", () => {
    expect(sideOfDirection("right")).toBe("right");
    expect(sideOfDirection("left")).toBe("left");
    expect(sideOfDirection("up")).toBe("top");
    expect(sideOfDirection("down")).toBe("bottom");
  });
});

describe("lines brought in by a selection (ADR-138)", () => {
  const item = (
    id: string,
    type: Widget["type"] = "sticky_note",
    parentId: string | null = null,
  ): Widget => ({ id, type, parentId, x: 0, y: 0, width: 100, height: 100 });

  const line = (id: string, from: string | undefined, to: string | undefined): Widget => ({
    ...item(id, "connector"),
    ...(from ? { start: { item: from } } : {}),
    ...(to ? { end: { item: to } } : {}),
  });

  it("takes a line whose both ends are in the set, either way round", () => {
    const widgets = [item("a"), item("b"), line("l", "a", "b"), line("m", "b", "a")];
    expect(internalConnectors(widgets, ["a", "b"]).map((w) => w.id)).toEqual(["l", "m"]);
  });

  it("leaves a line alone when only one end is inside", () => {
    const widgets = [item("a"), item("b"), line("l", "a", "b")];
    expect(internalConnectors(widgets, ["a"])).toEqual([]);
    expect(internalConnectors(widgets, ["a", "c"]).map((w) => w.id)).toEqual([]);
  });

  it("ignores a broken line: one end, or none at all", () => {
    const widgets = [item("a"), item("b"), line("one", "a", undefined), line("none", undefined, undefined)];
    expect(internalConnectors(widgets, ["a", "b"])).toEqual([]);
  });

  it("counts a card's end through its kanban placement, not its stored x/y", () => {
    const cardA = item("card-a", "card", "k1");
    const cardB = item("card-b", "card", "k1");
    const note = item("note");
    const layouts = new Map([
      [
        "k1",
        {
          placements: [
            { cardId: "card-a", x: 10, y: 10, width: 100, height: 100 },
            { cardId: "card-b", x: 10, y: 200, width: 100, height: 100 },
          ],
        },
      ],
    ]) as never;
    const widgets = [cardA, cardB, note, line("cards", "card-a", "card-b"), line("out", "card-a", "note")];
    // A selected kanban is its cards, so the line between two of them comes along.
    expect(internalConnectors(widgets, ["k1"], layouts).map((w) => w.id)).toEqual(["cards"]);
    // The line to an object outside the set does not.
    expect(internalConnectors(widgets, ["k1", "note"], layouts).map((w) => w.id)).toEqual([
      "cards",
      "out",
    ]);
  });

  it("keeps a line between frame members and drops the one that leaves the frame", () => {
    const frame = item("frame-1", "frame");
    const inside = item("in-1", "sticky_note", "frame-1");
    const inside2 = item("in-2", "sticky_note", "frame-1");
    const outside = item("out-1");
    const widgets = [
      frame,
      inside,
      inside2,
      outside,
      line("within", "in-1", "in-2"),
      line("escaping", "in-1", "out-1"),
    ];
    // The export passes the frame and its descendants; the rule is the same set.
    expect(internalConnectors(widgets, ["frame-1", "in-1", "in-2"]).map((w) => w.id)).toEqual([
      "within",
    ]);
  });

  it("returns each line once, however many times the widget is listed", () => {
    const widgets = [item("a"), item("b"), line("l", "a", "b"), line("l", "a", "b")];
    expect(internalConnectors(widgets, ["a", "b", "a"]).map((w) => w.id)).toEqual(["l"]);
  });
});
