import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { BoardDocument, loadBoard, setWidgetRects } from "./board";

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
