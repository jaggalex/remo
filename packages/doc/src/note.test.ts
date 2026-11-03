import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_PRESET,
  LINE_PRESETS,
  linePresetStyle,
  type Widget,
} from "@remo/model";
import {
  applyStyleSnapshot,
  BoardDocument,
  clearContent,
  createConnectedNote,
  createConnector,
  createShape,
  noteGap,
  setConnectorProps,
  setFillColor,
  setShapeStyle,
  styleSnapshotOf,
  swapConnectorEnds,
  createWidget,
  noteMarksOf,
  setNoteFontSize,
  setNoteTextAlign,
  setNoteTextVAlign,
  setStickySize,
  setTextColor,
  setWidgetDelta,
  setWidgetRects,
  setWidgetText,
  toggleNoteMark,
} from "./board";

const note = (id: string, x = 0, y = 0): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width: 161.2,
  height: 184.7,
  style: { fillColor: "yellow" },
});

function boardWith(id = "n"): BoardDocument {
  const board = new BoardDocument();
  createWidget(board, note(id));
  return board;
}

describe("note properties", () => {
  it("applies a preset size around the same centre, as one undo step", () => {
    const board = boardWith();
    const before = board.widgets.get("n")!;

    setStickySize(board, ["n"], "L");
    const resized = board.widgets.get("n")!;
    expect(resized.width).toBe(224);
    expect(resized.height).toBe(224);
    expect(resized.x).toBe(before.x);
    expect(resized.y).toBe(before.y);
    expect(resized.style?.stickySize).toBe("L");

    board.undoOnce();
    expect(board.widgets.get("n")!.width).toBe(161.2);
  });

  it("keeps Auto when the text size is cleared and clamps an explicit one", () => {
    const board = boardWith();

    setNoteFontSize(board, ["n"], 400);
    expect(board.widgets.get("n")!.style?.fontSize).toBe(96);

    setNoteFontSize(board, ["n"], null);
    expect(board.widgets.get("n")!.style?.fontSize).toBeUndefined();
  });

  it("aligns text horizontally and vertically", () => {
    const board = boardWith();
    setNoteTextAlign(board, ["n"], "left");
    setNoteTextVAlign(board, ["n"], "top");
    expect(board.widgets.get("n")!.style).toMatchObject({ textAlign: "left", textVAlign: "top" });
  });

  it("toggles a mark on the whole note, not just the caret", () => {
    const board = boardWith();
    setWidgetText(board, "n", "hello world");

    toggleNoteMark(board, ["n"], "bold");
    expect(noteMarksOf(board, "n")).toMatchObject({ bold: true });
    expect(board.deltaOf("n")).toEqual([{ insert: "hello world", attributes: { bold: true } }]);

    toggleNoteMark(board, ["n"], "bold");
    expect(noteMarksOf(board, "n")).toEqual({});
    expect(board.deltaOf("n")).toEqual([{ insert: "hello world" }]);
  });

  it("reports null when the note mixes marks, so the button is not lying", () => {
    const board = boardWith();
    setWidgetText(board, "n", "hello world");
    // Bold only the first word, the way a selection inside the editor would.
    setWidgetDelta(board, "n", [
      { insert: "hello", attributes: { bold: true } },
      { insert: " world" },
    ]);
    expect(noteMarksOf(board, "n")).toBeNull();
  });

  it("resizes and places several widgets in one transaction", () => {
    const board = boardWith();
    createWidget(board, note("other", 500, 0));
    setWidgetRects(board, [
      { id: "n", x: 100, y: 200, width: 300, height: 120 },
      { id: "other", x: 600, y: 200, width: 120, height: 120 },
    ]);
    expect(board.widgets.get("n")).toMatchObject({ x: 100, y: 200, width: 300, height: 120 });
    expect(board.widgets.get("other")).toMatchObject({ x: 600, width: 120, height: 120 });

    board.undoOnce();
    expect(board.widgets.get("n")!.width).toBe(161.2);
    expect(board.widgets.get("other")!.width).toBe(161.2);
  });
});

describe("shapes reuse the note chrome", () => {
  function withShape(): BoardDocument {
    const board = new BoardDocument();
    createWidget(board, {
      id: "sh",
      type: "shape",
      parentId: null,
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      shapeKind: "rectangle",
      style: { fillColor: "#ffffff", strokeColor: "#1a1a1a" },
    });
    return board;
  }

  it("sets fill, outline and outline width in one step", () => {
    const board = withShape();
    setShapeStyle(board, ["sh"], { fillColor: "#c6dcff", strokeColor: "#305bab", strokeWidth: 4 });
    expect(board.widgets.get("sh")!.style).toMatchObject({
      fillColor: "#c6dcff",
      strokeColor: "#305bab",
      strokeWidth: 4,
    });

    board.undoOnce();
    expect(board.widgets.get("sh")!.style?.strokeWidth).toBeUndefined();
  });

  it("paints a shape's fill with the same command as a note's", () => {
    const board = withShape();
    createWidget(board, note("n2"));
    setFillColor(board, ["sh", "n2"], "#adf0c7");
    expect(board.widgets.get("sh")!.style?.fillColor).toBe("#adf0c7");
    expect(board.widgets.get("n2")!.style?.fillColor).toBe("#adf0c7");
  });

  it("formats a shape's text with the note commands", () => {
    const board = withShape();
    setWidgetText(board, "sh", "inside");
    toggleNoteMark(board, ["sh"], "bold");
    setNoteFontSize(board, ["sh"], 24);
    setNoteTextAlign(board, ["sh"], "right");

    expect(board.deltaOf("sh")).toEqual([{ insert: "inside", attributes: { bold: true } }]);
    expect(board.widgets.get("sh")!.style).toMatchObject({ fontSize: 24, textAlign: "right" });
  });
});

describe("text ink (ADR-127)", () => {
  const withText = () => {
    const board = new BoardDocument();
    createWidget(board, {
      id: "t",
      type: "text",
      parentId: null,
      x: 0,
      y: 0,
      width: 360,
      height: 120,
    });
    return board;
  };

  it("writes a free text object's colour to `color`, not to `textColor`", () => {
    const board = withText();
    setTextColor(board, ["t"], "#1a6ad8");
    expect(board.widgets.get("t")!.style?.color).toBe("#1a6ad8");
    expect(board.widgets.get("t")!.style?.textColor).toBeUndefined();
  });

  it("clears the explicit colour back to Auto", () => {
    const board = withText();
    setTextColor(board, ["t"], "#1a6ad8");
    setTextColor(board, ["t"], null);
    expect(board.widgets.get("t")!.style?.color).toBeUndefined();
  });

  it("keeps a note's ink in `textColor`", () => {
    const board = boardWith();
    setTextColor(board, ["n"], "#2b7f17");
    expect(board.widgets.get("n")!.style?.textColor).toBe("#2b7f17");
    expect(board.widgets.get("n")!.style?.color).toBeUndefined();
  });
});

describe("connected notes", () => {
  it("creates a note and a connector in one undo step to the right", () => {
    const board = boardWith();
    setWidgetText(board, "n", "first");
    const created = createConnectedNote(board, "n", "right", { note: "n2", connector: "k" })!;
    expect(created).toBe("n2");

    const source = board.widgets.get("n")!;
    const next = board.widgets.get("n2")!;
    expect(next.x).toBe(source.x + source.width + noteGap(source.width, source.height));
    expect(next.y).toBe(source.y);
    expect(next.style?.fillColor).toBe("yellow");
    expect(board.widgets.get("k")).toMatchObject({
      type: "connector",
      start: { item: "n" },
      end: { item: "n2" },
      arrow: "end",
    });

    board.undoOnce();
    expect(board.widgets.has("n2")).toBe(false);
    expect(board.widgets.has("k")).toBe(false);
  });

  it("works in all four directions with the same gap", () => {
    const board = boardWith();
    const source = board.widgets.get("n")!;
    const gap = noteGap(source.width, source.height);
    const dx = source.width + gap;
    const dy = source.height + gap;

    createConnectedNote(board, "n", "left", { note: "l", connector: "kl" });
    createConnectedNote(board, "n", "up", { note: "u", connector: "ku" });
    createConnectedNote(board, "n", "down", { note: "d", connector: "kd" });

    expect(board.widgets.get("l")!.x).toBe(source.x - dx);
    expect(board.widgets.get("u")!.y).toBe(source.y - dy);
    expect(board.widgets.get("d")!.y).toBe(source.y + dy);
  });

  it("leaves a proportional gap, so chained notes are not cramped", () => {
    const board = boardWith();
    const small = noteGap(161.2, 184.7);
    expect(small).toBeGreaterThan(56);
    expect(noteGap(224, 224)).toBeGreaterThan(small);

    createConnectedNote(board, "n", "right", { note: "r", connector: "kr" });
    const a = board.widgets.get("n")!;
    const b = board.widgets.get("r")!;
    expect(b.x - a.x).toBe(a.width + small);
  });

  it("takes the last connector style for the new link", () => {
    const board = boardWith();
    createConnectedNote(
      board,
      "n",
      "right",
      { note: "r", connector: "kr" },
      { shape: "curved", arrow: "none", strokeColor: "#ff6464", strokeStyle: "dashed", strokeWidth: 4 },
    );

    const link = board.widgets.get("kr")!;
    expect(link.routing).toBe("curved");
    expect(link.arrow).toBe("none");
    expect(link.style).toMatchObject({
      strokeColor: "#ff6464",
      strokeStyle: "dashed",
      strokeWidth: 4,
    });
  });

  it("anchors the connector to the facing sides", () => {
    const board = boardWith();
    createConnectedNote(board, "n", "right", { note: "r", connector: "kr" });
    createConnectedNote(board, "n", "down", { note: "d", connector: "kd" });

    expect(board.widgets.get("kr")!.routing).toBe("elbow");
    expect(board.widgets.get("kr")!.start).toEqual({ item: "n", side: "right" });
    expect(board.widgets.get("kr")!.end).toEqual({ item: "r", side: "left" });
    expect(board.widgets.get("kd")!.start).toEqual({ item: "n", side: "bottom" });
    expect(board.widgets.get("kd")!.end).toEqual({ item: "d", side: "top" });
  });

  it("refuses to grow a chain from something that holds no text", () => {
    const board = new BoardDocument();
    createWidget(board, {
      id: "k",
      type: "kanban",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    expect(createConnectedNote(board, "k", "right", { note: "x", connector: "y" })).toBeNull();
    expect(board.widgets.has("x")).toBe(false);
  });
});

describe("connector properties", () => {
  function withConnector(): BoardDocument {
    const board = boardWith();
    createWidget(board, note("other", 400, 0));
    createConnector(board, "c", "n", "other", {
      startSide: "right",
      endSide: "left",
      shape: "elbowed",
    });
    return board;
  }

  it("stores the anchors and shape chosen when the line was drawn", () => {
    const board = withConnector();
    const widget = board.widgets.get("c")!;
    expect(widget.start).toEqual({ item: "n", side: "right" });
    expect(widget.end).toEqual({ item: "other", side: "left" });
    expect(widget.routing).toBe("elbow");
  });

  it("elbows by default, because a route is easier to read than a chord", () => {
    const board = boardWith();
    createWidget(board, note("other", 400, 200));
    createConnector(board, "c", "n", "other");
    expect(board.widgets.get("c")!.routing).toBe("elbow");
    expect(board.widgets.get("c")!.style).toMatchObject({ strokeWidth: 2 });
  });

  it("changes the stroke width", () => {
    const board = withConnector();
    setConnectorProps(board, ["c"], { strokeWidth: 4 });
    expect(board.widgets.get("c")!.style?.strokeWidth).toBe(4);
  });

  it("changes type, dashes and colour in one undo step", () => {
    const board = withConnector();
    setConnectorProps(board, ["c"], {
      connectorShape: "curved",
      strokeStyle: "dashed",
      strokeColor: "#fe9f4d",
    });
    const widget = board.widgets.get("c")!;
    expect(widget.routing).toBe("curved");
    expect(widget.style).toMatchObject({ strokeStyle: "dashed", strokeColor: "#fe9f4d" });

    board.undoOnce();
    expect(board.widgets.get("c")!.routing).toBe("elbow");
    expect(board.widgets.get("c")!.style?.strokeStyle).toBeUndefined();
  });

  it("applies a line preset as one undo step", () => {
    const board = withConnector();
    const preset = LINE_PRESETS.find((entry) => entry.id === "accent")!;
    // The bar writes the stroke half and the arrow head in one patch (ADR-120).
    setConnectorProps(board, ["c"], { ...linePresetStyle(preset), arrow: preset.arrow });
    const widget = board.widgets.get("c")!;
    expect(widget.style).toMatchObject({
      strokeColor: preset.color,
      strokeWidth: preset.width,
      strokeStyle: preset.dash,
    });
    expect(widget.arrow).toBe("end");

    board.undoOnce();
    const restored = board.widgets.get("c")!;
    // The model's line Plain preset is what a new connector starts with (ADR-129).
    expect(restored.style?.strokeColor).toBe(DEFAULT_LINE_PRESET.color);
    expect(restored.style?.strokeWidth).toBe(2);
    expect(restored.arrow).toBe("none");
  });

  it("swaps ends and moves the arrow with them", () => {
    const board = withConnector();
    setConnectorProps(board, ["c"], { arrow: "end" });
    swapConnectorEnds(board, ["c"]);
    const widget = board.widgets.get("c")!;
    expect(widget.start).toEqual({ item: "other", side: "left" });
    expect(widget.end).toEqual({ item: "n", side: "right" });
    // The head still points at the object the line now ends on.
    expect(widget.arrow).toBe("start");
  });
});

describe("copy style and clear content", () => {
  it("copies the look but not the text or position", () => {
    const board = boardWith();
    createWidget(board, note("target", 500, 100));
    setStickySize(board, ["n"], "L");
    setNoteFontSize(board, ["n"], 24);
    setNoteTextAlign(board, ["n"], "left");
    setWidgetText(board, "n", "hello");
    toggleNoteMark(board, ["n"], "bold");

    const snapshot = styleSnapshotOf(board, "n")!;
    applyStyleSnapshot(board, ["target"], snapshot);

    const target = board.widgets.get("target")!;
    expect(target.style).toMatchObject({ stickySize: "L", fontSize: 24, textAlign: "left" });
    // A size preset is geometry as well as style, so the target takes the box too.
    expect(target.width).toBe(224);
    expect(target.height).toBe(224);
    // Position and text are not part of a style.
    expect(target.x).toBe(500);
    expect(target.y).toBe(100);
    expect(board.textOf("target")).toBe("");
  });

  it("applies a style as exactly one undo step", () => {
    const board = boardWith();
    createWidget(board, note("target", 500, 100));
    setStickySize(board, ["n"], "S");
    const snapshot = styleSnapshotOf(board, "n")!;
    applyStyleSnapshot(board, ["target"], snapshot);
    expect(board.widgets.get("target")!.width).toBe(120);

    board.undoOnce();
    expect(board.widgets.get("target")!.width).toBe(161.2);
  });

  it("empties a note in one undo step", () => {
    const board = boardWith();
    setWidgetText(board, "n", "some text");
    clearContent(board, ["n"]);
    expect(board.textOf("n")).toBe("");
    board.undoOnce();
    expect(board.textOf("n")).toBe("some text");
  });
});

describe("connected clone keeps the source kind", () => {
  it("creates a shape, not a note, from a shape", () => {
    const board = new BoardDocument();
    createShape(board, "s1", "diamond", { x: 0, y: 0 }, { fillColor: "#ffdd33" });
    const id = createConnectedNote(board, "s1", "right", { note: "s2", connector: "c2" });
    expect(id).toBe("s2");
    expect(board.widgets.get("s2")).toMatchObject({
      type: "shape",
      shapeKind: "diamond",
    });
    expect(board.widgets.get("s2")!.style?.fillColor).toBe("#ffdd33");
    expect(board.widgets.get("c2")?.type).toBe("connector");
  });
});
