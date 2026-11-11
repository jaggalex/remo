import type { Rect, Widget } from "./types";
import type { TableAxis, TableAxisSize, TableLayout } from "./table";

/**
 * Table geometry for a section (ADR-196, ADR-199, ADR-201).
 *
 * The section's top-left corner is the table's origin, and the section's box is exactly
 * the header band plus the axes: there is no free margin around a table (ADR-201). A
 * column is as wide as its widest cell content plus the padding on both sides, never
 * narrower than its manual size or the minimum. The size depends only on the objects'
 * own dimensions, not on where they currently lie, so `reflowTable` can put every
 * cell's objects at its padding corner and get the same grid back: the layout is a
 * fixed point, and two clients that reflow the same document agree.
 *
 * This module is pure and shared: the painter and hit-testing read it in the browser,
 * the document commands read it to place objects and size the section.
 */

export const TABLE_HEADER_HEIGHT = 40;
export const TABLE_HEADER_WIDTH = 128;
export const TABLE_CELL_PADDING = 16;
export const TABLE_MIN_COLUMN = 120;
export const TABLE_MIN_ROW = 72;
/** A manual pixel size is clamped to this range (ADR-201). */
export const TABLE_MAX_AXIS = 2400;
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

function boxOf(widget: Widget): Rect {
  return {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
}

/** The union box of some objects, or null for none. */
export function unionBox(widgets: readonly Widget[]): Rect | null {
  if (!widgets.length) return null;
  const boxes = widgets.map(boxOf);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether a stored axis size is a manual pixel value rather than a named mode. */
export function isPixelSize(size: TableAxis["size"]): size is number {
  return typeof size === "number";
}

/** Clamp a manual pixel size for one kind of axis. */
export function clampAxisSize(kind: "column" | "row", px: number): number {
  const minimum = kind === "column" ? TABLE_MIN_COLUMN : TABLE_MIN_ROW;
  return Math.round(Math.min(TABLE_MAX_AXIS, Math.max(minimum, px)));
}

/** The floor an axis asks for before its content is measured. */
function manualFloor(kind: "column" | "row", size: TableAxis["size"]): number {
  const minimum = kind === "column" ? TABLE_MIN_COLUMN : TABLE_MIN_ROW;
  if (isPixelSize(size)) return clampAxisSize(kind, size);
  if (!size || size === "auto") return minimum;
  const presets = kind === "column" ? PRESET_COLUMN : PRESET_ROW;
  return presets[size as Exclude<TableAxisSize, "auto">] ?? minimum;
}

/** The members of one cell. */
export function cellMembers(
  widgets: readonly Widget[],
  frameId: string,
  rowId: string,
  columnId: string,
): Widget[] {
  return widgets.filter(
    (widget) =>
      widget.parentId === frameId &&
      widget.cell?.rowId === rowId &&
      widget.cell?.columnId === columnId,
  );
}

/**
 * Sizes of every column and row: a manual size is a floor, content always fits
 * (ADR-201: an object never leaves its cell, the cell grows).
 */
export function tableAxisSizes(
  frame: Widget,
  layout: TableLayout,
  widgets: readonly Widget[],
): { columns: number[]; rows: number[] } {
  const pad = TABLE_CELL_PADDING * 2;
  const columns = layout.columns.map((column) => {
    let content = 0;
    for (const row of layout.rows) {
      const box = unionBox(cellMembers(widgets, frame.id, row.id, column.id));
      if (box) content = Math.max(content, box.width + pad);
    }
    return Math.max(manualFloor("column", column.size), content);
  });
  const rows = layout.rows.map((row) => {
    let content = 0;
    for (const column of layout.columns) {
      const box = unionBox(cellMembers(widgets, frame.id, row.id, column.id));
      if (box) content = Math.max(content, box.height + pad);
    }
    return Math.max(manualFloor("row", row.size), content);
  });
  return { columns, rows };
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
  const sizes = tableAxisSizes(frame, layout, widgets);

  const columns: TableColumn[] = [];
  let x = origin.x + headerWidth;
  layout.columns.forEach((axis, index) => {
    const width = sizes.columns[index]!;
    columns.push({ axis, x, width });
    x += width;
  });

  const rows: TableRow[] = [];
  let y = origin.y + headerHeight;
  layout.rows.forEach((axis, index) => {
    const height = sizes.rows[index]!;
    rows.push({ axis, y, height });
    y += height;
  });

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

/** One object's new centre after a reflow. */
export interface TableReflowMove {
  id: string;
  x: number;
  y: number;
}

/**
 * Where everything goes so the section is exactly its table (ADR-201).
 *
 * Each cell's objects keep their arrangement and move together so their union's
 * top-left sits at the cell's padding corner; the section keeps its top-left and takes
 * the grid's size. Running it twice changes nothing. Locked objects still move: the
 * table owns their place, as a kanban owns a card's (ADR-040 guards gestures, not
 * layout).
 */
export function tableReflow(
  frame: Widget,
  widgets: readonly Widget[],
): { frame: Rect; moves: TableReflowMove[] } | null {
  const grid = layoutTable(frame, widgets);
  if (!grid) return null;
  const moves: TableReflowMove[] = [];
  for (const cell of grid.cells) {
    const members = cellMembers(widgets, frame.id, cell.rowId, cell.columnId);
    const box = unionBox(members);
    if (!box) continue;
    const dx = cell.rect.x + TABLE_CELL_PADDING - box.x;
    const dy = cell.rect.y + TABLE_CELL_PADDING - box.y;
    if (dx === 0 && dy === 0) continue;
    for (const member of members) {
      moves.push({ id: member.id, x: member.x + dx, y: member.y + dy });
    }
  }
  return {
    frame: { x: grid.origin.x, y: grid.origin.y, width: grid.width, height: grid.height },
    moves,
  };
}

/**
 * A table section has no resize handles: its axes are its size (ADR-201). The same
 * test gates the painter and the pointer, so a hidden handle cannot be grabbed.
 */
export function sizedByTable(widget: Widget): boolean {
  return widget.layout?.kind === "table" && widget.layout.active !== false;
}
