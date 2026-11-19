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
  it("places the authored kanban cards in its matrix", () => {
    const cards = ["1", "2", "3", "4", "5"].map((id) => widget(id, "card"));
    const kanban = widget("k", "kanban", { width: 1474.6, height: 947 });
    const state = reconstructKanban("kanban-framework", kanban, cards);

    expect(state.columns.map((c) => c.title)).toEqual([
      "Backlog",
      "In progress",
      "Done",
    ]);
    expect(state.swimlanes.map((s) => s.title)).toEqual(["Product", "Platform"]);
    expect(countInColumn(state, "col0")).toBe(3);
    expect(countInColumn(state, "col1")).toBe(2);
    expect(countInColumn(state, "col2")).toBe(0);
    expect(countInSwimlane(state, "lane0")).toBe(3);
    expect(countInSwimlane(state, "lane1")).toBe(2);
    expect(state.columns[0]!.width).toBeCloseTo(1474.6 / 3, 5);
    expect(kanbanWidth(state)).toBeCloseTo(1474.6, 5);
  });

  it("localizes the recipe titles without touching placement", () => {
    const cards = ["1", "2", "3", "4", "5"].map((id) => widget(id, "card"));
    const kanban = widget("k", "kanban", { width: 1474.6, height: 947 });
    const state = reconstructKanban("kanban-framework", kanban, cards, "ru");

    expect(state.columns.map((column) => column.title)).toEqual([
      "Бэклог",
      "В работе",
      "Готово",
    ]);
    expect(state.swimlanes.map((lane) => lane.title)).toEqual(["Продукт", "Платформа"]);
    expect(countInColumn(state, "col0")).toBe(3);
    expect(countInSwimlane(state, "lane1")).toBe(2);
  });

  it("never loses a card, even when it must spread them out", () => {
    const cards = Array.from({ length: 70 }, (_, i) => widget(`c${i}`, "card"));
    const kanban = widget("k", "kanban", { width: 2988, height: 1286 });
    const state = reconstructKanban("product-roadmap-basic-prefilled", kanban, cards);

    expect(Object.keys(state.cards)).toHaveLength(70);
    expect(state.columns).toHaveLength(4);
    expect(state.swimlanes).toHaveLength(3);
  });
});
