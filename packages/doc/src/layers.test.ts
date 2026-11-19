import { describe, expect, it } from "vitest";
import { layerKey, paintOrder, type Widget } from "@remo/model";
import {
  BoardDocument,
  createWidget,
  deleteWidgets,
  moveWidgets,
  reorderWidgets,
  setFillColor,
  setLocked,
  setTextColor,
  setWidgetRects,
  setWidgetText,
} from "./board";

function note(id: string, type: Widget["type"] = "sticky_note", extra: Partial<Widget> = {}): Widget {
  return {
    id,
    type,
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: { fillColor: "yellow" },
    ...extra,
  };
}

function boardWith(...widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  for (const widget of widgets) createWidget(board, widget);
  return board;
}

const order = (board: BoardDocument) =>
  paintOrder([...board.widgets.values()]).map((widget) => widget.id);

describe("stacking order", () => {
  it("starts from the type: a note is above a shape", () => {
    const board = boardWith(note("s", "shape"), note("n"));
    expect(order(board)).toEqual(["s", "n"]);
  });

  it("brings one object to the front of the painting order", () => {
    const board = boardWith(note("s", "shape"), note("n"));

    reorderWidgets(board, ["s"], "front");
    expect(order(board)).toEqual(["n", "s"]);
    expect(layerKey(board.widgets.get("s")!)).toBeGreaterThan(
      layerKey(board.widgets.get("n")!),
    );

    board.undoOnce();
    expect(order(board)).toEqual(["s", "n"]);
  });

  it("sends one object to the back", () => {
    const board = boardWith(note("s", "shape"), note("n"));
    reorderWidgets(board, ["n"], "back");
    expect(order(board)).toEqual(["n", "s"]);
  });

  it("steps one slot forward and one backward", () => {
    const board = boardWith(note("a"), note("b"), note("c"));
    // Same type, same base layer: document order decides.
    expect(order(board)).toEqual(["a", "b", "c"]);

    reorderWidgets(board, ["a"], "forward");
    expect(order(board)).toEqual(["b", "a", "c"]);

    reorderWidgets(board, ["a"], "backward");
    expect(order(board)).toEqual(["a", "b", "c"]);
  });

  it("stops at the ends instead of wrapping", () => {
    const board = boardWith(note("a"), note("b"));
    reorderWidgets(board, ["a"], "backward");
    reorderWidgets(board, ["b"], "forward");
    expect(order(board)).toEqual(["a", "b"]);
  });

  it("moves a multi-selection as one block, keeping its inner order", () => {
    const board = boardWith(note("a"), note("b"), note("c"), note("d"));
    reorderWidgets(board, ["a", "b"], "front");
    expect(order(board)).toEqual(["c", "d", "a", "b"]);
  });

  it("keeps cards out of the stack", () => {
    const board = boardWith(note("a"), note("card", "card", { parentId: "k" }));
    const before = board.widgets.get("card")!.z;
    reorderWidgets(board, ["card", "a"], "front");
    expect(board.widgets.get("card")!.z).toBe(before);
  });
});

describe("locking", () => {
  it("lets a locked object move but refuses to resize or delete it", () => {
    const board = boardWith(note("a", "sticky_note", { x: 100, y: 100 }), note("b", "sticky_note", { x: 300, y: 100 }));
    setLocked(board, ["a"], true);
    expect(board.widgets.get("a")!.locked).toBe(true);

    // ADR-210: the lock protects content and size, not placement.
    moveWidgets(board, [{ id: "a", x: 500, y: 500 }]);
    expect(board.widgets.get("a")!.x).toBe(500);

    setWidgetRects(board, [{ id: "a", x: 500, y: 500, width: 400, height: 400 }]);
    expect(board.widgets.get("a")!.width).toBe(100);

    deleteWidgets(board, ["a"]);
    expect(board.widgets.has("a")).toBe(true);
  });

  it("refuses every style change, including a pasted one", () => {
    const board = boardWith(note("a"));
    setLocked(board, ["a"], true);
    setTextColor(board, ["a"], "#ffffff");
    setFillColor(board, ["a"], "#1a1a1a");
    setWidgetText(board, "a", "typed");
    expect(board.widgets.get("a")!.style?.textColor).toBeUndefined();
    expect(board.widgets.get("a")!.style?.fillColor).toBe("yellow");
    expect(board.textOf("a")).toBe("");

    setLocked(board, ["a"], false);
    setFillColor(board, ["a"], "#1a1a1a");
    expect(board.widgets.get("a")!.style?.fillColor).toBe("#1a1a1a");
  });

  it("deletes a locked object only when forced", () => {
    const board = boardWith(note("a"));
    setLocked(board, ["a"], true);
    deleteWidgets(board, ["a"], { force: true });
    expect(board.widgets.has("a")).toBe(false);
  });

  it("unlocks in one undo step", () => {
    const board = boardWith(note("a"));
    setLocked(board, ["a"], true);
    setLocked(board, ["a"], false);
    expect(board.widgets.get("a")!.locked).toBeUndefined();

    board.undoOnce();
    expect(board.widgets.get("a")!.locked).toBe(true);
  });
});

describe("text colour", () => {
  it("stores an explicit colour and clears back to automatic", () => {
    const board = boardWith(note("n"), note("s", "shape"));
    setTextColor(board, ["n", "s"], "#ffffff");
    expect(board.widgets.get("n")!.style?.textColor).toBe("#ffffff");
    expect(board.widgets.get("s")!.style?.textColor).toBe("#ffffff");

    setTextColor(board, ["n", "s"], null);
    expect(board.widgets.get("n")!.style?.textColor).toBeUndefined();
    expect(board.widgets.get("s")!.style?.textColor).toBeUndefined();
  });
});

describe("a connector's label", () => {
  it("reads and writes text like a note's", () => {
    const board = boardWith(note("a"), note("b"), note("line", "connector", {
      start: { item: "a" },
      end: { item: "b" },
    }));

    setWidgetText(board, "line", "blocks");
    expect(board.textOf("line")).toBe("blocks");
    const painted = board.snapshot().widgets.find((widget) => widget.id === "line")!;
    expect(painted.content).toBe("blocks");
  });
});

describe("author lock (ADR-107)", () => {
  it("records the author on lock and clears it on unlock", () => {
    const board = boardWith(note("a"));
    setLocked(board, ["a"], true, { id: "u1", name: "Ann" });
    expect(board.widgets.get("a")).toMatchObject({
      locked: true,
      lockedBy: "u1",
      lockedByName: "Ann",
    });
    expect(board.widgets.get("a")!.lockedAt).toBeTypeOf("number");

    setLocked(board, ["a"], false);
    expect(board.widgets.get("a")!.locked).toBeUndefined();
    expect(board.widgets.get("a")!.lockedBy).toBeUndefined();
    expect(board.widgets.get("a")!.lockedByName).toBeUndefined();
    expect(board.widgets.get("a")!.lockedAt).toBeUndefined();
  });

  it("keeps a lock without an author as the legacy, releasable form", () => {
    const board = boardWith(note("a"));
    setLocked(board, ["a"], true);
    expect(board.widgets.get("a")!.locked).toBe(true);
    expect(board.widgets.get("a")!.lockedBy).toBeUndefined();
  });
});
