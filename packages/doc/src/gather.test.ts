import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { BoardDocument, loadBoard } from "./board";
import { GATHER_PADDING, gatherIntoSection, gatherPlan } from "./gather";

function boardWith(widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  loadBoard(board, { id: "t", title: "Gather", widgets }, {});
  return board;
}

function note(id: string, x: number, y = 0, parentId: string | null = null): Widget {
  return {
    id,
    type: "sticky_note",
    parentId,
    x,
    y,
    width: 100,
    height: 100,
    content: id,
  };
}

function frame(id: string, x = 0, y = 0): Widget {
  return { id, type: "frame", parentId: null, x, y, width: 600, height: 400, title: id };
}

describe("gathering a selection into a section (ADR-198)", () => {
  it("wraps the objects with padding and keeps their ids, text and positions", () => {
    const board = boardWith([note("a", 0), note("b", 200)]);
    const result = gatherIntoSection(board, ["a", "b"], {
      id: "f",
      title: "Section",
    });

    expect(result).toMatchObject({ frameId: "f", gathered: ["a", "b"], skipped: [] });
    const section = board.widgets.get("f")!;
    expect(section).toMatchObject({
      type: "frame",
      x: 100,
      y: 0,
      width: 300 + GATHER_PADDING * 2,
      height: 100 + GATHER_PADDING * 2,
      title: "Section",
    });
    expect(board.widgets.get("a")).toMatchObject({ x: 0, y: 0, content: "a", parentId: "f" });
    expect(board.widgets.get("b")).toMatchObject({ x: 200, y: 0, content: "b", parentId: "f" });
  });

  it("undoes the frame and the membership as one step", () => {
    const board = boardWith([note("a", 0), note("b", 200)]);
    gatherIntoSection(board, ["a", "b"], { id: "f", title: "Section" });
    expect(board.widgets.get("a")!.parentId).toBe("f");

    board.undoOnce();
    expect(board.widgets.get("f")).toBeUndefined();
    expect(board.widgets.get("a")!.parentId).toBeNull();
    expect(board.widgets.get("b")!.parentId).toBeNull();
  });

  it("never moves a locked object and reports the conflict", () => {
    const locked = { ...note("a", 0), locked: true };
    const board = boardWith([locked, note("b", 200)]);
    const result = gatherIntoSection(board, ["a", "b"], { id: "f", title: "Section" });

    expect(result.frameId).toBeNull();
    expect(result.conflicts).toContainEqual({ kind: "locked", id: "a" });
    expect(board.widgets.get("a")!.parentId).toBeNull();
  });

  it("skips an object in another section by default and takes it out only on request", () => {
    const board = boardWith([frame("old"), note("a", 0, 0, "old"), note("b", 200)]);
    const skipped = gatherIntoSection(board, ["a", "b"], { id: "f", title: "Section" });
    expect(skipped.frameId).toBeNull();
    expect(skipped.conflicts).toContainEqual({
      kind: "otherSection",
      id: "a",
      sectionId: "old",
    });

    const taken = gatherIntoSection(board, ["a", "b"], {
      id: "f2",
      title: "Section",
      takeOut: true,
    });
    expect(taken.frameId).toBe("f2");
    expect(board.widgets.get("a")!.parentId).toBe("f2");
    expect(board.widgets.get("b")!.parentId).toBe("f2");
  });

  it("refuses to gather a section into a section", () => {
    const board = boardWith([frame("old"), note("a", 0), note("b", 200)]);
    const result = gatherIntoSection(board, ["old", "a", "b"], { id: "f", title: "Section" });
    expect(result.conflicts).toContainEqual({ kind: "nested", id: "old" });
    // The ordinary objects still gather; the frame is reported, not swallowed.
    expect(result.frameId).toBe("f");
    expect(result.gathered.sort()).toEqual(["a", "b"]);
  });

  it("does nothing for fewer than two ordinary objects", () => {
    const board = boardWith([note("a", 0), frame("f")]);
    const result = gatherIntoSection(board, ["a", "f"], { id: "g", title: "Section" });
    expect(result.frameId).toBeNull();
    expect(board.widgets.get("g")).toBeUndefined();
  });

  it("previews exactly the box the command creates", () => {
    const board = boardWith([note("a", -100), note("b", 200, 60)]);
    const plan = gatherPlan(board.readWidgets(), ["a", "b"]);
    gatherIntoSection(board, ["a", "b"], { id: "g", title: "Section" });
    const created = board.readWidget("g")!;
    expect(plan.box).toEqual({
      x: created.x - created.width / 2,
      y: created.y - created.height / 2,
      width: created.width,
      height: created.height,
    });
  });
});
