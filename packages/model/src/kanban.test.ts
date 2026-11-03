import { describe, expect, it } from "vitest";
import {
  emptyKanbanState,
  kanbanWidth,
  orderBetween,
  orderKeys,
  cardsInCell,
  countInColumn,
  countInSwimlane,
  type KanbanState,
} from "./kanban";
import { reconstructKanban } from "./reconstruct";
import { toBoard, stripHtml, bounds } from "./template";
import type { Widget } from "./types";

const widget = (id: string, type: Widget["type"], extra: Partial<Widget> = {}): Widget => ({
  id,
  type,
  parentId: null,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...extra,
});

describe("order keys", () => {
  it("appends strictly increasing keys", () => {
    const keys = orderKeys(6);
    expect(keys).toHaveLength(6);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i]! > keys[i - 1]!).toBe(true);
    }
  });

  it("inserts strictly between neighbours, repeatedly", () => {
    let low = orderBetween(undefined, undefined);
    let high = orderBetween(low, undefined);

    for (let i = 0; i < 30; i += 1) {
      const mid = orderBetween(low, high);
      expect(low < mid).toBe(true);
      expect(mid < high).toBe(true);
      // alternate which side collapses, to force suffix growth
      if (i % 2 === 0) low = mid;
      else high = mid;
    }
  });

  it("handles adjacent neighbours without looping", () => {
    const key = orderBetween("n", "o");
    expect("n" < key).toBe(true);
    expect(key < "o").toBe(true);
  });
});

describe("kanban state", () => {
  const state: KanbanState = {
    ...emptyKanbanState(),
    columns: [
      { id: "col1", title: "Todo", accent: "#1a1a1a", width: 600 },
      { id: "col2", title: "Doing", accent: "#ffdd33", width: 574.6 },
    ],
    swimlanes: [
      { id: "lane1", title: "Team A" },
      { id: "lane2", title: "Team B" },
    ],
    cards: {
      a: { columnId: "col1", swimlaneId: "lane1", order: "n" },
      b: { columnId: "col1", swimlaneId: "lane1", order: "t" },
      c: { columnId: "col1", swimlaneId: "lane2", order: "n" },
      d: { columnId: "col2", swimlaneId: "lane1", order: "n" },
    },
  };

  it("sorts cards inside a cell by fractional order", () => {
    expect(cardsInCell(state, "col1", "lane1")).toEqual(["a", "b"]);
    expect(cardsInCell(state, "col2", "lane2")).toEqual([]);
  });

  it("counts per column and per swimlane", () => {
    expect(countInColumn(state, "col1")).toBe(3);
    expect(countInColumn(state, "col2")).toBe(1);
    expect(countInSwimlane(state, "lane1")).toBe(3);
    expect(countInSwimlane(state, "lane2")).toBe(1);
  });

  it("sums the stored column widths for the container width", () => {
    expect(kanbanWidth(state)).toBeCloseTo(1174.6, 5);
  });
});

describe("template normalization", () => {
  it("strips HTML and decodes the entities the captures contain", () => {
    expect(stripHtml("<p>Credentials &amp; authentication</p>")).toBe(
      "Credentials & authentication",
    );
    expect(stripHtml("<p>line<br />two</p>")).toBe("line\ntwo");
  });

  it("produces a board whose bounds contain every widget", () => {
    const board = toBoard("kanban-framework", {
      source: { url: "memory", capturedAt: "2026-10-23", widgetCount: 2 },
      types: {},
      widgets: [
        {
          z: 0,
          id: "f1",
          type: "frame",
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          parentId: null,
        },
        {
          z: 1,
          id: "c1",
          type: "card",
          x: 0,
          y: 0,
          width: 422,
          height: 79,
          parentId: "k1",
          title: "<p>Hello</p>",
        },
      ],
    });

    // Cards report no coordinates; the kanban layout owns them.
    expect(board.widgets[1]!.x).toBe(0);
    expect(board.widgets[1]!.title).toBe("Hello");

    const box = bounds(board.widgets);
    expect(box.x).toBeLessThanOrEqual(0);
    expect(box.x + box.width).toBeGreaterThanOrEqual(200);
  });
});

describe("kanban reconstruction", () => {
  it("places the Kanban Framework cards exactly as the UI showed them", () => {
    const cards = ["1", "2", "3", "4", "5"].map((id) => widget(id, "card"));
    const kanban = widget("k", "kanban", { width: 1474.6, height: 947 });
    const state = reconstructKanban("kanban-framework", kanban, cards);

    expect(state.columns.map((c) => c.title)).toEqual(["Todo", "Doing", "Done"]);
    expect(state.swimlanes.map((s) => s.title)).toEqual(["Team A", "Team B"]);
    expect(countInColumn(state, "col0")).toBe(5);
    expect(countInColumn(state, "col1")).toBe(0);
    expect(countInSwimlane(state, "lane0")).toBe(3);
    expect(countInSwimlane(state, "lane1")).toBe(2);
    expect(state.columns[0]!.width).toBeCloseTo(1474.6 / 3, 5);
    expect(kanbanWidth(state)).toBeCloseTo(1474.6, 5);
  });

  it("never loses a card, even when it must spread them out", () => {
    const cards = Array.from({ length: 70 }, (_, i) => widget(`c${i}`, "card"));
    const kanban = widget("k", "kanban", { width: 2988, height: 1286 });
    const state = reconstructKanban("product-roadmap-basic-prefilled", kanban, cards);

    expect(Object.keys(state.cards)).toHaveLength(70);
    expect(state.columns).toHaveLength(8);
    expect(state.swimlanes).toHaveLength(6);
  });
});

describe("modelled content for opaque widgets", () => {
  const opaque = (id: string, width: number, height: number, y = 0) => ({
    z: 0,
    id,
    type: "unsupported",
    x: 0,
    y,
    width,
    height,
    parentId: null,
  });

  it("labels roadmap horizons as vertical plates", () => {
    const board = toBoard("product-roadmap-basic", {
      source: { url: "memory", capturedAt: "", widgetCount: 2 },
      types: {},
      widgets: [opaque("l1", 276, 518, -3000), opaque("l2", 276, 518, -1500)],
    });
    expect(board.widgets.map((w) => w.label)).toEqual(["Horizon 1", "Horizon 2"]);
  });

  it("does not invent lane labels in templates that have none", () => {
    const board = toBoard("kanban-framework", {
      source: { url: "memory", capturedAt: "", widgetCount: 1 },
      types: {},
      widgets: [opaque("panel", 284, 534)],
    });
    expect(board.widgets[0]!.label).toBeUndefined();
    expect(board.widgets[0]!.decorative).toBe(true);
  });

  it("gives the story map's wide plate the dot-voting legend", () => {
    const board = toBoard("user-story-map-basic", {
      source: { url: "memory", capturedAt: "", widgetCount: 1 },
      types: {},
      widgets: [opaque("legend", 276, 108)],
    });
    expect(board.widgets[0]!.legendTitle).toBe("Dot voting");
    expect(board.widgets[0]!.entries?.map((e) => e.label)).toEqual([
      "1 dot",
      "2 dots",
      "3 dots",
    ]);
  });

  it("gives stickers a glyph, a caption and reactions, in reading order", () => {
    const stamps = [0, 1, 2, 3].map((i) => ({
      z: i,
      id: `s${i}`,
      type: "stamp",
      x: (i % 2) * 180,
      y: Math.floor(i / 2) * 190,
      width: 177,
      height: 177,
      parentId: null,
    }));
    const board = toBoard("kanban-framework", {
      source: { url: "memory", capturedAt: "", widgetCount: 4 },
      types: {},
      widgets: stamps,
    });

    expect(board.widgets.map((w) => w.emoji)).toEqual(["😀", "💬", "🔥", "❤️"]);
    expect(board.widgets[1]!.reactions).toBe(1);
    expect(board.widgets[0]!.label).toBe("Smile");
  });
});
