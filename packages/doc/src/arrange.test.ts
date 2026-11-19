import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import {
  alignWidgets,
  BoardDocument,
  createWidget,
  distributeWidgets,
} from "./board";

/** A note centred at x/y; the arrange commands think in edges, so tests do too. */
function note(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 100,
  extra: Partial<Widget> = {},
): Widget {
  return {
    id,
    type: "sticky_note",
    parentId: null,
    x,
    y,
    width,
    height,
    style: { fillColor: "yellow" },
    ...extra,
  };
}

function boardWith(...widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  for (const widget of widgets) createWidget(board, widget);
  return board;
}

const left = (widget: Widget) => widget.x - widget.width / 2;
const top = (widget: Widget) => widget.y - widget.height / 2;

describe("aligning a selection", () => {
  it("brings every left edge to the leftmost one, as one undo step", () => {
    const board = boardWith(note("a", 100, 100), note("b", 400, 300, 200), note("c", 700, 500));

    alignWidgets(board, ["a", "b", "c"], "left");
    expect(left(board.widgets.get("a")!)).toBe(50);
    expect(left(board.widgets.get("b")!)).toBe(50);
    expect(left(board.widgets.get("c")!)).toBe(50);

    board.undoOnce();
    expect(left(board.widgets.get("b")!)).toBe(300);
    expect(left(board.widgets.get("c")!)).toBe(650);
  });

  it("centres on the selection's middle, not on the first object", () => {
    const board = boardWith(note("a", 100, 0), note("b", 400, 0, 200), note("c", 700, 0));

    alignWidgets(board, ["a", "b", "c"], "centerX");
    expect(board.widgets.get("a")!.x).toBe(400);
    expect(board.widgets.get("b")!.x).toBe(400);
    expect(board.widgets.get("c")!.x).toBe(400);
  });

  it("aligns the bottom edge", () => {
    const board = boardWith(note("a", 0, 0), note("b", 200, 300, 100, 200));

    alignWidgets(board, ["a", "b"], "bottom");
    const a = board.widgets.get("a")!;
    const b = board.widgets.get("b")!;
    expect(top(a) + a.height).toBe(top(b) + b.height);
  });

  it("moves a group as one unit and keeps its inner layout", () => {
    const board = boardWith(
      note("a", 100, 0, 100, 100, { groupId: "g" }),
      note("b", 300, 0, 100, 100, { groupId: "g" }),
      note("c", 700, 0),
    );

    alignWidgets(board, ["a", "b", "c"], "left");
    // The group was already leftmost, so it stays exactly as it was.
    expect(board.widgets.get("a")!.x).toBe(100);
    expect(board.widgets.get("b")!.x).toBe(300);
    expect(left(board.widgets.get("c")!)).toBe(50);
  });

  it("lets a frame's children follow it", () => {
    const frame: Widget = {
      id: "f",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    };
    const board = boardWith(
      frame,
      note("inside", 100, 0, 100, 100, { parentId: "f" }),
      note("outside", 600, 0),
    );

    alignWidgets(board, ["f", "inside", "outside"], "right");
    // The frame moved to meet the rightmost object; its child moved with it.
    expect(board.widgets.get("f")!.x).toBe(450);
    expect(board.widgets.get("inside")!.x).toBe(550);
  });

  it("does nothing with a single object or with connectors only", () => {
    const board = boardWith(note("a", 100, 0), note("b", 300, 0));
    const before = board.widgets.get("a")!.x;

    alignWidgets(board, ["a"], "left");
    expect(board.widgets.get("a")!.x).toBe(before);

    const connector: Widget = {
      id: "c",
      type: "connector",
      parentId: null,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      start: { item: "a" },
      end: { item: "b" },
    };
    createWidget(board, connector);
    alignWidgets(board, ["c"], "left");
    expect(board.widgets.get("c")!.x).toBe(0);
  });
});

describe("distributing a selection", () => {
  it("makes the horizontal gaps equal and keeps the ends in place", () => {
    const board = boardWith(
      note("a", 0, 0, 100),
      note("b", 200, 0, 200),
      note("c", 600, 0, 100),
    );

    distributeWidgets(board, ["a", "b", "c"], "horizontal");

    const a = board.widgets.get("a")!;
    const b = board.widgets.get("b")!;
    const c = board.widgets.get("c")!;
    const firstGap = left(b) - (left(a) + a.width);
    const secondGap = left(c) - (left(b) + b.width);
    expect(firstGap).toBeCloseTo(150, 5);
    expect(secondGap).toBeCloseTo(150, 5);
    expect(left(a)).toBe(-50);
    expect(left(c) + c.width).toBe(650);
  });

  it("distributes vertically", () => {
    const board = boardWith(
      note("a", 0, 0, 100, 100),
      note("b", 0, 150, 100, 100),
      note("c", 0, 500, 100, 100),
    );

    distributeWidgets(board, ["a", "b", "c"], "vertical");
    const a = board.widgets.get("a")!;
    const b = board.widgets.get("b")!;
    const c = board.widgets.get("c")!;
    expect(top(b) - (top(a) + a.height)).toBeCloseTo(top(c) - (top(b) + b.height), 5);
  });

  it("needs three units: two already have one gap and nothing to equalise", () => {
    const board = boardWith(note("a", 0, 0), note("b", 400, 0));
    const before = board.widgets.get("b")!.x;

    distributeWidgets(board, ["a", "b"], "horizontal");
    expect(board.widgets.get("b")!.x).toBe(before);
  });
});
