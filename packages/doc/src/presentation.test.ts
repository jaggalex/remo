import { describe, expect, it } from "vitest";
import { BoardDocument, setPresentationOrder } from "./board";
import {
  addAllFrames,
  movePresentationFrame,
  neighbouringFrame,
  presentationFrames,
  removePresentationFrame,
} from "./presentation";

function frame(id: string, x: number): { id: string; type: "frame"; parentId: null; x: number; y: number; width: number; height: number } {
  return { id, type: "frame", parentId: null, x, y: 0, width: 400, height: 300 };
}

describe("presentation order", () => {
  it("stores an explicit order independent of geometry", () => {
    const board = new BoardDocument();
    for (const widget of [frame("a", 0), frame("b", 900), frame("c", 1800)]) {
      board.widgets.set(widget.id, widget);
    }

    setPresentationOrder(board, ["c", "a", "b"]);
    expect(presentationFrames(board)).toEqual(["c", "a", "b"]);
    expect(board.snapshot().presentation).toEqual(["c", "a", "b"]);

    movePresentationFrame(board, "a", 2);
    expect(presentationFrames(board)).toEqual(["c", "b", "a"]);
    expect(neighbouringFrame(presentationFrames(board), "a", 1)).toBe("c");

    removePresentationFrame(board, "b");
    expect(presentationFrames(board)).toEqual(["c", "a"]);

    addAllFrames(board);
    expect(presentationFrames(board)).toEqual(["a", "b", "c"]);
  });

  it("ignores non-frames and missing ids", () => {
    const board = new BoardDocument();
    board.widgets.set("a", frame("a", 0));
    board.widgets.set("s", {
      id: "s",
      type: "sticky_note",
      parentId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    setPresentationOrder(board, ["s", "missing", "a"]);
    expect(presentationFrames(board)).toEqual(["a"]);
  });
});
