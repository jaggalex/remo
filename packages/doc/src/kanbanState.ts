import * as Y from "yjs";
import {
  DEFAULT_HEADER_HEIGHT,
  type KanbanPlacement,
  type KanbanState,
} from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Reading a kanban's matrix out of the shared document.
 *
 * Columns, swimlanes and per-cell placements are stored as nested `Y.Map`s; this module
 * turns them into the plain `KanbanState` the layout and the painter work with. It is
 * shared by the document class, the clipboard and the kanban commands, which is why it
 * is a module of its own (ADR-053).
 */

export function readKanban(kanban: Y.Map<unknown>): KanbanState {
  const columnsArray = kanban.get("columns") as Y.Array<Y.Map<unknown>> | undefined;
  const swimlanesArray = kanban.get("swimlanes") as Y.Array<Y.Map<unknown>> | undefined;
  const cardsMap = kanban.get("cards") as Y.Map<Y.Map<unknown>> | undefined;

  const cards: Record<string, KanbanPlacement> = {};
  cardsMap?.forEach((placement, cardId) => {
    cards[cardId] = {
      columnId: String(placement.get("columnId") ?? ""),
      swimlaneId: String(placement.get("swimlaneId") ?? ""),
      order: String(placement.get("order") ?? "n"),
    };
  });

  return {
    columns:
      columnsArray?.toArray().map((column) => ({
        id: String(column.get("id")),
        title: String(column.get("title") ?? ""),
        accent: String(column.get("accent") ?? "#9ca3af"),
        width: Number(column.get("width") ?? 574.6),
        ...(column.get("wipLimit") != null
          ? { wipLimit: Number(column.get("wipLimit")) }
          : {}),
      })) ?? [],
    swimlanes:
      swimlanesArray?.toArray().map((lane) => ({
        id: String(lane.get("id")),
        title: String(lane.get("title") ?? ""),
      })) ?? [],
    cards,
    newColumnWidth: Number(kanban.get("newColumnWidth") ?? 574.6),
    headerHeight: Number(kanban.get("headerHeight") ?? DEFAULT_HEADER_HEIGHT),
  };
}

export function kanbanOf(board: BoardDocument, kanbanId: string): Y.Map<unknown> | undefined {
  return board.kanbans.get(kanbanId);
}

export function columnsOf(kanban: Y.Map<unknown>): Y.Array<Y.Map<unknown>> {
  return kanban.get("columns") as Y.Array<Y.Map<unknown>>;
}

export function swimlanesOf(kanban: Y.Map<unknown>): Y.Array<Y.Map<unknown>> {
  return kanban.get("swimlanes") as Y.Array<Y.Map<unknown>>;
}

export function cardsOf(kanban: Y.Map<unknown>): Y.Map<Y.Map<unknown>> {
  return kanban.get("cards") as Y.Map<Y.Map<unknown>>;
}

export function placementOf(kanban: Y.Map<unknown>, cardId: string): KanbanPlacement | null {
  const placement = cardsOf(kanban).get(cardId);
  if (!placement) return null;
  return {
    columnId: String(placement.get("columnId") ?? ""),
    swimlaneId: String(placement.get("swimlaneId") ?? ""),
    order: String(placement.get("order") ?? "n"),
  };
}

export function cellOrders(
  kanban: Y.Map<unknown>,
  columnId: string,
  swimlaneId: string,
  exceptCardId?: string,
): KanbanPlacement[] {
  const out: KanbanPlacement[] = [];
  cardsOf(kanban).forEach((placement, cardId) => {
    if (cardId === exceptCardId) return;
    const candidate: KanbanPlacement = {
      columnId: String(placement.get("columnId") ?? ""),
      swimlaneId: String(placement.get("swimlaneId") ?? ""),
      order: String(placement.get("order") ?? "n"),
    };
    if (candidate.columnId === columnId && candidate.swimlaneId === swimlaneId) out.push(candidate);
  });
  return out.sort((a, b) => (a.order < b.order ? -1 : 1));
}

/**
 * Write one kanban matrix under `kanbanId`.
 *
 * `cardIds` remaps source card ids to the ids used in this document; a card that
 * was not copied is left out of the matrix. Shared by template insertion, board
 * loading and paste so the three cannot drift apart.
 */
export function writeKanbanState(
  board: BoardDocument,
  kanbanId: string,
  state: KanbanState,
  cardIds?: Map<string, string>,
): void {
  const kanban = new Y.Map<unknown>();
  kanban.set("newColumnWidth", state.newColumnWidth);
  kanban.set("headerHeight", state.headerHeight);

  const columns = new Y.Array<Y.Map<unknown>>();
  for (const column of state.columns) {
    const entry = new Y.Map<unknown>();
    entry.set("id", column.id);
    entry.set("title", column.title);
    entry.set("accent", column.accent);
    entry.set("width", column.width);
    if (column.wipLimit != null) entry.set("wipLimit", column.wipLimit);
    columns.push([entry]);
  }

  const swimlanes = new Y.Array<Y.Map<unknown>>();
  for (const lane of state.swimlanes) {
    const entry = new Y.Map<unknown>();
    entry.set("id", lane.id);
    entry.set("title", lane.title);
    swimlanes.push([entry]);
  }

  const cards = new Y.Map<Y.Map<unknown>>();
  for (const [cardId, placement] of Object.entries(state.cards)) {
    const targetId = cardIds ? cardIds.get(cardId) : cardId;
    if (!targetId) continue;
    const entry = new Y.Map<unknown>();
    entry.set("columnId", placement.columnId);
    entry.set("swimlaneId", placement.swimlaneId);
    entry.set("order", placement.order);
    cards.set(targetId, entry);
  }

  kanban.set("columns", columns);
  kanban.set("swimlanes", swimlanes);
  kanban.set("cards", cards);
  board.kanbans.set(kanbanId, kanban);
}
