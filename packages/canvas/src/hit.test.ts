import { describe, expect, it } from "vitest";
import { paintOrder, type Widget } from "@remo/model";
import { containsPoint, intersectsRect, pick, pickConnector, pickInRect, rectFrom } from "./hit";
import { axisDropSlot, cardDropSlot, cellAt, kanbanContains, layoutKanban, placementAt, placementsInRect } from "./layout";
import { kanbanTitleAt } from "./kanban";

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

  it("divides the width beside the lane strip by the stored column widths (ADR-240)", () => {
    // The lanes have titles, so the first 160 units are their strip.
    expect(layout.laneStrip).toBe(160);
    expect(layout.columns.map((c) => Math.round(c.width))).toEqual([420, 420]);
    expect(layout.columns[0]!.left).toBeCloseTo(-340, 5);
    expect(layout.columns[1]!.centerX).toBeCloseTo(290, 5);
  });

  it("stacks a cell's cards at their own height from the top, inside their lane", () => {
    for (const lane of layout.lanes) {
      const inLane = layout.placements.filter((p) => p.swimlaneId === lane.id);
      for (const placement of inLane) {
        expect(placement.y - placement.height / 2).toBeGreaterThanOrEqual(lane.top);
        expect(placement.y + placement.height / 2).toBeLessThanOrEqual(lane.top + lane.height);
      }
    }
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

describe("a full cell (ADR-240)", () => {
  it("makes its lane taller instead of spilling into the next lane", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `k${i}`);
    const state = {
      ...kanbanState,
      cards: Object.fromEntries(
        ids.map((id, i) => [id, { columnId: "col0", swimlaneId: "lane0", order: String.fromCharCode(97 + i) }]),
      ),
    };
    // A box far too short for eight cards: the lanes are laid out past it, never squeezed.
    const box = widget("kanban", "kanban", { x: 0, y: 0, width: 1000, height: 400 });
    const cards = ids.map((id) => widget(id, "card", { width: 250, height: 70 }));
    const layout = layoutKanban(box, cards, state);
    const [first, second] = layout.lanes;
    expect(second!.top).toBeCloseTo(first!.top + first!.height, 5);
    for (const placement of layout.placements) {
      expect(placement.height).toBe(70);
      expect(placement.y + placement.height / 2).toBeLessThanOrEqual(first!.top + first!.height);
    }
  });
});

describe("nested frames (ADR-242)", () => {
  // The child frame comes first in the document, as when a section is drawn and then a
  // larger frame is drawn around it.
  const inner = widget("inner", "frame", { x: 0, y: 0, width: 200, height: 200, parentId: "outer" });
  const outer = widget("outer", "frame", { x: 0, y: 0, width: 800, height: 800 });

  it("picks the nested frame inside its parent, whatever the document order", () => {
    expect(pick([inner, outer], { x: 10, y: 10 }, () => false)?.id).toBe("inner");
    expect(pick([outer, inner], { x: 10, y: 10 }, () => false)?.id).toBe("inner");
    expect(pick([inner, outer], { x: 300, y: 300 }, () => false)?.id).toBe("outer");
  });

  it("paints the nested frame after its parent", () => {
    expect(paintOrder([inner, outer]).map((w) => w.id)).toEqual(["outer", "inner"]);
  });
});

describe("where a dragged card lands (cardDropSlot)", () => {
  const layout = layoutKanban(
    widget("kanban", "kanban", { x: 0, y: 0, width: 1000, height: 800 }),
    ["c1", "c2", "c3"].map((id) => widget(id, "card", { width: 250, height: 70 })),
    kanbanState,
  );
  const cell = { columnId: "col0", swimlaneId: "lane0" };
  const c1 = layout.placements.find((p) => p.cardId === "c1")!;
  const c2 = layout.placements.find((p) => p.cardId === "c2")!;

  it("goes before the first card whose middle is below the pointer", () => {
    expect(cardDropSlot(layout, cell, c1.y - 1, "c3").beforeCardId).toBe("c1");
    expect(cardDropSlot(layout, cell, c1.y + 1, "c3").beforeCardId).toBe("c2");
    expect(cardDropSlot(layout, cell, c2.y + 1, "c3").beforeCardId).toBeNull();
  });

  it("skips the card being dragged and draws the line between the neighbours", () => {
    const slot = cardDropSlot(layout, cell, c1.y + 1, "c2");
    expect(slot.beforeCardId).toBeNull();
    const between = cardDropSlot(layout, cell, c1.y + 1, "c3");
    expect(between.lineY).toBeGreaterThan(c1.y + c1.height / 2);
    expect(between.lineY).toBeLessThan(c2.y - c2.height / 2);
  });
});

describe("kanban titles and their drop slots (ADR-244)", () => {
  const layout = layoutKanban(
    widget("kanban", "kanban", { x: 0, y: 0, width: 1000, height: 800 }),
    [],
    kanbanState,
  );
  // A measure that gives every character 10 units, so boxes are predictable.
  const measure = (text: string) => text.length * 10;
  const titleY = layout.top + layout.headerHeight * 0.42;
  const col0 = layout.columns[0]!;
  const col1 = layout.columns[1]!;

  it("finds a column by its title and count, not by the rest of the band", () => {
    expect(kanbanTitleAt(layout, { x: col0.left + layout.padding + 5, y: titleY }, measure)).toMatchObject({
      kind: "column",
      id: "col0",
    });
    // Far right in the same column's band: the band, which moves the kanban.
    expect(kanbanTitleAt(layout, { x: col0.left + col0.width - 5, y: titleY }, measure)).toBeNull();
  });

  it("finds a lane by its title in the strip", () => {
    const lane = layout.lanes[1]!;
    expect(kanbanTitleAt(layout, { x: layout.left + 20, y: lane.top + 30 }, measure)).toMatchObject({
      kind: "lane",
      id: "lane1",
    });
  });

  it("drops a column among the others by their centres", () => {
    expect(axisDropSlot(layout, "column", "col0", { x: col1.centerX + 1, y: 0 })).toEqual({
      index: 1,
      line: col1.left + col1.width,
    });
    expect(axisDropSlot(layout, "column", "col1", { x: col0.left + 1, y: 0 })).toEqual({
      index: 0,
      line: col0.left,
    });
  });

  it("drops a lane among the others by their centres", () => {
    const [first, second] = layout.lanes;
    expect(axisDropSlot(layout, "lane", "lane0", { x: 0, y: second!.centerY + 1 }).index).toBe(1);
    expect(axisDropSlot(layout, "lane", "lane1", { x: 0, y: first!.top + 1 })).toEqual({ index: 0, line: first!.top });
  });
});
