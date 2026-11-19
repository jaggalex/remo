import {
  tableSpans,
  type CellPlacement,
  type TableAxis,
  type TableLayout,
  type TableSpan,
} from "@remo/model";
import type { BoardDocument } from "./board";
import {
  axesOf,
  childrenOf,
  editableFrame,
  frameFor,
  writeLayout,
  type TableAxisKind,
} from "./tableContext";

/**
 * Merged blocks are spans of axes (ADR-204). These helpers keep them honest when an
 * axis is inserted, deleted or moved; a span is never repaired into a different block.
 */
function spanAxisField(kind: TableAxisKind): "rowId" | "columnId" {
  return kind === "column" ? "columnId" : "rowId";
}

function spanCount(span: TableSpan, kind: TableAxisKind): number {
  return kind === "column" ? span.columnSpan : span.rowSpan;
}

function withSpanCount(span: TableSpan, kind: TableAxisKind, count: number): TableSpan {
  return kind === "column" ? { ...span, columnSpan: count } : { ...span, rowSpan: count };
}

/** Inserting an axis inside a merged block extends the block (ADR-204). */
export function spansAfterInsert(
  layout: TableLayout,
  kind: TableAxisKind,
  index: number,
): TableSpan[] | undefined {
  const spans = tableSpans(layout);
  if (!spans.length) return undefined;
  const axes = axesOf(layout, kind);
  const field = spanAxisField(kind);
  const next: TableSpan[] = [];
  for (const span of spans) {
    const start = axes.findIndex((axis) => axis.id === span[field]);
    if (start < 0) continue;
    const count = spanCount(span, kind);
    const grows = index > start && index <= start + count - 1;
    next.push(grows ? withSpanCount(span, kind, count + 1) : span);
  }
  return next.length ? next : undefined;
}

/** Deleting an axis inside a block shrinks it; deleting the anchor releases it. */
export function spansAfterDelete(
  layout: TableLayout,
  kind: TableAxisKind,
  deletedIndex: number,
): TableSpan[] | undefined {
  const spans = tableSpans(layout);
  if (!spans.length) return undefined;
  const axes = axesOf(layout, kind);
  const field = spanAxisField(kind);
  const next: TableSpan[] = [];
  for (const span of spans) {
    const start = axes.findIndex((axis) => axis.id === span[field]);
    if (start < 0) continue;
    const count = spanCount(span, kind);
    if (deletedIndex < start || deletedIndex > start + count - 1) {
      next.push(span);
      continue;
    }
    if (deletedIndex === start) continue;
    const shrunk = count - 1;
    if (shrunk < 2) continue;
    next.push(withSpanCount(span, kind, shrunk));
  }
  return next.length ? next : undefined;
}

/**
 * Moving an axis may put a different set of axes under a span. The block is released
 * rather than silently acquiring a neighbour (ADR-204); objects stay in their cells.
 */
export function spansAfterMove(
  before: TableLayout,
  after: TableLayout,
  kind: TableAxisKind,
): TableSpan[] | undefined {
  const spans = tableSpans(after);
  if (!spans.length) return undefined;
  const beforeAxes = axesOf(before, kind);
  const afterAxes = axesOf(after, kind);
  const field = spanAxisField(kind);
  const idsFor = (axes: TableAxis[], span: TableSpan): string[] | null => {
    const start = axes.findIndex((axis) => axis.id === span[field]);
    if (start < 0) return null;
    const count = spanCount(span, kind);
    if (start + count > axes.length) return null;
    return axes.slice(start, start + count).map((axis) => axis.id);
  };
  const next: TableSpan[] = [];
  for (const span of spans) {
    const covered = idsFor(beforeAxes, span);
    if (!covered) continue;
    const moved = idsFor(afterAxes, span);
    if (!moved || moved.length !== covered.length) continue;
    // Any difference — not only the moved axis under the block — means the merge would
    // silently cover a different neighbour, so it is released (ADR-204).
    if (moved.every((id, index) => id === covered[index])) next.push(span);
  }
  return next.length ? next : undefined;
}

function withoutSpans(layout: TableLayout): TableLayout {
  if (!layout.spans?.length) return layout;
  const { spans: _spans, ...rest } = layout;
  return rest;
}

export function withSpans(layout: TableLayout, spans: TableSpan[] | undefined): TableLayout {
  return spans?.length ? { ...layout, spans } : withoutSpans(layout);
}

/** One axis index for every requested cell, or null when a cell is unknown. */
function cellIndexes(
  layout: TableLayout,
  cells: readonly CellPlacement[],
): Array<{ rowAt: number; columnAt: number }> | null {
  const rowIndex = new Map(layout.rows.map((axis, index) => [axis.id, index]));
  const columnIndex = new Map(layout.columns.map((axis, index) => [axis.id, index]));
  const output: Array<{ rowAt: number; columnAt: number }> = [];
  for (const cell of cells) {
    const rowAt = rowIndex.get(cell.rowId);
    const columnAt = columnIndex.get(cell.columnId);
    if (rowAt == null || columnAt == null) return null;
    output.push({ rowAt, columnAt });
  }
  return output;
}

/** The block an axis cell belongs to, as an inclusive rectangle of indices. */
function blockOf(
  layout: TableLayout,
  rowAt: number,
  columnAt: number,
): { top: number; left: number; bottom: number; right: number } {
  for (const span of tableSpans(layout)) {
    const top = layout.rows.findIndex((axis) => axis.id === span.rowId);
    const left = layout.columns.findIndex((axis) => axis.id === span.columnId);
    if (top < 0 || left < 0) continue;
    const bottom = top + span.rowSpan - 1;
    const right = left + span.columnSpan - 1;
    if (rowAt >= top && rowAt <= bottom && columnAt >= left && columnAt <= right) {
      return { top, left, bottom, right };
    }
  }
  return { top: rowAt, left: columnAt, bottom: rowAt, right: columnAt };
}

export type MergeCellsResult =
  | {
      ok: true;
      anchor: CellPlacement;
      rowSpan: number;
      columnSpan: number;
      moved: string[];
    }
  | { ok: false; reason: "missing" | "locked" | "few" | "shape" | "axis" };

/**
 * Merge a rectangular selection into one cell (ADR-204).
 *
 * The selection may name a covered cell: the whole block it belongs to is merged, so a
 * click inside a previous merge never produces a partial overlap. Objects from covered
 * cells keep their world coordinates and only change membership to the anchor.
 */
export function mergeCells(
  board: BoardDocument,
  frameId: string,
  cells: readonly CellPlacement[],
): MergeCellsResult {
  const frame = editableFrame(board, frameId);
  if (!frame) return { ok: false, reason: frameFor(board, frameId) ? "locked" : "missing" };
  if (!frame.layout || frame.layout.kind !== "table") return { ok: false, reason: "missing" };
  const layout = frame.layout;
  const requested = cellIndexes(layout, cells);
  if (!requested) return { ok: false, reason: "axis" };
  const unique = new Set(requested.map((cell) => `${cell.rowAt}:${cell.columnAt}`));
  if (unique.size < 2) return { ok: false, reason: "few" };

  const blocks = requested.map((cell) => blockOf(layout, cell.rowAt, cell.columnAt));
  const top = Math.min(...blocks.map((block) => block.top));
  const left = Math.min(...blocks.map((block) => block.left));
  const bottom = Math.max(...blocks.map((block) => block.bottom));
  const right = Math.max(...blocks.map((block) => block.right));
  if (top === bottom && left === right) return { ok: false, reason: "few" };

  // Every cell of the bounding rectangle must be selected or already inside an included
  // block: two diagonal blocks do not make a rectangle.
  const included = new Set<string>();
  for (const block of blocks) {
    const rowSpan = block.bottom - block.top + 1;
    const columnSpan = block.right - block.left + 1;
    const area = rowSpan * columnSpan;
    for (let r = block.top; r <= block.bottom; r += 1) {
      for (let c = block.left; c <= block.right; c += 1) included.add(`${r}:${c}`);
    }
    if (area < 1 || block.top < top || block.left < left) return { ok: false, reason: "shape" };
  }
  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) {
      if (!included.has(`${r}:${c}`)) return { ok: false, reason: "shape" };
    }
  }

  const anchor: CellPlacement = {
    rowId: layout.rows[top]!.id,
    columnId: layout.columns[left]!.id,
  };
  const rowId = anchor.rowId;
  const columnId = anchor.columnId;
  const inside = (cell: CellPlacement): boolean => {
    const rowAt = layout.rows.findIndex((axis) => axis.id === cell.rowId);
    const columnAt = layout.columns.findIndex((axis) => axis.id === cell.columnId);
    return rowAt >= top && rowAt <= bottom && columnAt >= left && columnAt <= right;
  };

  const moved: string[] = [];
  board.transact(() => {
    for (const child of childrenOf(board, frame.id)) {
      if (!child.cell || !inside(child.cell)) continue;
      if (child.cell.rowId === rowId && child.cell.columnId === columnId) continue;
      board.widgets.set(child.id, { ...child, cell: { rowId, columnId } });
      moved.push(child.id);
    }
    const spans = tableSpans(layout).filter((span) => {
      const spanTop = layout.rows.findIndex((axis) => axis.id === span.rowId);
      const spanLeft = layout.columns.findIndex((axis) => axis.id === span.columnId);
      if (spanTop < 0 || spanLeft < 0) return false;
      return !(
        spanTop >= top &&
        spanLeft >= left &&
        spanTop + span.rowSpan - 1 <= bottom &&
        spanLeft + span.columnSpan - 1 <= right
      );
    });
    spans.push({
      rowId,
      columnId,
      rowSpan: bottom - top + 1,
      columnSpan: right - left + 1,
    });
    writeLayout(board, frame, { ...layout, spans });
  });
  return {
    ok: true,
    anchor,
    rowSpan: bottom - top + 1,
    columnSpan: right - left + 1,
    moved,
  };
}

/** Release the merged block covering a cell; objects stay in the anchor (ADR-204). */
export function splitCell(
  board: BoardDocument,
  frameId: string,
  rowId: string,
  columnId: string,
): boolean {
  const frame = editableFrame(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  const layout = frame.layout;
  const spans = tableSpans(layout);
  if (!spans.length) return false;
  const target = blockOf(
    layout,
    layout.rows.findIndex((axis) => axis.id === rowId),
    layout.columns.findIndex((axis) => axis.id === columnId),
  );
  const anchorRow = layout.rows[target.top];
  const anchorColumn = layout.columns[target.left];
  if (!anchorRow || !anchorColumn) return false;
  const next = spans.filter(
    (span) => !(span.rowId === anchorRow.id && span.columnId === anchorColumn.id),
  );
  if (next.length === spans.length) return false;
  board.transact(() => writeLayout(board, frame, withSpans(layout, next)));
  return true;
}
