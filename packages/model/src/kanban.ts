/**
 * Kanban state (ADR-006) — types, ordering and queries.
 *
 * The source product exposes a kanban as a bare `{x, y, width, height}` box:
 * columns, swimlanes and card placement never leave the widget. The clone owns
 * this state; mutations live in `@remo/doc`, which applies them to the shared
 * document so that undo and sync see one gesture as one transaction.
 *
 * Invariants
 *  - Column width is stored, not derived: adding a column widens the container by
 *    exactly one column width (verified against the source product).
 *  - Swimlanes have no collapsed flag — the source product has no fold affordance.
 */

export type ColumnId = string;
export type SwimlaneId = string;

export interface KanbanColumn {
  id: ColumnId;
  title: string;
  accent: string;
  /** Column width in canvas units — stored per column, like the source product. */
  width: number;
  wipLimit?: number;
}

export interface KanbanSwimlane {
  id: SwimlaneId;
  title: string;
}

export interface KanbanPlacement {
  columnId: ColumnId;
  swimlaneId: SwimlaneId;
  /** Fractional index; sortable as a plain string. */
  order: string;
}

export interface KanbanState {
  columns: KanbanColumn[];
  swimlanes: KanbanSwimlane[];
  /** cardId → placement. Cards are widgets; placement lives here. */
  cards: Record<string, KanbanPlacement>;
  /** Width given to a newly added column. */
  newColumnWidth: number;
  headerHeight: number;
}

export const DEFAULT_COLUMN_WIDTH = 574.6;
export const DEFAULT_HEADER_HEIGHT = 110;

export function emptyKanbanState(overrides: Partial<KanbanState> = {}): KanbanState {
  return {
    columns: [],
    swimlanes: [],
    cards: {},
    newColumnWidth: DEFAULT_COLUMN_WIDTH,
    headerHeight: DEFAULT_HEADER_HEIGHT,
    ...overrides,
  };
}

/** Accents observed on the captured boards. */
export const TODO_ACCENT = "#1a1a1a";
export const DOING_ACCENT = "#ffdd33";
export const DONE_ACCENT = "#8fd14f";
export const NEUTRAL_ACCENT = "#9ca3af";

/* ------------------------------------------- fractional order keys ---------- */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const MIN_DIGIT = DIGITS[0] as string;

/**
 * Key that sorts strictly between `before` and `after`; `undefined` means "no
 * neighbour on that side". Keys compare as base-36 fractions, so moving a card
 * rewrites one field instead of renumbering the column.
 */
export function orderBetween(before?: string, after?: string): string {
  const lower = before ?? "";
  const upper = after ?? "";

  if (lower === "" && upper === "") return "n";

  let prefix = "";
  let index = 0;
  for (;;) {
    const lowerDigit = index < lower.length ? lower[index]! : MIN_DIGIT;
    const upperDigit = index < upper.length ? upper[index]! : DIGITS[DIGITS.length - 1]!;
    const low = DIGITS.indexOf(lowerDigit);
    const high = DIGITS.indexOf(upperDigit);

    if (high - low > 1) {
      return prefix + DIGITS[Math.floor((low + high) / 2)];
    }

    prefix += lowerDigit;
    index += 1;
    if (index > 64) return prefix + "n";
  }
}

/** Order keys for `count` items appended in sequence: n, t, w, … */
export function orderKeys(count: number): string[] {
  const keys: string[] = [];
  let previous: string | undefined;
  for (let i = 0; i < count; i += 1) {
    const key = orderBetween(previous, undefined);
    keys.push(key);
    previous = key;
  }
  return keys;
}

/* ---------------------------------------------------------------- queries -- */

/** Card ids in a cell, in visual order. */
export function cardsInCell(
  state: KanbanState,
  columnId: ColumnId,
  swimlaneId: SwimlaneId,
): string[] {
  return Object.entries(state.cards)
    .filter(([, p]) => p.columnId === columnId && p.swimlaneId === swimlaneId)
    .sort((a, b) => (a[1].order < b[1].order ? -1 : a[1].order > b[1].order ? 1 : 0))
    .map(([cardId]) => cardId);
}

export function countInColumn(state: KanbanState, columnId: ColumnId): number {
  return Object.values(state.cards).filter((p) => p.columnId === columnId).length;
}

export function countInSwimlane(state: KanbanState, swimlaneId: SwimlaneId): number {
  return Object.values(state.cards).filter((p) => p.swimlaneId === swimlaneId).length;
}

/** Container width: the sum of the column widths. */
export function kanbanWidth(state: KanbanState): number {
  return state.columns.reduce((total, column) => total + column.width, 0);
}
