import { useSyncExternalStore } from "react";
import type { TableLayout } from "@remo/model";

/**
 * The table cell the person is working with (ADR-204).
 *
 * Like the axis selection, this is transient UI state: the canvas, the range toolbar and
 * the keyboard must agree on it, but it is not part of the document and must not enter
 * undo. The anchor is where a range started; the focus is where it ends.
 */
export interface TableCellRef {
  rowId: string;
  columnId: string;
}

export interface TableCellSelection {
  frameId: string;
  anchor: TableCellRef;
  focus: TableCellRef;
}

let value: TableCellSelection | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function tableCellSelection(): TableCellSelection | null {
  return value;
}

export function setTableCellSelection(next: TableCellSelection | null): void {
  if (
    value?.frameId === next?.frameId &&
    value?.anchor.rowId === next?.anchor.rowId &&
    value?.anchor.columnId === next?.anchor.columnId &&
    value?.focus.rowId === next?.focus.rowId &&
    value?.focus.columnId === next?.focus.columnId
  ) {
    return;
  }
  value = next;
  for (const listener of listeners) listener();
}

export function clearTableCellSelection(): void {
  setTableCellSelection(null);
}

export function useTableCellSelection(): TableCellSelection | null {
  return useSyncExternalStore(subscribe, () => value, () => value);
}

/**
 * Every cell between the anchor and the focus, row-major (ADR-204).
 *
 * A range that names a covered cell is expanded by the merge command itself; here the
 * ids are the axes, so the list is exactly the rectangle a person dragged over.
 */
export function tableCellRangeIds(
  layout: TableLayout,
  anchor: TableCellRef,
  focus: TableCellRef,
): TableCellRef[] {
  const rowIds = layout.rows.map((axis) => axis.id);
  const columnIds = layout.columns.map((axis) => axis.id);
  const rowA = rowIds.indexOf(anchor.rowId);
  const rowB = rowIds.indexOf(focus.rowId);
  const columnA = columnIds.indexOf(anchor.columnId);
  const columnB = columnIds.indexOf(focus.columnId);
  if (rowA < 0 || rowB < 0 || columnA < 0 || columnB < 0) return [];
  const cells: TableCellRef[] = [];
  for (let row = Math.min(rowA, rowB); row <= Math.max(rowA, rowB); row += 1) {
    for (
      let column = Math.min(columnA, columnB);
      column <= Math.max(columnA, columnB);
      column += 1
    ) {
      cells.push({ rowId: rowIds[row]!, columnId: columnIds[column]! });
    }
  }
  return cells;
}
