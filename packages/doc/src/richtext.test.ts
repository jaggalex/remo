import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Widget } from "@remo/model";
import { BoardDocument, createWidget, deltaOf, plainOf, runsOf, setWidgetDelta, setWidgetText } from "./board";

const sticky = (id: string): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x: 0,
  y: 0,
  width: 200,
  height: 200,
});

function boardWithNote(id = "n"): BoardDocument {
  const board = new BoardDocument();
  createWidget(board, sticky(id));
  return board;
}

describe("rich text", () => {
  it("keeps a plain edit on the plain path, so merging stays character-wise", () => {
    const board = boardWithNote();
    setWidgetDelta(board, "n", [{ insert: "hello" }]);
    const shared = board.texts.get("n")!;
    expect(shared).toBeInstanceOf(Y.Text);
    expect(shared).not.toBeInstanceOf(Y.XmlText);
    expect(plainOf(shared)).toBe("hello");
    expect(runsOf(shared)).toBeUndefined();
  });

  it("upgrades to rich text on the first mark and materializes runs", () => {
    const board = boardWithNote();
    setWidgetText(board, "n", "hello world");
    setWidgetDelta(board, "n", [
      { insert: "hello", attributes: { bold: true } },
      { insert: " world" },
    ]);

    const shared = board.texts.get("n")!;
    expect(shared).toBeInstanceOf(Y.XmlText);
    expect(plainOf(shared)).toBe("hello world");
    expect(deltaOf(shared)).toEqual([
      { insert: "hello", attributes: { bold: true } },
      { insert: " world" },
    ]);

    const widget = board.snapshot().widgets.find((w) => w.id === "n")!;
    expect(widget.content).toBe("hello world");
    expect(widget.runs).toEqual([
      { text: "hello", bold: true },
      { text: " world" },
    ]);
  });

  it("does not let a plain run inherit the marks to its left", () => {
    const board = boardWithNote();
    setWidgetDelta(board, "n", [
      { insert: "bold", attributes: { bold: true } },
      { insert: "plain" },
    ]);
    expect(deltaOf(board.texts.get("n")!)).toEqual([
      { insert: "bold", attributes: { bold: true } },
      { insert: "plain" },
    ]);
  });

  it("keeps marks on the untouched part when typing inside a formatted note", () => {
    const board = boardWithNote();
    setWidgetDelta(board, "n", [{ insert: "hello", attributes: { italic: true } }]);
    // Type at the end: the formatted prefix must survive.
    setWidgetDelta(board, "n", [
      { insert: "hello", attributes: { italic: true } },
      { insert: "!" },
    ]);
    expect(deltaOf(board.texts.get("n")!)).toEqual([
      { insert: "hello", attributes: { italic: true } },
      { insert: "!" },
    ]);
  });

  it("clears formatting when the editor sends an unmarked delta", () => {
    const board = boardWithNote();
    setWidgetDelta(board, "n", [{ insert: "hello", attributes: { bold: true } }]);
    setWidgetDelta(board, "n", [{ insert: "hello" }]);
    expect(deltaOf(board.texts.get("n")!)).toEqual([{ insert: "hello" }]);
    // Still rich text: the value keeps its type, only the marks are gone.
    expect(board.texts.get("n")).toBeInstanceOf(Y.XmlText);
    expect(board.snapshot().widgets.find((w) => w.id === "n")!.runs).toBeUndefined();
  });

  it("applies a formatting change as one undo step", () => {
    const board = boardWithNote();
    setWidgetText(board, "n", "hello world");
    board.stopCapturing();
    const depth = board.undo.undoStack.length;

    setWidgetDelta(board, "n", [
      { insert: "hello", attributes: { underline: true } },
      { insert: " world" },
    ]);
    expect(deltaOf(board.texts.get("n")!)[0]).toEqual({
      insert: "hello",
      attributes: { underline: true },
    });

    board.undoOnce();
    expect(plainOf(board.texts.get("n")!)).toBe("hello world");
    expect(deltaOf(board.texts.get("n")!)).toEqual([{ insert: "hello world" }]);
    expect(board.undo.undoStack.length).toBe(depth);
  });

  it("merges adjacent operations with the same marks", () => {
    const board = boardWithNote();
    setWidgetDelta(board, "n", [
      { insert: "a", attributes: { bold: true } },
      { insert: "b", attributes: { bold: true } },
      { insert: "c" },
    ]);
    expect(deltaOf(board.texts.get("n")!)).toEqual([
      { insert: "ab", attributes: { bold: true } },
      { insert: "c" },
    ]);
  });

  it("survives a round trip through another replica", () => {
    const a = boardWithNote();
    setWidgetDelta(a, "n", [
      { insert: "one ", attributes: { bold: true } },
      { insert: "two", attributes: { italic: true } },
    ]);

    const b = new BoardDocument();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const widget = b.snapshot().widgets.find((w) => w.id === "n")!;
    expect(widget.content).toBe("one two");
    expect(widget.runs).toEqual([
      { text: "one ", bold: true },
      { text: "two", italic: true },
    ]);
  });

  it("grows a note from its formatted runs, not its plain length", () => {
    const board = boardWithNote();
    setWidgetDelta(board, "n", [{ insert: "x".repeat(40) }], { height: 300 });
    expect(board.widgets.get("n")!.height).toBe(300);
  });
});
