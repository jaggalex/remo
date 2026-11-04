import { describe, expect, it } from "vitest";
import { BoardDocument } from "./board";
import { setWidgetName } from "./widgets";
import {
  addAllFrames,
  addPresentationSlide,
  movePresentationSlide,
  neighbouringSlide,
  presentationSlides,
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
