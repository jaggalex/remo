import { describe, expect, it } from "vitest";
import type { KanbanState, Widget } from "@remo/model";
import {
  buildPdfFromJpeg,
  frameForSelection,
  layoutsFor,
  commentsInScope,
  scopeBounds,
  scopeWidgets,
} from "./exportRender";

function widget(
  id: string,
  type: Widget["type"],
  overrides: Partial<Widget> = {},
): Widget {
  return {
    id,
    type,
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  };
}

const kanbanState: KanbanState = {
  columns: [{ id: "col0", title: "Todo", accent: "#9ca3af", width: 400 }],
  swimlanes: [{ id: "lane0", title: "Lane" }],
  cards: { "card-1": { columnId: "col0", swimlaneId: "lane0", order: "n" } },
  newColumnWidth: 400,
  headerHeight: 48,
};

describe("export scope (ADR-071)", () => {
  const frame = widget("frame-1", "frame", { x: 0, y: 0, width: 600, height: 400 });
  const inside = widget("note-1", "sticky_note", { parentId: "frame-1", x: 50, y: 50 });
  const outside = widget("note-2", "sticky_note", { x: 900, y: 900 });
  const kanban = widget("kanban-1", "kanban", { x: 2000, y: 0, width: 400, height: 300 });
  const card = widget("card-1", "card", { parentId: "kanban-1", width: 200, height: 60 });
  const widgets = [frame, inside, outside, kanban, card];

  it("finds the frame of a selected child", () => {
    expect(frameForSelection(widgets, ["note-1"])?.id).toBe("frame-1");
    expect(frameForSelection(widgets, ["note-2"])).toBeNull();
  });

  it("includes the members of a selected frame and kanban", () => {
    expect(scopeWidgets(widgets, ["frame-1"], "selection").map((w) => w.id)).toEqual([
      "frame-1",
      "note-1",
    ]);
    expect(scopeWidgets(widgets, ["kanban-1"], "selection").map((w) => w.id)).toEqual([
      "kanban-1",
      "card-1",
    ]);
  });

  it("exports a whole frame with its contents", () => {
    expect(scopeWidgets(widgets, ["note-1"], "frame").map((w) => w.id)).toEqual([
      "frame-1",
      "note-1",
    ]);
    expect(scopeWidgets(widgets, ["note-2"], "frame")).toEqual([]);
  });

  it("takes the whole board without an implicit selection", () => {
    expect(scopeWidgets(widgets, [], "board")).toHaveLength(5);
    expect(scopeWidgets(widgets, [], "selection")).toEqual([]);
  });

  it("uses a card's matrix placement for bounds, not its empty x/y", () => {
    const layouts = layoutsFor(widgets, { "kanban-1": kanbanState });
    const box = scopeBounds([card], layouts);
    expect(box).not.toBeNull();
    // The kanban is at x=2000, so a card placed in its first cell cannot be near 0.
    expect(box!.x).toBeGreaterThan(1700);
    expect(box!.y).toBeGreaterThan(-100);
  });

  it("covers a table grid that is wider than its frame", () => {
    const table = widget("frame-table", "frame", {
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      layout: {
        kind: "table",
        columns: [
          { id: "c1", title: "A", size: "wide" },
          { id: "c2", title: "B", size: "wide" },
        ],
        rows: [{ id: "r1", title: "R" }],
      },
    });
    const box = scopeBounds([table], new Map());
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(128 + 340 * 2);
  });
});

describe("connectors follow the scope (ADR-138)", () => {
  const line = (id: string, from: string | null, to: string | null, box: Partial<Widget> = {}): Widget => ({
    ...widget(id, "connector", box),
    ...(from ? { start: { item: from } } : {}),
    ...(to ? { end: { item: to } } : {}),
  });

  const frame = widget("frame-1", "frame", { x: 0, y: 0, width: 600, height: 400 });
  const insideA = widget("in-a", "sticky_note", { parentId: "frame-1", x: 100, y: 100 });
  const insideB = widget("in-b", "sticky_note", { parentId: "frame-1", x: 300, y: 100 });
  const outside = widget("out", "sticky_note", { x: 900, y: 900 });
  const within = line("line-in", "in-a", "in-b");
  const escaping = line("line-out", "in-a", "out");
  const widgets = [frame, insideA, insideB, outside, within, escaping];

  it("selection: brings the line between two selected objects", () => {
    const ids = scopeWidgets(widgets, ["in-a", "in-b"], "selection").map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining(["in-a", "in-b", "line-in"]));
    expect(ids).not.toContain("line-out");
  });

  it("selection: one selected end is not enough", () => {
    const ids = scopeWidgets(widgets, ["in-a"], "selection").map((w) => w.id);
    expect(ids).toEqual(["in-a"]);
  });

  it("selection: a selected line is still exported on its own", () => {
    // An explicit selection is a statement: the line is drawn, cut at the edge.
    expect(scopeWidgets(widgets, ["line-out"], "selection").map((w) => w.id)).toEqual(["line-out"]);
  });

  it("frame: keeps lines inside the frame and drops the one that leaves it", () => {
    const ids = scopeWidgets(widgets, ["in-a"], "frame").map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining(["frame-1", "in-a", "in-b", "line-in"]));
    expect(ids).not.toContain("line-out");
  });

  it("board: every object, lines included, once each", () => {
    const ids = scopeWidgets(widgets, [], "board").map((w) => w.id);
    expect(ids).toHaveLength(widgets.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts a line once when both of its cards are in scope", () => {
    const kanban = widget("kanban-1", "kanban", { x: 2000, y: 0, width: 400, height: 300 });
    const kanban2 = widget("kanban-2", "kanban", { x: 3000, y: 0, width: 400, height: 300 });
    const cardA = widget("card-a", "card", { parentId: "kanban-1" });
    const cardB = widget("card-b", "card", { parentId: "kanban-2" });
    const cross = line("line-cross", "card-a", "card-b");
    const board = [kanban, kanban2, cardA, cardB, cross];
    const ids = scopeWidgets(board, ["kanban-1", "kanban-2"], "selection").map((w) => w.id);
    expect(ids.filter((id) => id === "line-cross")).toHaveLength(1);
  });

  it("measures the picture by the ends, not by a line's stale box", () => {
    // The line's stored rectangle was captured at creation and never follows a move.
    const stale = line("line-stale", "in-a", "in-b", { x: 50_000, y: 50_000, width: 400, height: 400 });
    const layouts = new Map();
    const box = scopeBounds([insideA, insideB, stale], layouts)!;
    expect(box.x).toBeLessThan(100);
    expect(box.x + box.width).toBeLessThan(1000);
  });

  it("still uses a lone line's box when the picture is that line", () => {
    const lone = line("line-lone", "a", "b", { x: 500, y: 500, width: 200, height: 100 });
    const box = scopeBounds([lone], new Map());
    expect(box).not.toBeNull();
    expect(box!.x).toBe(500 - 100 - 24);
    expect(box!.height).toBe(100 + 48);
  });
});

describe("PDF wrapper", () => {
  it("wraps a JPEG in a one-page PDF", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildPdfFromJpeg(jpeg, 400, 200);
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(300);
  });
});

describe("comments in an export (ADR-114)", () => {
  const frame = widget("frame-1", "frame", { x: 0, y: 0, width: 600, height: 400 });
  const inside = widget("note-1", "sticky_note", { parentId: "frame-1" });

  it("keeps unresolved anchors in scope and drops resolved or outside ones", () => {
    const threads = [
      { id: "a", anchor: { kind: "widget" as const, widgetId: "note-1" }, resolvedAt: null, comments: [] },
      { id: "b", anchor: { kind: "widget" as const, widgetId: "note-2" }, resolvedAt: null, comments: [] },
      { id: "c", anchor: { kind: "widget" as const, widgetId: "note-1" }, resolvedAt: "2026-10-29", comments: [] },
    ];
    const box = { x: -100, y: -100, width: 800, height: 600 };
    expect(commentsInScope(threads, [frame, inside], box, new Map()).map((t) => t.id)).toEqual(["a"]);
  });

  it("keeps a point anchor inside the exported box", () => {
    const threads = [
      { id: "in", anchor: { kind: "point" as const, x: 10, y: 20 }, resolvedAt: null, comments: [] },
      { id: "out", anchor: { kind: "point" as const, x: 5000, y: 20 }, resolvedAt: null, comments: [] },
    ];
    const box = { x: 0, y: 0, width: 600, height: 400 };
    expect(commentsInScope(threads, [frame], box, new Map()).map((t) => t.id)).toEqual(["in"]);
  });
});
