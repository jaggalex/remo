import { describe, expect, it } from "vitest";
import { emptyKanbanState } from "./kanban";
import {
  CARD_FACE_MAX,
  KANBAN_CARD_GAP,
  KANBAN_PADDING,
  LANE_STRIP_WIDTH,
  MIN_LANE_HEIGHT,
  cardFaceHeight,
  kanbanContentHeight,
  kanbanLaneHeights,
  laneStripWidth,
} from "./kanbanSizing";

const state = (cards: Record<string, { columnId: string; swimlaneId: string }>, titles = ["A", "B"]) =>
  emptyKanbanState({
    columns: [
      { id: "c1", title: "To do", accent: "#000", width: 320 },
      { id: "c2", title: "Done", accent: "#000", width: 320 },
    ],
    swimlanes: titles.map((title, index) => ({ id: `l${index + 1}`, title })),
    cards: Object.fromEntries(
      Object.entries(cards).map(([id, cell], index) => [id, { ...cell, order: String(index) }]),
    ),
  });

describe("kanban sizing (ADR-240)", () => {
  it("keeps a card's own height, clamped, and never shrinks it to fit", () => {
    expect(cardFaceHeight(70)).toBe(70);
    expect(cardFaceHeight(10)).toBe(48);
    expect(cardFaceHeight(500)).toBe(CARD_FACE_MAX);
  });

  it("makes a lane as tall as its fullest cell", () => {
    const cards = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`k${i}`, { columnId: "c1", swimlaneId: "l1" }]),
    );
    const [first, second] = kanbanLaneHeights(state(cards), 0, () => 70);
    expect(first).toBe(6 * 70 + 5 * KANBAN_CARD_GAP + 2 * KANBAN_PADDING);
    expect(second).toBe(MIN_LANE_HEIGHT);
  });

  it("shares extra height equally, so a sparse kanban keeps equal lanes", () => {
    const lanes = kanbanLaneHeights(state({}), 600, () => 70);
    expect(lanes).toEqual([300, 300]);
  });

  it("needs header plus lanes, and grows with the cards", () => {
    const one = kanbanContentHeight(state({ a: { columnId: "c1", swimlaneId: "l1" } }), () => 70);
    const many = kanbanContentHeight(
      state(Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`k${i}`, { columnId: "c2", swimlaneId: "l2" }]))),
      () => 70,
    );
    expect(one).toBe(96 + MIN_LANE_HEIGHT * 2);
    expect(many).toBeGreaterThan(one);
  });

  it("has a strip for lane titles only when a lane has one", () => {
    expect(laneStripWidth(state({}))).toBe(LANE_STRIP_WIDTH);
    expect(laneStripWidth(state({}, ["", " "]))).toBe(0);
  });
});
