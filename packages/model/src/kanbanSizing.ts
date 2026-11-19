import type { KanbanState } from "./kanban";

/**
 * How tall a kanban's lanes are (ADR-240) — one rule for the painter, hit-testing and the
 * document ops that keep the widget tall enough.
 *
 * Invariants
 *  - A card keeps its own height (clamped); it is never shrunk to fit its cell.
 *  - A lane is at least as tall as its fullest cell, and at least `MIN_LANE_HEIGHT`.
 *  - Extra height in the box is shared equally, so the sum of lanes is never less than
 *    the space the box gives them, and a sparse kanban keeps its equal lanes.
 */

/** Padding inside a cell, around its cards. */
export const KANBAN_PADDING = 14;
/** Gap between two cards of one cell. */
export const KANBAN_CARD_GAP = 10;
/** The lowest a lane goes: room for a title and the empty-cell `+`. */
export const MIN_LANE_HEIGHT = 120;
/** A card's height on its face, whatever is stored: readable, never a banner. */
export const CARD_FACE_MIN = 48;
export const CARD_FACE_MAX = 140;
/** Height used for a card whose widget has none. */
export const CARD_FACE_DEFAULT = 79;
/** Width of the lane-title strip, when the lanes have titles. */
export const LANE_STRIP_WIDTH = 160;

/** The height a card is drawn at. */
export function cardFaceHeight(stored: number | undefined): number {
  const height = stored && stored > 0 ? stored : CARD_FACE_DEFAULT;
  return Math.min(CARD_FACE_MAX, Math.max(CARD_FACE_MIN, height));
}

/** The strip for lane titles: present only when a lane has a title to show. */
export function laneStripWidth(state: Pick<KanbanState, "swimlanes">): number {
  return state.swimlanes.some((lane) => lane.title.trim().length > 0) ? LANE_STRIP_WIDTH : 0;
}

/** Each lane's own height from its cards, before any extra space is shared out. */
export function kanbanContentLaneHeights(
  state: Pick<KanbanState, "swimlanes" | "cards">,
  cardHeight: (cardId: string) => number | undefined,
): number[] {
  const lanes = state.swimlanes.length > 0 ? state.swimlanes : [{ id: "", title: "" }];
  return lanes.map((lane) => {
    const cells = new Map<string, number[]>();
    for (const [cardId, placement] of Object.entries(state.cards)) {
      if (placement.swimlaneId !== lane.id) continue;
      const list = cells.get(placement.columnId) ?? [];
      list.push(cardFaceHeight(cardHeight(cardId)));
      cells.set(placement.columnId, list);
    }
    let tallest = 0;
    for (const heights of cells.values()) {
      const block =
        heights.reduce((sum, h) => sum + h, 0) + KANBAN_CARD_GAP * (heights.length - 1);
      tallest = Math.max(tallest, block + KANBAN_PADDING * 2);
    }
    return Math.max(MIN_LANE_HEIGHT, tallest);
  });
}

/** The height a kanban needs: its header and every lane at its content height. */
export function kanbanContentHeight(
  state: Pick<KanbanState, "swimlanes" | "cards" | "headerHeight">,
  cardHeight: (cardId: string) => number | undefined,
): number {
  return (
    state.headerHeight +
    kanbanContentLaneHeights(state, cardHeight).reduce((sum, h) => sum + h, 0)
  );
}

/**
 * Lane heights for a box with `available` height under the header: content heights,
 * plus an equal share of whatever the box has beyond them.
 */
export function kanbanLaneHeights(
  state: Pick<KanbanState, "swimlanes" | "cards">,
  available: number,
  cardHeight: (cardId: string) => number | undefined,
): number[] {
  const content = kanbanContentLaneHeights(state, cardHeight);
  const used = content.reduce((sum, h) => sum + h, 0);
  const extra = Math.max(0, available - used) / content.length;
  return content.map((h) => h + extra);
}
