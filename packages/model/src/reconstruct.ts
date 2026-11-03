/**
 * Reconstructed kanban state for the captured templates.
 *
 * ⚠️ Provenance. The source product does **not** expose columns, swimlanes or card
 * placement through its API (ADR-006), so unlike the widget geometry in
 * `spec/templates.json` this is *not* captured data. It was reconstructed from what
 * is observable — column headers, swimlane names, and the per-column / per-swimlane
 * counts visible in the UI, recorded in ADR-016 — with card
 * placement distributed deterministically where even the counts were unavailable.
 *
 * Replace it as soon as the clone authors its own boards.
 */

import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_HEADER_HEIGHT,
  DOING_ACCENT,
  DONE_ACCENT,
  NEUTRAL_ACCENT,
  TODO_ACCENT,
  orderKeys,
} from "./kanban";
import type { KanbanPlacement, KanbanState } from "./kanban";
import type { Widget } from "./types";

interface KanbanRecipe {
  columns: { title: string; accent: string }[];
  swimlanes: string[];
  /**
   * Cards per cell, lane by lane then column by column. Omitted means "spread the
   * cards evenly over the matrix".
   */
  cells?: number[];
}

const RECIPES: Record<string, KanbanRecipe> = {
  // Verified on the live board: Todo 5, Doing 0, Done 0; Team A 3, Team B 2.
  "kanban-framework": {
    columns: [
      { title: "Todo", accent: TODO_ACCENT },
      { title: "Doing", accent: DOING_ACCENT },
      { title: "Done", accent: DONE_ACCENT },
    ],
    swimlanes: ["Team A", "Team B"],
    cells: [3, 0, 0, 2, 0, 0],
  },
  // Roadmap lanes are numbered periods with teammate swimlanes; per-cell counts were
  // not observable, so cards spread evenly.
  "product-roadmap-basic": {
    columns: Array.from({ length: 8 }, (_, i) => ({ title: String(i + 1), accent: NEUTRAL_ACCENT })),
    swimlanes: Array.from({ length: 6 }, (_, i) => `Teammate ${i + 1}`),
  },
  "product-roadmap-basic-prefilled": {
    columns: Array.from({ length: 8 }, (_, i) => ({ title: String(i + 1), accent: NEUTRAL_ACCENT })),
    swimlanes: Array.from({ length: 6 }, (_, i) => `Teammate ${i + 1}`),
  },
};

const FALLBACK: KanbanRecipe = {
  columns: [
    { title: "Todo", accent: TODO_ACCENT },
    { title: "Doing", accent: DOING_ACCENT },
    { title: "Done", accent: DONE_ACCENT },
  ],
  swimlanes: ["Team A"],
};

/**
 * Build the kanban state for one kanban widget of a template. `columnWidth` comes
 * from the widget box, because that is how the source product stores it.
 */
export function reconstructKanban(
  templateKey: string,
  kanban: Widget,
  cards: Widget[],
): KanbanState {
  const recipe = RECIPES[templateKey] ?? FALLBACK;

  const perColumn = kanban.width / Math.max(recipe.columns.length, 1);

  const state: KanbanState = {
    columns: recipe.columns.map((column, index) => ({
      id: `col${index}`,
      title: column.title,
      accent: column.accent,
      width: perColumn,
    })),
    swimlanes: recipe.swimlanes.map((title, index) => ({ id: `lane${index}`, title })),
    cards: {},
    newColumnWidth: DEFAULT_COLUMN_WIDTH,
    headerHeight: DEFAULT_HEADER_HEIGHT,
  };

  const ids = cards.map((card) => card.id);
  const columnIds = state.columns.map((column) => column.id);
  const laneIds = state.swimlanes.map((lane) => lane.id);

  if (recipe.cells) {
    // Explicit counts mirror what the UI showed; anything left over goes to the
    // first cell rather than being dropped.
    const counters = laneIds.map(() => columnIds.map(() => 0));
    let cursor = 0;
    laneIds.forEach((laneId, laneIndex) => {
      columnIds.forEach((columnId, columnIndex) => {
        const wanted = recipe.cells![laneIndex * columnIds.length + columnIndex] ?? 0;
        for (let i = 0; i < wanted && cursor < ids.length; i += 1) {
          place(state, ids[cursor]!, columnId, laneId, counters[laneIndex]![columnIndex]!);
          counters[laneIndex]![columnIndex]! += 1;
          cursor += 1;
        }
      });
    });
    const firstColumn = columnIds[0];
    const firstLane = laneIds[0];
    if (firstColumn && firstLane) {
      while (cursor < ids.length) {
        place(state, ids[cursor]!, firstColumn, firstLane, counters[0]![0]!);
        counters[0]![0]! += 1;
        cursor += 1;
      }
    }
    return state;
  }

  // Even spread: one card per cell, wrapping through the matrix.
  const totalCells = Math.max(columnIds.length * laneIds.length, 1);
  const counters = new Map<string, number>();
  ids.forEach((cardId, index) => {
    const cell = index % totalCells;
    const laneId = laneIds[Math.floor(cell / columnIds.length)];
    const columnId = columnIds[cell % columnIds.length];
    if (!laneId || !columnId) return;
    const key = `${columnId}|${laneId}`;
    const seen = counters.get(key) ?? 0;
    place(state, cardId, columnId, laneId, seen);
    counters.set(key, seen + 1);
  });

  return state;
}

function place(
  state: KanbanState,
  cardId: string,
  columnId: string,
  swimlaneId: string,
  indexInCell: number,
): void {
  const orders = orderKeys(indexInCell + 1);
  const placement: KanbanPlacement = {
    columnId,
    swimlaneId,
    order: orders[indexInCell] ?? "n",
  };
  state.cards[cardId] = placement;
}
