import type { Rect, Widget } from "@remo/model";
import {
  TABLE_CELL_PADDING,
  tableCellFill,
  type TableGrid,
} from "@remo/model";
import { boxOf } from "./connectors";

/**
 * Table hit-testing and placement for a section (ADR-196, ADR-199, ADR-201).
 *
 * The grid itself is computed in `@remo/model` (`layoutTable`), because the document
 * commands size the section with the same numbers the painter draws.
 */

export {
  TABLE_CELL_PADDING,
  TABLE_HEADER_HEIGHT,
  TABLE_HEADER_MAX_HEIGHT,
  TABLE_HEADER_MAX_WIDTH,
  TABLE_HEADER_WIDTH,
  TABLE_MIN_COLUMN,
  TABLE_MIN_ROW,
  layoutTable,
  type TableCell,
  type TableColumn,
  type TableGrid,
  type TableRow,
} from "@remo/model";

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


/**
 * The world translation that puts a selection inside a cell, keeping its arrangement.
 *
 * The top-left of the selection's union box lands at the cell's padding corner. The
 * caller applies the same offset to every object, so links and offsets between them
 * survive; the cell then grows to fit them through the normal auto rule (ADR-196).
 */
export function tableCellPlacement(
  grid: TableGrid,
  rowId: string,
  columnId: string,
  widgets: readonly Widget[],
  ids: readonly string[],
): { x: number; y: number } | null {
  const cell = cellRect(grid, rowId, columnId);
  if (!cell) return null;
  const boxes = ids
    .map((id) => widgets.find((widget) => widget.id === id))
    .filter((widget): widget is Widget => Boolean(widget))
    .map((widget) => boxOf(widget));
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return {
    x: cell.x + TABLE_CELL_PADDING - left,
    y: cell.y + TABLE_CELL_PADDING - top,
  };
}
