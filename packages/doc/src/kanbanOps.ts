import * as Y from "yjs";
import { newId, orderBetween, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";
import {
  cardsOf,
  cellOrders,
  columnsOf,
  kanbanOf,
  placementOf,
  swimlanesOf,
} from "./kanbanState";
import { seedTextField } from "./text";

/**
 * Kanban commands: cards, columns, swimlanes.
 *
 * A card's position is its cell, never a coordinate, so these commands write placements
 * instead of geometry; the layout is derived from them on every paint (ADR-006).
 */

/* ---------------------------------------------------------- card placement -- */

/**
 * Move a card to a cell. Column, swimlane and order change together: the source
 * product undoes a cross-cell drag in a single step.
 */
export function moveCard(
  board: BoardDocument,
  kanbanId: string,
  cardId: string,
  columnId: string,
  swimlaneId: string,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    if (board.widgets.get(cardId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;

    const current = placementOf(kanban, cardId);
    if (
      current &&
      current.columnId === columnId &&
      current.swimlaneId === swimlaneId
    ) {
      return;
    }

    const cell = cellOrders(kanban, columnId, swimlaneId, cardId);
    const last = cell[cell.length - 1];

    const entry = new Y.Map<unknown>();
    entry.set("columnId", columnId);
    entry.set("swimlaneId", swimlaneId);
    entry.set("order", orderBetween(last?.order, undefined));
    cardsOf(kanban).set(cardId, entry);
  });
}

export function addCard(
  board: BoardDocument,
  kanbanId: string,
  cardId: string,
  widget: Widget,
  columnId: string,
  swimlaneId: string,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    board.widgets.set(cardId, widget);
    seedTextField(board, widget, widget.title ?? widget.content ?? "");

    const cell = cellOrders(kanban, columnId, swimlaneId, cardId);
    const last = cell[cell.length - 1];
    const entry = new Y.Map<unknown>();
    entry.set("columnId", columnId);
    entry.set("swimlaneId", swimlaneId);
    entry.set("order", orderBetween(last?.order, undefined));
    cardsOf(kanban).set(cardId, entry);
  });
}

/* ----------------------------------------------------------- column ops ----- */

/**
 * Append a column **and** widen the widget, in one transaction — the captured
 * product grows the container by exactly one column width per added column.
 */
export function addColumn(
  board: BoardDocument,
  kanbanId: string,
  title = "New column",
  atIndex?: number,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;

    const columns = columnsOf(kanban);
    const entries = columns.toArray();
    const newColumnWidth = Number(kanban.get("newColumnWidth") ?? 574.6);

    const entry = new Y.Map<unknown>();
    entry.set("id", newId("col"));
    entry.set("title", uniqueTitle(title, entries.map((c) => String(c.get("title")))));
    entry.set("accent", "#9ca3af");
    // The captured product widens the widget by exactly this much per added column.
    entry.set("width", newColumnWidth);

    if (atIndex == null) columns.push([entry]);
    else columns.insert(Math.min(Math.max(atIndex, 0), columns.length), [entry]);

    resizeToColumns(board, kanbanId, kanban);
  });
}

export function renameColumn(
  board: BoardDocument,
  kanbanId: string,
  columnId: string,
  title: string,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const column = columnsOf(kanban)
      .toArray()
      .find((entry) => String(entry.get("id")) === columnId);
    column?.set("title", title);
  });
}

/**
 * Set or clear a column's WIP limit (ADR-106 amendment).
 *
 * The limit is an indicator, not a gate: the painter shows `count / limit` and a
 * warning, but a drop is never refused. A non-positive value clears it.
 */
export function setColumnWip(
  board: BoardDocument,
  kanbanId: string,
  columnId: string,
  limit: number | null,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const column = columnsOf(kanban)
      .toArray()
      .find((entry) => String(entry.get("id")) === columnId);
    if (!column) return;
    if (limit != null && Number.isFinite(limit) && limit > 0) {
      column.set("wipLimit", Math.min(999, Math.round(limit)));
    } else {
      column.delete("wipLimit");
    }
  });
}

export function moveColumn(
  board: BoardDocument,
  kanbanId: string,
  columnId: string,
  toIndex: number,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const columns = columnsOf(kanban);
    const entries = columns.toArray();
    const from = entries.findIndex((entry) => String(entry.get("id")) === columnId);
    if (from === -1) return;

    // Yjs types integrate once, so move by value instead of reusing the instance.
    const moved = copyMap(entries[from]!);
    columns.delete(from, 1);
    columns.insert(Math.min(Math.max(toIndex, 0), columns.length), [moved]);
  });
}

/** Delete a column; its cards fall back to the first remaining column. */
export function deleteColumn(board: BoardDocument, kanbanId: string, columnId: string): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;

    const columns = columnsOf(kanban);
    const entries = columns.toArray();
    const index = entries.findIndex((entry) => String(entry.get("id")) === columnId);
    if (index === -1) return;

    const remaining = entries.filter((_, i) => i !== index);
    if (!remaining.length) return;

    columns.delete(index, 1);

    const fallbackId = String(remaining[0]!.get("id"));
    cardsOf(kanban).forEach((placement, cardId) => {
      if (String(placement.get("columnId")) !== columnId) return;
      placement.set("columnId", fallbackId);
    });

    resizeToColumns(board, kanbanId, kanban);
  });
}

/* --------------------------------------------------------- swimlane ops ----- */

export function addSwimlane(
  board: BoardDocument,
  kanbanId: string,
  title = "New swimlane",
  atIndex?: number,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const swimlanes = swimlanesOf(kanban);
    const entries = swimlanes.toArray();
    const entry = new Y.Map<unknown>();
    entry.set("id", newId("lane"));
    entry.set("title", uniqueTitle(title, entries.map((s) => String(s.get("title")))));
    if (atIndex == null) swimlanes.push([entry]);
    else swimlanes.insert(Math.min(Math.max(atIndex, 0), swimlanes.length), [entry]);
  });
}

export function renameSwimlane(
  board: BoardDocument,
  kanbanId: string,
  swimlaneId: string,
  title: string,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const lane = swimlanesOf(kanban)
      .toArray()
      .find((entry) => String(entry.get("id")) === swimlaneId);
    lane?.set("title", title);
  });
}

export function moveSwimlane(
  board: BoardDocument,
  kanbanId: string,
  swimlaneId: string,
  toIndex: number,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const swimlanes = swimlanesOf(kanban);
    const entries = swimlanes.toArray();
    const from = entries.findIndex((entry) => String(entry.get("id")) === swimlaneId);
    if (from === -1) return;
    const moved = copyMap(entries[from]!);
    swimlanes.delete(from, 1);
    swimlanes.insert(Math.min(Math.max(toIndex, 0), swimlanes.length), [moved]);
  });
}

/** Delete a swimlane; its cards fall back to the first remaining swimlane. */
export function deleteSwimlane(
  board: BoardDocument,
  kanbanId: string,
  swimlaneId: string,
): void {
  board.transact(() => {
    if (board.widgets.get(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;

    const swimlanes = swimlanesOf(kanban);
    const entries = swimlanes.toArray();
    const index = entries.findIndex((entry) => String(entry.get("id")) === swimlaneId);
    if (index === -1) return;

    const remaining = entries.filter((_, i) => i !== index);
    swimlanes.delete(index, 1);
    if (!remaining.length) return;

    const fallbackId = String(remaining[0]!.get("id"));
    cardsOf(kanban).forEach((placement) => {
      if (String(placement.get("swimlaneId")) !== swimlaneId) return;
      placement.set("swimlaneId", fallbackId);
    });
  });
}

/* ---------------------------------------------------------------- helpers --- */

/** Copy a Y.Map's values into a fresh map (re-integration is not allowed). */
function copyMap(source: Y.Map<unknown>): Y.Map<unknown> {
  const copy = new Y.Map<unknown>();
  source.forEach((value, key) => copy.set(key, value));
  return copy;
}

/** Keep the widget box equal to the sum of its column widths. */
function resizeToColumns(
  board: BoardDocument,
  kanbanId: string,
  kanban: Y.Map<unknown>,
): void {
  const width = columnsOf(kanban)
    .toArray()
    .reduce((total, column) => total + Number(column.get("width") ?? 0), 0);
  const widget = board.widgets.get(kanbanId);
  if (widget) board.widgets.set(kanbanId, { ...widget, width });
}

function uniqueTitle(base: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
