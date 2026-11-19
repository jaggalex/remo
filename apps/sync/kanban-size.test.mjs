import { describe, expect, it } from "vitest";
import { kanbanContentHeight as modelHeight } from "../../packages/model/src/kanbanSizing.ts";
import { frameBoxHolding as modelFrameBox } from "../../packages/model/src/frameGrowth.ts";
import { frameBoxHolding, growKanbanToFit, kanbanContentHeight } from "./kanban-size.mjs";
// The same Yjs instance the module uses (see project.test.mjs).
import { Y } from "./y.mjs";

const lanes = [{ id: "l1", title: "A" }, { id: "l2", title: "B" }];
const cases = [
  { cards: {}, height: () => 70 },
  { cards: { a: { columnId: "c1", swimlaneId: "l1" } }, height: () => 70 },
  {
    cards: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, { columnId: "c1", swimlaneId: "l2" }])),
    height: (id) => (id === "k0" ? 300 : id === "k1" ? 10 : undefined),
  },
];

describe("kanban size on the server (ADR-240)", () => {
  it("gives the same height as the rule in @remo/model", () => {
    for (const { cards, height } of cases) {
      const state = { swimlanes: lanes, cards, headerHeight: 96 };
      const withOrder = { ...state, cards: Object.fromEntries(Object.entries(cards).map(([id, c]) => [id, { ...c, order: "a" }])) };
      expect(kanbanContentHeight(state, height)).toBe(modelHeight(withOrder, height));
    }
  });

  it("grows the kanban widget for its cards and keeps its top edge", () => {
    const doc = new Y.Doc();
    const widgets = doc.getMap("widgets");
    widgets.set("k", { id: "k", type: "kanban", x: 0, y: 0, width: 960, height: 400 });
    const kanban = new Y.Map();
    doc.getMap("kanbans").set("k", kanban);
    const lanesY = new Y.Array();
    const lane = new Y.Map();
    lane.set("id", "l1");
    lanesY.push([lane]);
    kanban.set("swimlanes", lanesY);
    kanban.set("headerHeight", 96);
    const cards = new Y.Map();
    kanban.set("cards", cards);
    for (let i = 0; i < 6; i += 1) {
      widgets.set(`c${i}`, { id: `c${i}`, type: "card", width: 250, height: 70 });
      const placement = new Y.Map();
      placement.set("columnId", "col");
      placement.set("swimlaneId", "l1");
      cards.set(`c${i}`, placement);
    }
    doc.transact(() => growKanbanToFit(doc, "k"));
    const grown = widgets.get("k");
    expect(grown.height).toBe(96 + 6 * 70 + 5 * 10 + 2 * 14);
    expect(grown.y - grown.height / 2).toBe(-200);
  });
});

describe("frame growth on the server (ADR-243)", () => {
  it("gives the same box as the rule in @remo/model", () => {
    const frame = { x: 0, y: 0, width: 400, height: 300 };
    for (const child of [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 100, width: 100, height: 200 },
      { x: -250, y: -200, width: 200, height: 200 },
      { x: 300, y: 300, width: 50, height: 50 },
    ]) {
      expect(frameBoxHolding(frame, child)).toEqual(modelFrameBox(frame, child));
    }
  });

  it("grows the section around a kanban an agent filled", () => {
    const doc = new Y.Doc();
    const widgets = doc.getMap("widgets");
    widgets.set("room", { id: "room", type: "frame", parentId: null, x: 0, y: 0, width: 1000, height: 440 });
    widgets.set("k", { id: "k", type: "kanban", parentId: "room", x: 0, y: 0, width: 960, height: 400 });
    const kanban = new Y.Map();
    doc.getMap("kanbans").set("k", kanban);
    const lanesY = new Y.Array();
    const lane = new Y.Map();
    lane.set("id", "l1");
    lanesY.push([lane]);
    kanban.set("swimlanes", lanesY);
    kanban.set("headerHeight", 96);
    const cards = new Y.Map();
    kanban.set("cards", cards);
    for (let i = 0; i < 6; i += 1) {
      widgets.set(`c${i}`, { id: `c${i}`, type: "card", width: 250, height: 70 });
      const placement = new Y.Map();
      placement.set("columnId", "col");
      placement.set("swimlaneId", "l1");
      cards.set(`c${i}`, placement);
    }
    doc.transact(() => growKanbanToFit(doc, "k"));
    const k = widgets.get("k");
    const room = widgets.get("room");
    expect(room.y + room.height / 2).toBe(k.y + k.height / 2 + 24);
    expect(room.y - room.height / 2).toBe(-220);
  });
});
