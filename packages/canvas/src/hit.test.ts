import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { containsPoint, intersectsRect, pick, pickConnector, pickInRect, rectFrom } from "./hit";
import { cellAt, kanbanContains, layoutKanban, placementAt, placementsInRect } from "./layout";

const widget = (id: string, type: Widget["type"], box: Partial<Widget> = {}): Widget => ({
  id,
  type,
  parentId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...box,
});

const kanbanState = {
  columns: [
    { id: "col0", title: "Todo", accent: "#1a1a1a", width: 500 },
    { id: "col1", title: "Doing", accent: "#ffdd33", width: 500 },
  ],
  swimlanes: [
    { id: "lane0", title: "Team A" },
    { id: "lane1", title: "Team B" },
  ],
  cards: {
    c1: { columnId: "col0", swimlaneId: "lane0", order: "n" },
    c2: { columnId: "col0", swimlaneId: "lane0", order: "t" },
    c3: { columnId: "col1", swimlaneId: "lane1", order: "n" },
  },
  newColumnWidth: 574.6,
  headerHeight: 110,
};

describe("hit testing", () => {
  it("finds the topmost widget under a point, by paint order", () => {
    const widgets = [
      widget("frame", "frame", { width: 1000, height: 1000 }),
      widget("sticky", "sticky_note", { x: 10, y: 10, width: 40, height: 40 }),
    ];
    expect(pick(widgets, { x: 10, y: 10 }, () => false)?.id).toBe("sticky");
    expect(pick(widgets, { x: 400, y: 400 }, () => false)?.id).toBe("frame");
  });

  it("prefers an object dropped on top of a kanban over the kanban", () => {
    // Both contain the point; the sticky is painted above the kanban, so it wins
    // regardless of the order they were added in.
    const kanban = widget("kanban", "kanban", { x: 0, y: 0, width: 800, height: 600 });
    const sticky = widget("sticky", "sticky_note", { x: 0, y: 0, width: 161, height: 185 });
    expect(pick([sticky, kanban], { x: 0, y: 0 }, () => false)?.id).toBe("sticky");
    expect(pick([kanban, sticky], { x: 0, y: 0 }, () => false)?.id).toBe("sticky");
  });

  it("skips widgets handled elsewhere", () => {
    const widgets = [widget("card", "card", { parentId: "k1" })];
    expect(pick(widgets, { x: 0, y: 0 }, (w) => w.id === "card")).toBeNull();
  });

  it("selects intersecting widgets by marquee, never frames", () => {
    const widgets = [
      widget("frame", "frame"),
      widget("a", "sticky_note", { x: 50, y: 50 }),
      widget("b", "sticky_note", { x: 400, y: 400 }),
    ];
    const rect = rectFrom({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(pickInRect(widgets, rect, () => false).map((w) => w.id)).toEqual(["a"]);
  });

  it("picks a connector by its line, never by its bounding box", () => {
    const a = widget("a", "sticky_note", { x: 0, y: 0, width: 100, height: 100 });
    const b = widget("b", "sticky_note", { x: 400, y: 0, width: 100, height: 100 });
    // The stored box spans both ends (400 wide, 0 tall); the line runs along y = 0
    // between the two right/left edges.
    const line = widget("c1", "connector", {
      x: 200,
      y: 0,
      width: 400,
      height: 0,
      start: { item: "a" },
      end: { item: "b" },
    });
    const resolve = (id: string) => [a, b].find((w) => w.id === id);

    expect(pickConnector([line], { x: 200, y: 4 }, 8, resolve)?.id).toBe("c1");
    // Far from the line but inside its box: not a hit.
    expect(pickConnector([line], { x: 200, y: 40 }, 8, resolve)).toBeNull();
    // And a general pick ignores connectors entirely, or the box would swallow it.
    expect(pick([line], { x: 200, y: 40 }, () => false)).toBeNull();
  });

  it("treats a partial overlap as a hit", () => {
    const sticky = widget("a", "text", { x: 0, y: 0 }); // box: -50…50
    expect(intersectsRect(sticky, { x: 40, y: 40, width: 60, height: 60 })).toBe(true);
    expect(containsPoint(sticky, { x: 90, y: 90 })).toBe(false);
  });
});

describe("kanban layout", () => {
  const kanban = widget("k1", "kanban", { x: 0, y: 0, width: 1000, height: 600 });
  const cards = [
    widget("c1", "card", { parentId: "k1", width: 400, height: 79 }),
    widget("c2", "card", { parentId: "k1", width: 400, height: 79 }),
    widget("c3", "card", { parentId: "k1", width: 400, height: 79 }),
  ];
  const layout = layoutKanban(kanban, cards, kanbanState);

  it("divides the container by the stored column widths", () => {
    expect(layout.columns.map((c) => Math.round(c.width))).toEqual([500, 500]);
    expect(layout.columns[0]!.left).toBeCloseTo(-500, 5);
    expect(layout.columns[1]!.centerX).toBeCloseTo(250, 5);
  });

  it("places every card inside its own cell", () => {
    expect(layout.placements).toHaveLength(3);
    for (const placement of layout.placements) {
      expect(placement.x).toBeGreaterThan(layout.left);
      expect(placement.x).toBeLessThan(layout.left + layout.width);
      expect(placement.y).toBeGreaterThan(layout.top + layout.headerHeight);
    }
  });

  it("maps points to cells and to cards", () => {
    const cell = cellAt(layout, { x: 0, y: 0 });
    expect(cell).toEqual({ columnId: "col0", swimlaneId: "lane0" });

    const first = layout.placements.find((p) => p.cardId === "c1")!;
    expect(placementAt(layout, { x: first.x, y: first.y })?.cardId).toBe("c1");
    expect(placementAt(layout, { x: layout.left + 5, y: layout.top + 5 })).toBeNull();
  });

  it("knows its own bounds so a marquee can be scoped to it", () => {
    expect(kanbanContains(layout, { x: 0, y: 0 })).toBe(true);
    expect(kanbanContains(layout, { x: 0, y: 10_000 })).toBe(false);
  });

  it("picks the cards a marquee touches", () => {
    const first = layout.placements.find((p) => p.cardId === "c1")!;
    const second = layout.placements.find((p) => p.cardId === "c2")!;
    const rect = rectFrom(
      { x: first.x - first.width / 2 - 5, y: first.y - first.height / 2 - 5 },
      { x: second.x + second.width / 2 + 5, y: second.y + second.height / 2 + 5 },
    );
    expect(placementsInRect(layout, rect).map((p) => p.cardId)).toEqual(["c1", "c2"]);
  });
});
