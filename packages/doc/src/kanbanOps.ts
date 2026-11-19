import * as Y from "yjs";
import { kanbanContentHeight, laneStripWidth, newId, orderBetween, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";
import {
  cardsOf,
  cellOrders,
  columnsOf,
  kanbanOf,
  placementOf,
  readKanban,
  swimlanesOf,
} from "./kanbanState";
import { seedTextField } from "./text";
import { growFramesAround } from "./frameGrowth";

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
  /**
   * Where in the cell: a card to land before, or null for the end. Within one cell this
   * reorders the cards; order is a fractional key, so only the moved card is written.
   * Left out, the card goes to the end of another cell and a move into its own cell is
   * ignored, as before.
   */
  beforeCardId?: string | null,
): void {
  board.transact(() => {
    if (board.readWidget(kanbanId)?.locked) return;
    if (board.readWidget(cardId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;

    // The other cards of the target cell, in their order.
    const others: Array<{ id: string; order: string }> = [];
    cardsOf(kanban).forEach((placement, id) => {
      if (id === cardId) return;
      if (placement.get("columnId") !== columnId || placement.get("swimlaneId") !== swimlaneId) return;
      others.push({ id, order: String(placement.get("order") ?? "n") });
    });
    others.sort((a, b) => (a.order < b.order ? -1 : 1));

    const index = beforeCardId ? others.findIndex((entry) => entry.id === beforeCardId) : -1;
    const next = index >= 0 ? others[index] : undefined;
    const previous = index >= 0 ? others[index - 1] : others[others.length - 1];

    const current = placementOf(kanban, cardId);
    const sameCell = current && current.columnId === columnId && current.swimlaneId === swimlaneId;
    if (sameCell && beforeCardId === undefined) return;
    if (current && sameCell) {
      // Already between the same neighbours: nothing to write, no empty undo step.
      const after = previous ? current.order > previous.order : true;
      const beforeNext = next ? current.order < next.order : true;
      if (after && beforeNext) return;
    }

    const entry = new Y.Map<unknown>();
    entry.set("columnId", columnId);
    entry.set("swimlaneId", swimlaneId);
    entry.set("order", orderBetween(previous?.order, next?.order));
    cardsOf(kanban).set(cardId, entry);
    growKanbanToFit(board, kanbanId);
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
    if (board.readWidget(kanbanId)?.locked) return;
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
    growKanbanToFit(board, kanbanId);
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
    if (board.readWidget(kanbanId)?.locked) return;
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

/**
 * Recolour a column's stripe. The value is a colour from the palette (`#rrggbb`); anything
 * else is refused, so the stripe cannot carry a literal the design system does not know.
 */
export function setColumnAccent(
  board: BoardDocument,
  kanbanId: string,
  columnId: string,
  accent: string,
): void {
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return;
  board.transact(() => {
    if (board.readWidget(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const column = columnsOf(kanban)
      .toArray()
      .find((entry) => entry.get("id") === columnId);
    if (!column || column.get("accent") === accent) return;
    column.set("accent", accent.toLowerCase());
  });
}

export function renameColumn(
  board: BoardDocument,
  kanbanId: string,
  columnId: string,
  title: string,
): void {
  board.transact(() => {
    if (board.readWidget(kanbanId)?.locked) return;
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
    if (board.readWidget(kanbanId)?.locked) return;
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
    if (board.readWidget(kanbanId)?.locked) return;
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
    if (board.readWidget(kanbanId)?.locked) return;
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
    if (board.readWidget(kanbanId)?.locked) return;
    const kanban = kanbanOf(board, kanbanId);
    if (!kanban) return;
    const swimlanes = swimlanesOf(kanban);
    const entries = swimlanes.toArray();
    const entry = new Y.Map<unknown>();
    entry.set("id", newId("lane"));
    entry.set("title", uniqueTitle(title, entries.map((s) => String(s.get("title")))));
    if (atIndex == null) swimlanes.push([entry]);
    else swimlanes.insert(Math.min(Math.max(atIndex, 0), swimlanes.length), [entry]);
    growKanbanToFit(board, kanbanId);
  });
}

export function renameSwimlane(
  board: BoardDocument,
  kanbanId: string,
  swimlaneId: string,
  title: string,
): void {
  board.transact(() => {
    if (board.readWidget(kanbanId)?.locked) return;
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
    if (board.readWidget(kanbanId)?.locked) return;
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
    if (board.readWidget(kanbanId)?.locked) return;
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
  // The lane-title strip is part of the box (ADR-240): without it every added column
  // would squeeze the others by the strip's width.
  const width =
    columnsOf(kanban)
      .toArray()
      .reduce((total, column) => total + Number(column.get("width") ?? 0), 0) +
    laneStripWidth(readKanban(kanban));
  const widget = board.readWidget(kanbanId);
  if (widget) board.widgets.set(kanbanId, { ...widget, width });
}

/**
 * Make the kanban at least as tall as its header and content-sized lanes (ADR-240), in
 * the caller's transaction, keeping its top edge where it is. It never shrinks the box:
 * deleting cards leaves the size the person had.
 */
export function growKanbanToFit(board: BoardDocument, kanbanId: string): void {
  const kanban = kanbanOf(board, kanbanId);
  const widget = board.readWidget(kanbanId);
  if (!kanban || !widget) return;
  const need = kanbanContentHeight(readKanban(kanban), (cardId) => board.readWidget(cardId)?.height);
  if (widget.height >= need - 0.5) return;
  board.widgets.set(kanbanId, { ...widget, height: need, y: widget.y + (need - widget.height) / 2 });
  // The section around it grows with it (ADR-243).
  growFramesAround(board, kanbanId);
}

function uniqueTitle(base: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
