import { describe, expect, it } from "vitest";
import { BoardDocument } from "./board";
import { setWidgetName } from "./widgets";
import {
  addAllFrames,
  addPresentationSlide,
  movePresentationSlide,
  neighbouringSlide,
  presentationSlides,
  presentationSteps,
  removePresentationSlide,
  setPresentationOrder,
  slideLabel,
} from "./presentation";

function frame(id: string, x: number) {
  return { id, type: "frame" as const, parentId: null, x, y: 0, width: 400, height: 300 };
}

function note(id: string, x: number) {
  return {
    id,
    type: "sticky_note" as const,
    parentId: null,
    x,
    y: 0,
    width: 160,
    height: 180,
    content: `Note ${id}`,
  };
}

describe("presentation order (ADR-165)", () => {
  it("stores an explicit order of any object, independent of geometry", () => {
    const board = new BoardDocument();
    for (const widget of [frame("a", 0), note("n", 900), frame("c", 1800)]) {
      board.widgets.set(widget.id, widget);
    }

    setPresentationOrder(board, ["c", "n", "a"]);
    expect(presentationSlides(board)).toEqual(["c", "n", "a"]);
    expect(board.snapshot().presentation).toEqual(["c", "n", "a"]);

    movePresentationSlide(board, "a", 2);
    expect(presentationSlides(board)).toEqual(["c", "n", "a"]);
    expect(neighbouringSlide(presentationSlides(board), "a", 1)).toBe("c");

    removePresentationSlide(board, "n");
    expect(presentationSlides(board)).toEqual(["c", "a"]);
  });

  it("keeps every frame until the order is edited", () => {
    const board = new BoardDocument();
    for (const widget of [frame("a", 0), frame("b", 900), note("n", 1800)]) {
      board.widgets.set(widget.id, widget);
    }
    expect(presentationSlides(board)).toEqual(["a", "b"]);

    removePresentationSlide(board, "a");
    expect(presentationSlides(board)).toEqual(["b"]);
    removePresentationSlide(board, "b");
    // An explicit empty order is a real state, not "show all frames again".
    expect(presentationSlides(board)).toEqual([]);

    addPresentationSlide(board, "n");
    expect(presentationSlides(board)).toEqual(["n"]);
  });

  it("adds all frames without dropping objects already chosen", () => {
    const board = new BoardDocument();
    for (const widget of [frame("a", 0), frame("b", 900), note("n", 1800)]) {
      board.widgets.set(widget.id, widget);
    }
    setPresentationOrder(board, ["n"]);
    addAllFrames(board);
    expect(presentationSlides(board)).toEqual(["n", "a", "b"]);
  });

  it("ignores a missing id and a duplicate", () => {
    const board = new BoardDocument();
    board.widgets.set("a", frame("a", 0));
    setPresentationOrder(board, ["a", "missing", "a"]);
    expect(presentationSlides(board)).toEqual(["a"]);
  });

  it("presents a table section cell by cell in row-major order", () => {
    const board = new BoardDocument();
    const table = {
      ...frame("table", 0),
      layout: {
        kind: "table" as const,
        columns: [
          { id: "c1", title: "A" },
          { id: "c2", title: "B" },
        ],
        rows: [
          { id: "r1", title: "1" },
          { id: "r2", title: "2" },
        ],
      },
    };
    board.widgets.set("table", table);
    board.widgets.set("n", note("n", 900));
    setPresentationOrder(board, ["table", "n"]);

    expect(presentationSlides(board)).toEqual(["table", "n"]);
    expect(
      presentationSteps(board).map((step) =>
        step.cell ? `${step.slideId}:${step.cell.rowId}:${step.cell.columnId}` : step.id,
      ),
    ).toEqual([
      "table:r1:c1",
      "table:r1:c2",
      "table:r2:c1",
      "table:r2:c2",
      "n",
    ]);
  });

  it("keeps a table with no axes as one whole-frame step", () => {
    const board = new BoardDocument();
    board.widgets.set("table", {
      ...frame("table", 0),
      layout: { kind: "table", columns: [], rows: [] },
    });
    setPresentationOrder(board, ["table"]);
    expect(presentationSteps(board)).toEqual([
      { id: "table", slideId: "table", frameId: "table" },
    ]);
  });

  it("labels a slide by name, then title, then text, then id", () => {
    const board = new BoardDocument();
    const widget = { ...note("n", 0), title: "Title" };
    board.widgets.set("n", widget);
    expect(slideLabel(board.widgets.get("n")!)).toBe("Title");

    setWidgetName(board, "n", "  Intro  ");
    expect(slideLabel(board.widgets.get("n")!)).toBe("Intro");
    expect(board.widgets.get("n")!.name).toBe("Intro");

    setWidgetName(board, "n", "   ");
    expect(board.widgets.get("n")!.name).toBeUndefined();
  });
});
