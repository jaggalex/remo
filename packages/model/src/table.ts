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

/**
 * Optional hex fills. The most specific wins: cell, row, column, headers, table.
 * An absent key means "as before"; clearing an override deletes the key.
 */
export interface TableAppearance {
  table?: string;
  headers?: string;
  columns?: Record<string, string>;
  rows?: Record<string, string>;
  /** Key is `"<rowId>:<columnId>"`. */
  cells?: Record<string, string>;
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
}

/** Membership of an ordinary object in one cell of its section's table. */
export interface CellPlacement {
  rowId: string;
  columnId: string;
}

/** The fill for one cell, with the specificity order from ADR-199. */
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
