/**
 * A section's table layout (ADR-196, ADR-199).
 *
 * The layout is a property of the frame, not a new widget type. Objects stay ordinary
 * widgets with absolute world coordinates and an optional `cell`; the cell box is derived
 * from the axes. Fills are named overrides on the layout, never a change to a child's own
 * style.
 */

export type TableAxisSize = "auto" | "narrow" | "medium" | "wide";

export interface TableAxis {
  /** Stable identity: order and title may change without renaming the axis. */
  id: string;
  title: string;
  /**
   * Absent or `auto`: the axis follows its content. A preset or a whole number of
   * pixels is a manual floor; content still fits (ADR-196, ADR-201).
   */
  size?: TableAxisSize | number;
  /** Column headers only; row headers stay horizontal (ADR-196). */
  vertical?: boolean;
}

export type TableBorderStyle = "solid" | "dashed" | "none";

/** One border of a table area (ADR-208). Width is in screen pixels at 100 % zoom. */
export interface TableBorder {
  color: string;
  width: number;
  style: TableBorderStyle;
}

/**
 * Optional appearance overrides. Fills and borders use the same specificity: cell, row,
 * column, headers, table; an absent key means "as before" and clearing it deletes the key.
 */
export interface TableAppearance {
  table?: string;
  headers?: string;
  columns?: Record<string, string>;
  rows?: Record<string, string>;
  /** Key is `"<rowId>:<columnId>"`. */
  cells?: Record<string, string>;
  /** Borders per area (ADR-208). */
  borders?: TableBorderOverrides;
  /** Cell content padding in world units; absent means the default (ADR-208). */
  paddings?: TablePaddingOverrides;
}

export interface TableBorderOverrides {
  table?: TableBorder;
  headers?: TableBorder;
  columns?: Record<string, TableBorder>;
  rows?: Record<string, TableBorder>;
  cells?: Record<string, TableBorder>;
}

export interface TablePaddingOverrides {
  table?: number;
  headers?: number;
  columns?: Record<string, number>;
  rows?: Record<string, number>;
  cells?: Record<string, number>;
}

/**
 * A merged block of a table (ADR-204).
 *
 * The span is anchored at its top-left cell and covers the axes between the anchor and
 * the last covered one. It stores ids and counts, never coordinates or sizes: the block
 * is the union of the axes, so `layoutTable` remains the only place that knows geometry.
 * Covered cells keep their identity; an object may still name one and the geometry maps
 * it to the anchor.
 */
export interface TableSpan {
  rowId: string;
  columnId: string;
  rowSpan: number;
  columnSpan: number;
}

export interface TableLayout {
  kind: "table";
  columns: TableAxis[];
  rows: TableAxis[];
  /**
   * `false` keeps the axes and cells for a later return to the table; the painter draws
   * the free layout while it is false. Absent means active.
   */
  active?: boolean;
  appearance?: TableAppearance;
  /** Merged blocks, anchored at their top-left cell (ADR-204). */
  spans?: TableSpan[];
}

/** Membership of an ordinary object in one cell of its section's table. */
export interface CellPlacement {
  rowId: string;
  columnId: string;
}

/** The fill for one cell, with the specificity order from ADR-199. */
/** The border of one cell, with the specificity order from ADR-199/ADR-208. */
export function tableCellBorder(
  layout: TableLayout,
  rowId: string,
  columnId: string,
): TableBorder | undefined {
  const borders = layout.appearance?.borders;
  if (!borders) return undefined;
  return (
    borders.cells?.[`${rowId}:${columnId}`] ??
    borders.rows?.[rowId] ??
    borders.columns?.[columnId] ??
    borders.headers ??
    borders.table
  );
}

/** The padding of one cell, or undefined when the default applies (ADR-208). */
export function tableCellPadding(
  layout: TableLayout,
  rowId: string,
  columnId: string,
): number | undefined {
  const paddings = layout.appearance?.paddings;
  if (!paddings) return undefined;
  return (
    paddings.cells?.[`${rowId}:${columnId}`] ??
    paddings.rows?.[rowId] ??
    paddings.columns?.[columnId] ??
    paddings.headers ??
    paddings.table
  );
}

export function tableCellFill(
  layout: TableLayout,
  rowId: string,
  columnId: string,
): string | undefined {
  const appearance = layout.appearance;
  if (!appearance) return undefined;
  return (
    appearance.cells?.[`${rowId}:${columnId}`] ??
    appearance.rows?.[rowId] ??
    appearance.columns?.[columnId] ??
    appearance.headers ??
    appearance.table
  );
}

/** Merged blocks of a layout; an absent field means none (ADR-204). */
export function tableSpans(layout: TableLayout): readonly TableSpan[] {
  return layout.spans ?? [];
}

/** Axis ids a span covers, in order, or null when an id is missing from the layout. */
export function tableSpanAxes(
  layout: TableLayout,
  span: TableSpan,
): { rows: string[]; columns: string[] } | null {
  const rowIndex = layout.rows.findIndex((axis) => axis.id === span.rowId);
  const columnIndex = layout.columns.findIndex((axis) => axis.id === span.columnId);
  if (rowIndex < 0 || columnIndex < 0) return null;
  const rows = layout.rows.slice(rowIndex, rowIndex + span.rowSpan).map((axis) => axis.id);
  const columns = layout.columns
    .slice(columnIndex, columnIndex + span.columnSpan)
    .map((axis) => axis.id);
  if (rows.length < span.rowSpan || columns.length < span.columnSpan) return null;
  return { rows, columns };
}

/** The span covering one cell, whether it is the anchor or a covered cell, or null. */
export function tableSpanAt(
  layout: TableLayout,
  rowId: string,
  columnId: string,
): TableSpan | null {
  for (const span of tableSpans(layout)) {
    const axes = tableSpanAxes(layout, span);
    if (!axes) continue;
    if (axes.rows.includes(rowId) && axes.columns.includes(columnId)) return span;
  }
  return null;
}

/** Whether a cell is covered by a span but is not its anchor. */
export function isCoveredCell(
  layout: TableLayout,
  rowId: string,
  columnId: string,
): boolean {
  const span = tableSpanAt(layout, rowId, columnId);
  if (!span) return false;
  return span.rowId !== rowId || span.columnId !== columnId;
}
