import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import {
  BoardDocument,
  deleteWidgets,
  fitFrameToContents,
  loadBoard,
  moveWidgets,
  setWidgetRects,
  transformSelection,
} from "./board";

/**
 * Resizing a frame (ADR-141).
 *
 * The box is the container's own property: contents keep their size and position,
 * while membership follows the centre rule of ADR-110. These tests pin the three
 * outcomes a person can produce with a corner handle — grow, shrink, and the
 * minimum that stops the frame from collapsing.
 */

function boardWith(widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  loadBoard(board, { id: "t", title: "Frames", widgets }, {});
  return board;
}

function note(
  id: string,
  at: { x: number; y: number },
  parentId: string | null = null,
): Widget {
  return { id, type: "sticky_note", parentId, x: at.x, y: at.y, width: 40, height: 40 };
}

function frame(id: string, width: number, height: number, at = { x: 0, y: 0 }): Widget {
  return {
    id,
    type: "frame",
    parentId: null,
    x: at.x,
    y: at.y,
    width,
    height,
    title: id,
  };
}

function shape(id: string, at = { x: 0, y: 0 }): Widget {
  return {
    id,
    type: "shape",
    parentId: null,
    x: at.x,
    y: at.y,
    width: 260,
    height: 160,
    shapeKind: "rectangle",
    content: "Label",
    style: { fillColor: "#ffffff", strokeColor: "#1a1a1a", strokeWidth: 2 },
  };
}

describe("a frame can be resized (ADR-141)", () => {
  it("grows without scaling or moving its children", () => {
    const board = boardWith([frame("f", 200, 200), note("a", { x: 0, y: 0 }, "f")]);

    setWidgetRects(board, [{ id: "f", x: 0, y: 0, width: 600, height: 400 }]);

    expect(board.widgets.get("f")).toMatchObject({ width: 600, height: 400 });
    // The child is not scaled to the new box and not moved with the corner.
    expect(board.widgets.get("a")).toMatchObject({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      parentId: "f",
    });
  });

  it("releases a child whose centre the shrinking frame no longer covers", () => {
    const board = boardWith([frame("f", 400, 300), note("a", { x: 150, y: 0 }, "f")]);

    // New box is [-100, 100] × [-150, 150]; the centre at x = 150 is outside.
    setWidgetRects(board, [{ id: "f", x: 0, y: 0, width: 200, height: 300 }]);

    expect(board.widgets.get("a")).toMatchObject({
      x: 150,
      y: 0,
      width: 40,
      height: 40,
      parentId: null,
    });
  });

  it("adopts a free object whose centre the grown frame reaches", () => {
    const board = boardWith([frame("f", 200, 200), note("a", { x: 200, y: 0 })]);

    // New box is [-300, 300] × [-200, 200]: the free note's centre is now inside.
    setWidgetRects(board, [{ id: "f", x: 0, y: 0, width: 600, height: 400 }]);

    expect(board.widgets.get("a")).toMatchObject({
      x: 200,
      y: 0,
      width: 40,
      height: 40,
      parentId: "f",
    });
  });

  it("hands a released child to the smallest frame that still contains it", () => {
    const board = boardWith([
      frame("outer", 600, 600),
      frame("inner", 200, 200),
      note("a", { x: 100, y: 0 }, "inner"),
    ]);

    // The inner frame stops at its 160 minimum, so its right edge is x = 80 and the
    // child's centre at 100 leaves it — but the outer frame still covers the centre.
    setWidgetRects(board, [{ id: "inner", x: 0, y: 0, width: 60, height: 60 }]);

    expect(board.widgets.get("inner")).toMatchObject({ width: 160, height: 120 });
    expect(board.widgets.get("a")).toMatchObject({ x: 100, y: 0, parentId: "outer" });
  });

  it("clamps a frame to its minimum and keeps the child in place", () => {
    const board = boardWith([frame("f", 400, 300), note("a", { x: 0, y: 0 }, "f")]);

    setWidgetRects(board, [{ id: "f", x: 0, y: 0, width: 10, height: 10 }]);

    expect(board.widgets.get("f")).toMatchObject({ width: 160, height: 120 });
    expect(board.widgets.get("a")).toMatchObject({ x: 0, y: 0, width: 40, height: 40 });
  });

  it("resizes and reparents in one undo step", () => {
    const board = boardWith([frame("f", 400, 300), note("a", { x: 150, y: 0 }, "f")]);

    setWidgetRects(board, [{ id: "f", x: 0, y: 0, width: 200, height: 300 }]);
    expect(board.widgets.get("a")!.parentId).toBeNull();

    board.undoOnce();

    expect(board.widgets.get("f")).toMatchObject({ width: 400, height: 300 });
    expect(board.widgets.get("a")!.parentId).toBe("f");
  });

  it("does not reparent a locked child", () => {
    const board = boardWith([
      frame("f", 400, 300),
      { ...note("a", { x: 150, y: 0 }, "f"), locked: true },
    ]);

    setWidgetRects(board, [{ id: "f", x: 0, y: 0, width: 200, height: 300 }]);

    expect(board.widgets.get("a")!.parentId).toBe("f");
  });
});

describe("a shape resizes like a note (ADR-145)", () => {
  it("clamps the box to the generic 80 × 60 floor", () => {
    const board = boardWith([shape("s")]);

    setWidgetRects(board, [{ id: "s", x: 10, y: 20, width: 10, height: 10 }]);

    expect(board.widgets.get("s")).toMatchObject({ x: 10, y: 20, width: 80, height: 60 });
  });

  it("changes the box only: text, shape kind and style stay as they were", () => {
    const board = boardWith([shape("s")]);
    const before = board.widgets.get("s")!;

    setWidgetRects(board, [{ id: "s", x: 0, y: 0, width: 420, height: 300 }]);

    expect(board.widgets.get("s")).toMatchObject({
      width: 420,
      height: 300,
      content: "Label",
      shapeKind: "rectangle",
      style: before.style,
    });
    expect(board.texts.get("s")?.toString()).toBe("Label");
  });

  it("is one undo step", () => {
    const board = boardWith([shape("s")]);

    setWidgetRects(board, [{ id: "s", x: 0, y: 0, width: 420, height: 300 }]);
    board.undoOnce();

    expect(board.widgets.get("s")).toMatchObject({
      x: 0,
      y: 0,
      width: 260,
      height: 160,
      content: "Label",
    });
  });
});

/**
 * Repairing an agent draft (ADR-189): an older frame may not contain the objects that
 * belong to it. One local action grows the frame, never the children.
 */
describe("fitFrameToContents", () => {
  it("grows a frame around a child that sits outside it", () => {
    const board = boardWith([
      frame("f", 400, 300),
      note("inside", { x: 20, y: 20 }, "f"),
      note("outside", { x: 500, y: 420 }, "f"),
    ]);
    expect(fitFrameToContents(board, "f", 20)).toBe(true);
    const grown = board.readWidget("f")!;
    expect(grown.x - grown.width / 2).toBe(-200);
    expect(grown.y - grown.height / 2).toBe(-150);
    expect(grown.x + grown.width / 2).toBe(540);
    expect(grown.y + grown.height / 2).toBe(460);
    // The children keep their positions: this is a frame repair, not a layout.
    expect(board.readWidget("outside")!.x).toBe(500);
  });

  it("does nothing when the frame already contains its children", () => {
    const board = boardWith([frame("f", 400, 300), note("inside", { x: 20, y: 20 }, "f")]);
    expect(fitFrameToContents(board, "f", 0)).toBe(false);
  });

  it("refuses a locked frame and a non-frame", () => {
    const board = boardWith([
      { ...frame("f", 400, 300), locked: true },
      note("inside", { x: 500, y: 500 }, "f"),
      note("loose", { x: 0, y: 0 }),
    ]);
    expect(fitFrameToContents(board, "f")).toBe(false);
    expect(fitFrameToContents(board, "loose")).toBe(false);
  });
});

/**
 * A lock protects content, not placement (ADR-210, amending ADR-040).
 *
 * A locked object may be carried by its neighbours; its size, text and links stay
 * protected, and deletion still refuses it.
 */
describe("a lock protects content, not placement (ADR-210)", () => {
  it("moves a locked widget with the rest of the selection", () => {
    const board = boardWith([
      { ...note("a", { x: 0, y: 0 }), locked: true },
      note("b", { x: 100, y: 0 }),
    ]);

    moveWidgets(board, [
      { id: "a", x: 10, y: 20 },
      { id: "b", x: 110, y: 20 },
    ]);

    expect(board.widgets.get("a")).toMatchObject({ x: 10, y: 20, locked: true });
    expect(board.widgets.get("b")).toMatchObject({ x: 110, y: 20 });
  });

  it("still refuses to change a locked widget's size", () => {
    const board = boardWith([{ ...note("a", { x: 0, y: 0 }), locked: true }]);

    setWidgetRects(board, [{ id: "a", x: 0, y: 0, width: 200, height: 160 }]);

    expect(board.widgets.get("a")).toMatchObject({ width: 40, height: 40 });
  });

  it("is one undo step for a selection that contains a lock", () => {
    const board = boardWith([
      { ...note("a", { x: 0, y: 0 }), locked: true },
      note("b", { x: 100, y: 0 }),
    ]);

    moveWidgets(board, [
      { id: "a", x: 30, y: 40 },
      { id: "b", x: 130, y: 40 },
    ]);
    board.undoOnce();

    expect(board.widgets.get("a")).toMatchObject({ x: 0, y: 0 });
    expect(board.widgets.get("b")).toMatchObject({ x: 100, y: 0 });
  });

  it("still refuses to delete a locked widget", () => {
    const board = boardWith([{ ...note("a", { x: 0, y: 0 }), locked: true }]);

    deleteWidgets(board, ["a"]);

    expect(board.widgets.get("a")).toBeTruthy();
  });
});

/**
 * A block transform (ADR-211): one factor for the whole box, and only what can scale
 * changes size. A locked object and a table section keep their size and travel.
 */
describe("transformSelection (ADR-211)", () => {
  const big = (id: string, at: { x: number; y: number }, extra: Partial<Widget> = {}): Widget => ({
    ...note(id, at),
    width: 160,
    height: 120,
    ...extra,
  });

  it("scales what can scale and carries the rest without resizing it", () => {
    const board = boardWith([big("a", { x: 100, y: 100 }), big("b", { x: 400, y: 100 }, { locked: true })]);

    transformSelection(board, [
      { id: "a", x: 90, y: 90, width: 100, height: 80 },
      // The size in the box is what the geometry proposed; the command must ignore it.
      { id: "b", x: 360, y: 90, width: 100, height: 80 },
    ]);

    expect(board.widgets.get("a")).toMatchObject({ x: 90, y: 90, width: 100, height: 80 });
    expect(board.widgets.get("b")).toMatchObject({ x: 360, y: 90, width: 160, height: 120, locked: true });
  });

  it("is one undo step for a block with a lock", () => {
    const board = boardWith([big("a", { x: 100, y: 100 }), big("b", { x: 400, y: 100 }, { locked: true })]);

    transformSelection(board, [
      { id: "a", x: 90, y: 90, width: 100, height: 80 },
      { id: "b", x: 360, y: 90, width: 100, height: 80 },
    ]);
    board.undoOnce();

    expect(board.widgets.get("a")).toMatchObject({ x: 100, y: 100, width: 160, height: 120 });
    expect(board.widgets.get("b")).toMatchObject({ x: 400, y: 100, width: 160, height: 120 });
  });

  it("moves a table section and leaves its size and cells to the table", () => {
    const table: Widget = {
      ...frame("t", 400, 300),
      layout: {
        kind: "table",
        columns: [{ id: "c1", title: "C1" }],
        rows: [{ id: "r1", title: "R1" }],
      },
    };
    const child = { ...note("c", { x: 50, y: 50 }, "t"), width: 40, height: 40 };
    const board = boardWith([table, child]);

    transformSelection(board, [{ id: "t", x: 50, y: 50, width: 100, height: 100 }]);

    const section = board.widgets.get("t")!;
    // The block proposed 100 × 100; a table section's size comes from its axes (ADR-201),
    // so it travels and keeps the size the table gives it.
    expect(section).toMatchObject({ x: 50, y: 50 });
    expect(section.width).toBeGreaterThan(100);
    expect(section.height).toBeGreaterThan(100);
    // A cell object is placed by the table, not by the block's delta (ADR-203).
    expect(board.widgets.get("c")!.x).toBeGreaterThan(50);
  });

  it("resizes a frame without moving its contents", () => {
    const board = boardWith([frame("f", 400, 300), note("c", { x: 50, y: 50 }, "f")]);

    transformSelection(board, [{ id: "f", x: 0, y: 0, width: 200, height: 300 }]);

    expect(board.widgets.get("f")).toMatchObject({ width: 200 });
    expect(board.widgets.get("c")).toMatchObject({ x: 50, y: 50, width: 40, height: 40 });
  });

  it("does not shift a child twice when the block lists both it and its container", () => {
    const outer = { ...frame("outer", 400, 300), locked: true };
    const middle = { ...frame("middle", 200, 200), parentId: "outer", locked: true };
    const leaf = note("leaf", { x: 50, y: 50 }, "middle");
    const board = boardWith([outer, middle, leaf]);

    transformSelection(board, [
      { id: "outer", x: 50, y: 50, width: 400, height: 300 },
      { id: "middle", x: 50, y: 50, width: 200, height: 200 },
    ]);

    expect(board.widgets.get("outer")).toMatchObject({ x: 50, y: 50 });
    expect(board.widgets.get("middle")).toMatchObject({ x: 50, y: 50 });
    // The leaf follows the outermost carried container exactly once.
    expect(board.widgets.get("leaf")).toMatchObject({ x: 100, y: 100 });
  });
});

/**
 * A block transform carries a connector's bends with it (ADR-211), and a gesture that
 * changed nothing is not an edit.
 */
describe("transformSelection: connectors and no-ops (ADR-211)", () => {
  it("scales the bends of a connector whose both ends travel", () => {
    const board = boardWith([
      { ...note("a", { x: 50, y: 50 }), width: 160, height: 120 },
      { ...note("b", { x: 150, y: 50 }), width: 160, height: 120 },
      {
        id: "c",
        type: "connector",
        parentId: null,
        x: 100,
        y: 50,
        width: 100,
        height: 0,
        start: { item: "a", side: "right" },
        end: { item: "b", side: "left" },
        waypoints: [{ id: "w", x: 100, y: 50, rigid: true }],
      },
    ]);

    transformSelection(
      board,
      [
        { id: "a", x: 50, y: 50, width: 160, height: 120 },
        { id: "b", x: 350, y: 50, width: 160, height: 120 },
      ],
      { from: { x: 0, y: 0, width: 200, height: 100 }, kx: 2, ky: 1 },
    );

    expect(board.widgets.get("c")!.waypoints?.[0]).toMatchObject({ x: 200, y: 50 });
  });

  it("does not keep a bend of a connector with only one end inside", () => {
    const board = boardWith([
      { ...note("a", { x: 50, y: 50 }), width: 160, height: 120 },
      { ...note("b", { x: 900, y: 50 }), width: 160, height: 120 },
      {
        id: "c",
        type: "connector",
        parentId: null,
        x: 100,
        y: 50,
        width: 800,
        height: 0,
        start: { item: "a", side: "right" },
        end: { item: "b", side: "left" },
        waypoints: [{ id: "w", x: 100, y: 50, rigid: true }],
      },
    ]);

    transformSelection(
      board,
      [{ id: "a", x: 250, y: 50, width: 160, height: 120 }],
      { from: { x: 0, y: 0, width: 200, height: 100 }, kx: 2, ky: 1 },
    );

    expect(board.widgets.get("c")!.waypoints?.[0]).toMatchObject({ x: 100, y: 50 });
  });

  it("does not record an undo step when nothing changed", () => {
    const board = boardWith([note("a", { x: 50, y: 50 })]);
    const before = board.widgets.get("a");

    transformSelection(board, [{ id: "a", x: 50, y: 50, width: 40, height: 40 }]);
    board.undoOnce();

    expect(board.widgets.get("a")).toEqual(before);
  });
});
