import type { Rect, TableAxis, Widget } from "@remo/model";
import { tableCellFill } from "@remo/model";
import { boxOf } from "./connectors";

/**
 * Table geometry for a section (ADR-196, ADR-199).
 *
 * The frame is the table's origin; the axes are laid out in order. A column with a preset
 * size keeps it; an `auto` column follows the outermost objects in it, or the minimum when
 * empty. The objects stay at their world coordinates; the grid is a lens over them, not a
 * second copy. Hit-testing and the painter read this one function.
 */

export const TABLE_HEADER_HEIGHT = 40;
export const TABLE_HEADER_WIDTH = 128;
export const TABLE_CELL_PADDING = 16;
export const TABLE_MIN_COLUMN = 120;
export const TABLE_MIN_ROW = 72;
const PRESET_COLUMN: Record<string, number> = { narrow: 140, medium: 220, wide: 340 };
const PRESET_ROW: Record<string, number> = { narrow: 72, medium: 112, wide: 168 };

export interface TableColumn {
  axis: TableAxis;
  x: number;
  width: number;
}

export interface TableRow {
  axis: TableAxis;
  y: number;
  height: number;
}

export interface TableCell {
  rowId: string;
  columnId: string;
  rect: Rect;
}

export interface TableGrid {
  frameId: string;
  origin: { x: number; y: number };
  headerWidth: number;
  headerHeight: number;
  columns: TableColumn[];
  rows: TableRow[];
  cells: TableCell[];
  width: number;
  height: number;
}

function objectsIn(
  widgets: readonly Widget[],
  frameId: string,
  field: "rowId" | "columnId",
  axisId: string,
): Widget[] {
  return widgets.filter(
    (widget) => widget.parentId === frameId && widget.cell?.[field] === axisId,
  );
}

function autoColumnWidth(widgets: Widget[]): number {
  if (!widgets.length) return TABLE_MIN_COLUMN;
  const boxes = widgets.map((widget) => boxOf(widget));
  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  return Math.max(TABLE_MIN_COLUMN, right - left + TABLE_CELL_PADDING * 2);
}

function autoRowHeight(widgets: Widget[]): number {
  if (!widgets.length) return TABLE_MIN_ROW;
  const boxes = widgets.map((widget) => boxOf(widget));
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return Math.max(TABLE_MIN_ROW, bottom - top + TABLE_CELL_PADDING * 2);
}

/** The grid of a section, or null when the section is free or the layout is inactive. */
export function layoutTable(
  frame: Widget,
  widgets: readonly Widget[],
): TableGrid | null {
  const layout = frame.layout;
  if (layout?.kind !== "table" || layout.active === false) return null;
  const origin = { x: frame.x - frame.width / 2, y: frame.y - frame.height / 2 };
  const headerWidth = TABLE_HEADER_WIDTH;
  const headerHeight = TABLE_HEADER_HEIGHT;

  const columns: TableColumn[] = [];
  let x = origin.x + headerWidth;
  for (const axis of layout.columns) {
    const width =
      axis.size && axis.size !== "auto"
        ? (PRESET_COLUMN[axis.size] ?? TABLE_MIN_COLUMN)
        : autoColumnWidth(objectsIn(widgets, frame.id, "columnId", axis.id));
    columns.push({ axis, x, width });
    x += width;
  }

  const rows: TableRow[] = [];
  let y = origin.y + headerHeight;
  for (const axis of layout.rows) {
    const height =
      axis.size && axis.size !== "auto"
        ? (PRESET_ROW[axis.size] ?? TABLE_MIN_ROW)
        : autoRowHeight(objectsIn(widgets, frame.id, "rowId", axis.id));
    rows.push({ axis, y, height });
    y += height;
  }

  const cells: TableCell[] = [];
  for (const row of rows) {
    for (const column of columns) {
      cells.push({
        rowId: row.axis.id,
        columnId: column.axis.id,
        rect: { x: column.x, y: row.y, width: column.width, height: row.height },
      });
    }
  }

  return {
    frameId: frame.id,
    origin,
    headerWidth,
    headerHeight,
    columns,
    rows,
    cells,
    width: headerWidth + columns.reduce((total, column) => total + column.width, 0),
    height: headerHeight + rows.reduce((total, row) => total + row.height, 0),
  };
}

export function cellRect(
  grid: TableGrid,
  rowId: string,
  columnId: string,
): Rect | null {
  return (
    grid.cells.find((cell) => cell.rowId === rowId && cell.columnId === columnId)?.rect ?? null
  );
}

export function columnHeaderRect(grid: TableGrid, columnId: string): Rect | null {
  const column = grid.columns.find((entry) => entry.axis.id === columnId);
  if (!column) return null;
  return {
    x: column.x,
    y: grid.origin.y,
    width: column.width,
    height: grid.headerHeight,
  };
}

export function rowHeaderRect(grid: TableGrid, rowId: string): Rect | null {
  const row = grid.rows.find((entry) => entry.axis.id === rowId);
  if (!row) return null;
  return {
    x: grid.origin.x,
    y: row.y,
    width: grid.headerWidth,
    height: row.height,
  };
}

export function cornerRect(grid: TableGrid): Rect {
  return {
    x: grid.origin.x,
    y: grid.origin.y,
    width: grid.headerWidth,
    height: grid.headerHeight,
  };
}

function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export type TableHit =
  | { kind: "cell"; rowId: string; columnId: string; rect: Rect }
  | { kind: "column-header"; axisId: string; rect: Rect }
  | { kind: "row-header"; axisId: string; rect: Rect }
  | { kind: "corner"; rect: Rect };

/** What a world point is over: a data cell, a header, the corner, or nothing. */
export function tableHitAt(
  grid: TableGrid,
  point: { x: number; y: number },
): TableHit | null {
  for (const cell of grid.cells) {
    if (contains(cell.rect, point)) return { kind: "cell", ...cell };
  }
  for (const column of grid.columns) {
    const rect = columnHeaderRect(grid, column.axis.id)!;
    if (contains(rect, point)) return { kind: "column-header", axisId: column.axis.id, rect };
  }
  for (const row of grid.rows) {
    const rect = rowHeaderRect(grid, row.axis.id)!;
    if (contains(rect, point)) return { kind: "row-header", axisId: row.axis.id, rect };
  }
  const corner = cornerRect(grid);
  if (contains(corner, point)) return { kind: "corner", rect: corner };
  return null;
}

/** A header refuses objects; a data cell accepts them (ADR-196). */
export function acceptsObjects(hit: TableHit | null): boolean {
  return hit?.kind === "cell";
}

/** The fill of a cell, using the one specificity rule from ADR-199. */
export function cellFill(frame: Widget, rowId: string, columnId: string): string | undefined {
  return frame.layout?.kind === "table"
    ? tableCellFill(frame.layout, rowId, columnId)
    : undefined;
}
