import type { Rect, Widget } from "./types";
import {
  tableCellPadding,
  tableSpans,
  type TableAxis,
  type TableAxisSize,
  type TableLayout,
  type TableSpan,
} from "./table";

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
/** A long row name grows the header column, up to this width, then wraps. */
export const TABLE_HEADER_MAX_WIDTH = 260;
/** A vertical header grows the header band, up to this height. */
export const TABLE_HEADER_MAX_HEIGHT = 260;
export const TABLE_HEADER_PADDING = 10;
export const TABLE_HEADER_LINE_HEIGHT = 16;
/** Header text longer than this is shortened with an ellipsis (ADR-201). */
export const TABLE_HEADER_MAX_TEXT = 100;
/** Approximate advance of the 12 px interface font; geometry cannot measure text. */
const HEADER_CHAR_WIDTH = 6.6;
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
  /** 2 or more when the cell is a merged anchor (ADR-204). */
  rowSpan: number;
  columnSpan: number;
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

/**
 * Header text that may be painted: spaces collapsed, intentional line breaks kept, at
 * most 100 characters (ADR-202, ADR-217).
 */
export function headerText(title: string): string {
  const text = title
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
  return text.length > TABLE_HEADER_MAX_TEXT
    ? `${text.slice(0, TABLE_HEADER_MAX_TEXT - 1)}…`
    : text;
}

/** The longest explicit line, which is what a vertical header has to fit. */
export function longestHeaderLine(text: string): string {
  return text
    .split("\n")
    .reduce((longest, line) => (line.length > longest.length ? line : longest), "");
}

function approxWidth(text: string): number {
  return text.length * HEADER_CHAR_WIDTH;
}

/** Approximate wrapped line count for one paragraph at a given width. */
function paragraphLineCount(text: string, usable: number): number {
  if (!text) return 1;
  let lines = 1;
  let line = 0;
  for (const word of text.split(" ")) {
    const wordWidth = Math.max(1, approxWidth(word));
    if (line === 0) {
      line = wordWidth;
      if (wordWidth > usable) {
        lines += Math.ceil(wordWidth / usable) - 1;
        line = wordWidth % usable || usable;
      }
      continue;
    }
    if (line + HEADER_CHAR_WIDTH + wordWidth <= usable) {
      line += HEADER_CHAR_WIDTH + wordWidth;
      continue;
    }
    lines += 1;
    line = wordWidth;
    if (wordWidth > usable) {
      lines += Math.ceil(wordWidth / usable) - 1;
      line = wordWidth % usable || usable;
    }
  }
  return lines;
}

/** Explicit line breaks count as lines; each paragraph still wraps (ADR-217). */
function headerLineCount(text: string, width: number): number {
  if (!text) return 1;
  const usable = Math.max(24, width - TABLE_HEADER_PADDING * 2);
  return text
    .split("\n")
    .reduce((total, paragraph) => total + paragraphLineCount(paragraph, usable), 0);
}

/** The width a vertical header needs for its explicit lines. */
function verticalHeaderWidth(text: string): number {
  return (
    Math.max(1, text.split("\n").length) * TABLE_HEADER_LINE_HEIGHT +
    TABLE_HEADER_PADDING * 2
  );
}

/** The row-header strip: manual, or as wide as its longest horizontal label. */
function headerWidthFor(layout: TableLayout): number {
  if (layout.headerWidth) return layout.headerWidth;
  const longest = layout.rows.reduce(
    (width, row) =>
      row.vertical
        ? Math.max(width, TABLE_HEADER_LINE_HEIGHT)
        : Math.max(width, approxWidth(headerText(row.title))),
    0,
  );
  return Math.min(
    TABLE_HEADER_MAX_WIDTH,
    Math.max(TABLE_HEADER_WIDTH, longest + TABLE_HEADER_PADDING * 2),
  );
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

function contentColumnWidths(
  frame: Widget,
  layout: TableLayout,
  widgets: readonly Widget[],
  startX: number,
): number[] {
  const columns = layout.columns;
  const widths = columns.map((column) =>
    Math.max(TABLE_MIN_COLUMN, manualFloor("column", column.size)),
  );
  const columnIndex = new Map(columns.map((column, index) => [column.id, index]));
  const rowIndex = new Map(layout.rows.map((row, index) => [row.id, index]));
  const merged = new Set<string>();
  const spans: Array<{ span: TableSpan; top: number; left: number }> = [];
  for (const span of tableSpans(layout)) {
    const top = rowIndex.get(span.rowId);
    const left = columnIndex.get(span.columnId);
    if (top == null || left == null) continue;
    spans.push({ span, top, left });
    for (let r = top; r < top + span.rowSpan; r += 1) {
      for (let c = left; c < left + span.columnSpan; c += 1) merged.add(`${r}:${c}`);
    }
  }

  let x = startX;
  columns.forEach((column, index) => {
    let content = 0;
    layout.rows.forEach((row, rowAt) => {
      if (merged.has(`${rowAt}:${index}`)) return;
      const padding = tableCellPadding(layout, row.id, column.id) ?? TABLE_CELL_PADDING;
      for (const member of cellMembers(widgets, frame.id, row.id, column.id)) {
        // The cell covers the member's full width and its right offset from the cell
        // origin; the member keeps its own offset when it is already inside. A member
        // that strayed left is repaired by tableReflow, and the width still holds it.
        content = Math.max(
          content,
          member.width + padding * 2,
          member.x + member.width / 2 - x + padding,
        );
      }
    });
    if (column.vertical) content = Math.max(content, verticalHeaderWidth(headerText(column.title)));
    widths[index] = Math.max(widths[index]!, content);
    x += widths[index]!;
  });

  // A merged cell is as wide as the sum of its axes; the deficit goes to its last
  // column, so the layout stays a fixed point (ADR-204, ADR-201).
  for (const { span, top, left } of spans) {
    const spanX = startX + widths.slice(0, left).reduce((total, width) => total + width, 0);
    let content = 0;
    for (let r = top; r < Math.min(top + span.rowSpan, layout.rows.length); r += 1) {
      for (let c = left; c < Math.min(left + span.columnSpan, columns.length); c += 1) {
        const cellPadding =
          tableCellPadding(layout, layout.rows[r]!.id, columns[c]!.id) ?? TABLE_CELL_PADDING;
        for (const member of cellMembers(widgets, frame.id, layout.rows[r]!.id, columns[c]!.id)) {
          content = Math.max(
            content,
            member.width + cellPadding * 2,
            member.x + member.width / 2 - spanX + cellPadding,
          );
        }
      }
    }
    const last = Math.min(left + span.columnSpan, columns.length) - 1;
    let total = 0;
    for (let c = left; c <= last; c += 1) total += widths[c]!;
    if (content > total) widths[last] = widths[last]! + (content - total);
  }
  return widths;
}

function contentRowHeights(
  frame: Widget,
  layout: TableLayout,
  widgets: readonly Widget[],
  startY: number,
): number[] {
  const rows = layout.rows;
  const heights = rows.map((row) => Math.max(TABLE_MIN_ROW, manualFloor("row", row.size)));
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(layout.columns.map((column, index) => [column.id, index]));
  const merged = new Set<string>();
  const spans: Array<{ span: TableSpan; top: number; left: number }> = [];
  for (const span of tableSpans(layout)) {
    const top = rowIndex.get(span.rowId);
    const left = columnIndex.get(span.columnId);
    if (top == null || left == null) continue;
    spans.push({ span, top, left });
    for (let r = top; r < top + span.rowSpan; r += 1) {
      for (let c = left; c < left + span.columnSpan; c += 1) merged.add(`${r}:${c}`);
    }
  }

  let y = startY;
  rows.forEach((row, index) => {
    let content = 0;
    layout.columns.forEach((column, columnAt) => {
      if (merged.has(`${index}:${columnAt}`)) return;
      const padding = tableCellPadding(layout, row.id, column.id) ?? TABLE_CELL_PADDING;
      for (const member of cellMembers(widgets, frame.id, row.id, column.id)) {
        content = Math.max(
          content,
          member.height + padding * 2,
          member.y + member.height / 2 - y + padding,
        );
      }
    });
    heights[index] = Math.max(heights[index]!, content);
    y += heights[index]!;
  });

  for (const { span, top, left } of spans) {
    const spanY = startY + heights.slice(0, top).reduce((total, height) => total + height, 0);
    let content = 0;
    for (let r = top; r < Math.min(top + span.rowSpan, rows.length); r += 1) {
      for (let c = left; c < Math.min(left + span.columnSpan, layout.columns.length); c += 1) {
        const cellPadding =
          tableCellPadding(layout, rows[r]!.id, layout.columns[c]!.id) ?? TABLE_CELL_PADDING;
        for (const member of cellMembers(widgets, frame.id, rows[r]!.id, layout.columns[c]!.id)) {
          content = Math.max(
            content,
            member.height + cellPadding * 2,
            member.y + member.height / 2 - spanY + cellPadding,
          );
        }
      }
    }
    const last = Math.min(top + span.rowSpan, rows.length) - 1;
    let total = 0;
    for (let r = top; r <= last; r += 1) total += heights[r]!;
    if (content > total) heights[last] = heights[last]! + (content - total);
  }
  return heights;
}

/**
 * The header band needed for the current columns (ADR-202, ADR-217): a vertical header
 * fits its longest line, a horizontal one wraps into the band.
 */
function headerHeightFor(columns: readonly TableColumn[], manual?: number): number {
  if (manual) return manual;
  let height = TABLE_HEADER_HEIGHT;
  for (const column of columns) {
    const text = headerText(column.axis.title);
    const needed = column.axis.vertical
      ? approxWidth(longestHeaderLine(text)) + TABLE_HEADER_PADDING * 2
      : headerLineCount(text, column.width) * TABLE_HEADER_LINE_HEIGHT +
        TABLE_HEADER_PADDING * 2;
    height = Math.max(height, needed);
  }
  return Math.min(TABLE_HEADER_MAX_HEIGHT, height);
}

/**
 * Sizes of every column and row: a manual size is a floor, content always fits
 * (ADR-201, ADR-202: an object never leaves its cell, the cell grows around it).
 */
export function tableAxisSizes(
  frame: Widget,
  layout: TableLayout,
  widgets: readonly Widget[],
): { columns: number[]; rows: number[] } {
  const origin = { x: frame.x - frame.width / 2, y: frame.y - frame.height / 2 };
  const headerWidth = headerWidthFor(layout);
  const columns = contentColumnWidths(frame, layout, widgets, origin.x + headerWidth);
  const placed = layout.columns.map((axis, index) => ({
    axis,
    x: 0,
    width: columns[index]!,
  }));
  const headerHeight = headerHeightFor(placed, layout.headerHeight);
  const rows = contentRowHeights(frame, layout, widgets, origin.y + headerHeight);
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
  const headerWidth = headerWidthFor(layout);
  const widths = contentColumnWidths(frame, layout, widgets, origin.x + headerWidth);

  const columns: TableColumn[] = [];
  let x = origin.x + headerWidth;
  layout.columns.forEach((axis, index) => {
    const width = widths[index]!;
    columns.push({ axis, x, width });
    x += width;
  });

  const headerHeight = headerHeightFor(columns, layout.headerHeight);
  const heights = contentRowHeights(frame, layout, widgets, origin.y + headerHeight);

  const rows: TableRow[] = [];
  let y = origin.y + headerHeight;
  layout.rows.forEach((axis, index) => {
    const height = heights[index]!;
    rows.push({ axis, y, height });
    y += height;
  });

  const cells: TableCell[] = [];
  const rowIndex = new Map(layout.rows.map((axis, index) => [axis.id, index]));
  const columnIndex = new Map(layout.columns.map((axis, index) => [axis.id, index]));
  const spans = new Map<string, TableSpan>();
  const covered = new Set<string>();
  for (const span of tableSpans(layout)) {
    const topAt: number | undefined = rowIndex.get(span.rowId);
    const leftAt: number | undefined = columnIndex.get(span.columnId);
    if (topAt === undefined || leftAt === undefined) continue;
    spans.set(`${topAt}:${leftAt}`, span);
    for (let rowCursor: number = topAt; rowCursor < topAt + span.rowSpan; rowCursor += 1) {
      for (
        let columnCursor: number = leftAt;
        columnCursor < leftAt + span.columnSpan;
        columnCursor += 1
      ) {
        if (rowCursor !== topAt || columnCursor !== leftAt) {
          covered.add(`${rowCursor}:${columnCursor}`);
        }
      }
    }
  }
  rows.forEach((row, rowAt) => {
    columns.forEach((column, columnAt) => {
      if (covered.has(`${rowAt}:${columnAt}`)) return;
      const span = spans.get(`${rowAt}:${columnAt}`);
      const rowSpan = Math.min(span?.rowSpan ?? 1, rows.length - rowAt);
      const columnSpan = Math.min(span?.columnSpan ?? 1, columns.length - columnAt);
      const lastRow = rows[rowAt + rowSpan - 1]!;
      const lastColumn = columns[columnAt + columnSpan - 1]!;
      cells.push({
        rowId: row.axis.id,
        columnId: column.axis.id,
        rect: {
          x: column.x,
          y: row.y,
          width: lastColumn.x + lastColumn.width - column.x,
          height: lastRow.y + lastRow.height - row.y,
        },
        rowSpan,
        columnSpan,
      });
    });
  });

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
 * Each cell's objects keep their arrangement and their offset inside the cell. The
 * section keeps its top-left and takes the grid's size; a member that crossed the
 * padding into the header or a neighbouring cell is moved back. Running it twice
 * changes nothing. Locked objects may move with the table: the table owns the cell
 * layout, as a kanban owns a card's place (ADR-201, ADR-202).
 */
export function tableReflow(
  frame: Widget,
  widgets: readonly Widget[],
): { frame: Rect; moves: TableReflowMove[] } | null {
  let settled = layoutTable(frame, widgets);
  if (!settled || !frame.layout) return null;
  const layout = frame.layout;
  let current = widgets;
  const moved = new Map<string, TableReflowMove>();

  // A repair can widen one column, shift the next cell's origin, and need one more
  // repair. Iterate to the fixed point inside this one pure call, so the command writes
  // a settled document once (ADR-203).
  for (let pass = 0; pass < 4; pass += 1) {
    const passMoves: TableReflowMove[] = [];
    for (const cell of settled.cells) {
      const members = cellMembers(current, frame.id, cell.rowId, cell.columnId);
      const box = unionBox(members);
      if (!box) continue;
      // The object keeps its offset inside the cell. Only a member that crossed the
      // padding into the header or the neighbouring cell is put back; a normal move
      // inside the cell is never undone (ADR-203).
      const padding =
        tableCellPadding(layout, cell.rowId, cell.columnId) ?? TABLE_CELL_PADDING;
      const dx =
        box.x < cell.rect.x + padding ? cell.rect.x + padding - box.x : 0;
      const dy =
        box.y < cell.rect.y + padding ? cell.rect.y + padding - box.y : 0;
      if (dx === 0 && dy === 0) continue;
      for (const member of members) {
        passMoves.push({ id: member.id, x: member.x + dx, y: member.y + dy });
      }
    }
    if (!passMoves.length) break;
    const byId = new Map(passMoves.map((move) => [move.id, move]));
    for (const move of passMoves) moved.set(move.id, move);
    current = current.map((widget) => {
      const move = byId.get(widget.id);
      return move ? { ...widget, x: move.x, y: move.y } : widget;
    });
    settled = layoutTable(frame, current) ?? settled;
  }

  return {
    frame: {
      x: settled.origin.x,
      y: settled.origin.y,
      width: settled.width,
      height: settled.height,
    },
    moves: [...moved.values()],
  };
}

/**
 * A table section has no resize handles: its axes are its size (ADR-201). The same
 * test gates the painter and the pointer, so a hidden handle cannot be grabbed.
 */
export function sizedByTable(widget: Widget): boolean {
  return widget.layout?.kind === "table" && widget.layout.active !== false;
}
