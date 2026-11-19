/**
 * Kanban state for the authored templates (ADR-158).
 *
 * The templates carry only widget boxes; columns, swimlanes and card placement are
 * remo's own starting recipes. They are deterministic so a template looks the same on
 * every machine and a test can pin the matrix.
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
  columns: { key: string; accent: string }[];
  swimlanes: string[];
  /**
   * Cards per cell, lane by lane then column by column. Omitted means "spread the
   * cards evenly over the matrix".
   */
  cells?: number[];
}

type TemplateLanguage = "en" | "ru";

const LABELS: Record<TemplateLanguage, Record<string, string>> = {
  en: {
    backlog: "Backlog",
    inProgress: "In progress",
    done: "Done",
    now: "Now",
    next: "Next",
    later: "Later",
    notNow: "Not now",
    product: "Product",
    platform: "Platform",
    design: "Design",
    delivery: "Delivery",
  },
  ru: {
    backlog: "Бэклог",
    inProgress: "В работе",
    done: "Готово",
    now: "Сейчас",
    next: "Далее",
    later: "Позже",
    notNow: "Не сейчас",
    product: "Продукт",
    platform: "Платформа",
    design: "Дизайн",
    delivery: "Поставка",
  },
};

const RECIPES: Record<string, KanbanRecipe> = {
  "kanban-framework": {
    columns: [
      { key: "backlog", accent: TODO_ACCENT },
      { key: "inProgress", accent: DOING_ACCENT },
      { key: "done", accent: DONE_ACCENT },
    ],
    swimlanes: ["product", "platform"],
    cells: [2, 1, 0, 1, 1, 1],
  },
  "product-roadmap-basic": {
    columns: [
      { key: "now", accent: TODO_ACCENT },
      { key: "next", accent: DOING_ACCENT },
      { key: "later", accent: NEUTRAL_ACCENT },
      { key: "notNow", accent: DONE_ACCENT },
    ],
    swimlanes: ["product", "design", "delivery"],
  },
  "product-roadmap-basic-prefilled": {
    columns: [
      { key: "now", accent: TODO_ACCENT },
      { key: "next", accent: DOING_ACCENT },
      { key: "later", accent: NEUTRAL_ACCENT },
      { key: "notNow", accent: DONE_ACCENT },
    ],
    swimlanes: ["product", "design", "delivery"],
  },
};

const FALLBACK: KanbanRecipe = {
  columns: [
    { key: "backlog", accent: TODO_ACCENT },
    { key: "inProgress", accent: DOING_ACCENT },
    { key: "done", accent: DONE_ACCENT },
  ],
  swimlanes: ["product"],
};

/**
 * Build the kanban state for one kanban widget of a template. `columnWidth` comes
 * from the widget box, because that is how the source product stores it.
 */
export function reconstructKanban(
  templateKey: string,
  kanban: Widget,
  cards: Widget[],
  lang: TemplateLanguage = "en",
): KanbanState {
  const recipe = RECIPES[templateKey] ?? FALLBACK;
  const labels = LABELS[lang] ?? LABELS.en;

  const perColumn = kanban.width / Math.max(recipe.columns.length, 1);

  const state: KanbanState = {
    columns: recipe.columns.map((column, index) => ({
      id: `col${index}`,
      title: labels[column.key] ?? column.key,
      accent: column.accent,
      width: perColumn,
    })),
    swimlanes: recipe.swimlanes.map((key, index) => ({
      id: `lane${index}`,
      title: labels[key] ?? key,
    })),
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
