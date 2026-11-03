import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { CardError, convertToCards, orderBetween } from "./cards.mjs";

function boardWithNotes(count = 2) {
  const ydoc = new Y.Doc();
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = `sticky_${index}`;
    ids.push(id);
    widgets.set(id, {
      id,
      type: "sticky_note",
      parentId: null,
      x: index * 200,
      y: 0,
      width: 161,
      height: 185,
    });
    const text = new Y.Text();
    text.insert(0, `Title ${index}\nDetails ${index}`);
    texts.set(id, text);
  }
  return { ydoc, ids };
}

function addKanban(ydoc) {
  const widgets = ydoc.getMap("widgets");
  widgets.set("kanban_1", {
    id: "kanban_1",
    type: "kanban",
    parentId: null,
    x: 0,
    y: 0,
    width: 800,
    height: 400,
  });
  const kanban = new Y.Map();
  const columns = new Y.Array();
  const todo = new Y.Map();
  todo.set("id", "todo");
  todo.set("title", "To do");
  todo.set("accent", "#1a1a1a");
  todo.set("width", 400);
  columns.push([todo]);
  kanban.set("columns", columns);
  const swimlanes = new Y.Array();
  const lane = new Y.Map();
  lane.set("id", "lane1");
  lane.set("title", "Team");
  swimlanes.push([lane]);
  kanban.set("swimlanes", swimlanes);
  kanban.set("cards", new Y.Map());
  kanban.set("newColumnWidth", 400);
  kanban.set("headerHeight", 110);
  ydoc.getMap("kanbans").set("kanban_1", kanban);
  return kanban;
}

describe("orderBetween", () => {
  it("produces a key between neighbours", () => {
    expect(orderBetween(undefined, undefined)).toBe("n");
    const first = orderBetween("", undefined);
    const second = orderBetween(first, undefined);
    expect(first < second).toBe(true);
    const middle = orderBetween(first, second);
    expect(first < middle && middle < second).toBe(true);
  });
});

describe("convertToCards", () => {
  it("copies notes into standalone cards and keeps the sources", () => {
    const { ydoc, ids } = boardWithNotes(2);
    const result = convertToCards(ydoc, {
      selectionIds: ids,
      target: { kind: "standalone" },
      origin: { x: 100, y: 200 },
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
    });
    expect(result.count).toBe(2);
    expect(result.target).toEqual({ kind: "standalone" });
    const widgets = [...ydoc.getMap("widgets").values()];
    const cards = widgets.filter((widget) => widget.type === "card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ title: "Title 0", parentId: null });
    expect(cards[0].agent).toMatchObject({ id: "a1", taskId: "t1", skill: "cards" });
    expect(cards[0].x).toBeGreaterThanOrEqual(100);
    expect(ydoc.getMap("texts").get(cards[0].id).toString()).toBe("Title 0\nDetails 0");
    expect(widgets.filter((widget) => widget.type === "sticky_note")).toHaveLength(2);
  });

  it("moves notes into a kanban column and removes the sources", () => {
    const { ydoc, ids } = boardWithNotes(2);
    const kanban = addKanban(ydoc);
    const result = convertToCards(ydoc, {
      selectionIds: ids,
      target: { kind: "kanban", kanbanId: "kanban_1", columnId: "todo" },
      mode: "move",
    });
    expect(result.count).toBe(2);
    expect(result.target).toMatchObject({ kind: "kanban", columnId: "todo", swimlaneId: "lane1" });
    const cards = [...ydoc.getMap("widgets").values()].filter((widget) => widget.type === "card");
    expect(cards).toHaveLength(2);
    expect(cards[0].parentId).toBe("kanban_1");
    expect(ydoc.getMap("widgets").has(ids[0])).toBe(false);
    expect(ydoc.getMap("texts").has(ids[0])).toBe(false);

    const placements = kanban.get("cards");
    expect(placements.size).toBe(2);
    const orders = [...placements.values()].map((placement) => placement.get("order")).sort();
    expect(orders[0] < orders[1]).toBe(true);
    expect(placements.get(result.created[0].id).get("columnId")).toBe("todo");
  });

  it("skips empty and non-text sources", () => {
    const { ydoc, ids } = boardWithNotes(1);
    ydoc.getMap("widgets").set("shape_empty", {
      id: "shape_empty",
      type: "shape",
      parentId: null,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const result = convertToCards(ydoc, {
      selectionIds: [...ids, "shape_empty", "missing"],
    });
    expect(result.count).toBe(1);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(["empty", "missing"]);
  });

  it("refuses an empty selection and an oversized batch", () => {
    const { ydoc, ids } = boardWithNotes(1);
    expect(() => convertToCards(ydoc, { selectionIds: [] })).toThrow(CardError);
    const tooMany = Array.from({ length: 501 }, (_, index) => `id_${index}`);
    expect(() => convertToCards(ydoc, { selectionIds: tooMany })).toThrow(/change set/);
    expect(ids).toHaveLength(1);
  });

  it("refuses a kanban target that does not exist", () => {
    const { ydoc, ids } = boardWithNotes(1);
    expect(() =>
      convertToCards(ydoc, { selectionIds: ids, target: { kind: "kanban" } }),
    ).toThrow(/no kanban/);
  });
});
