import {
  newId,
  type CellPlacement,
  type TableAxis,
  type TableLayout,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * The plan behind "turn this section into a table" (ADR-207, T4).
 *
 * The dialog and the command share this pure plan: the preview is computed from it and
 * the apply writes exactly the same axes and cell memberships. Two modes settle ADR-196
 * H4: keep everything in the first cell (today's behaviour, the default) or split the
 * material into two columns by its current left-to-right order.
 */
export type SectionTableMode = "first" | "position";

export interface SectionTableTitles {
  column1: string;
  column2: string;
  row1: string;
}

export interface SectionTablePlan {
  layout: TableLayout;
  cells: Array<{ id: string; cell: CellPlacement }>;
}

export function planSectionTable(
  frame: Widget,
  widgets: readonly Widget[],
  mode: SectionTableMode,
  titles: SectionTableTitles,
): SectionTablePlan {
  const column1: TableAxis = { id: newId("col"), title: titles.column1 };
  const column2: TableAxis = { id: newId("col"), title: titles.column2 };
  const row1: TableAxis = { id: newId("row"), title: titles.row1 };
  const layout: TableLayout = {
    kind: "table",
    columns: [column1, column2],
    rows: [row1],
  };
  const children = widgets.filter(
    (widget) => widget.parentId === frame.id && widget.id !== frame.id,
  );
  const ordered =
    mode === "position"
      ? [...children].sort((left, right) => left.x - right.x)
      : children;
  const split = mode === "position" ? Math.ceil(ordered.length / 2) : ordered.length;
  const cells = ordered.map((widget, index) => ({
    id: widget.id,
    cell: {
      rowId: row1.id,
      columnId: index < split ? column1.id : column2.id,
    },
  }));
  return { layout, cells };
}

/** Write the plan as one transaction; the board's settling step lays the objects out. */
export function applySectionTablePlan(
  board: BoardDocument,
  frameId: string,
  plan: SectionTablePlan,
): boolean {
  const frame = board.readWidget(frameId);
  if (!frame || frame.type !== "frame" || frame.locked) return false;
  if (frame.layout?.kind === "table" && frame.layout.active !== false) return false;
  board.transact(() => {
    const current = board.readWidget(frameId);
    if (!current) return;
    board.widgets.set(frameId, { ...current, layout: plan.layout });
    for (const entry of plan.cells) {
      const widget = board.readWidget(entry.id);
      if (!widget) continue;
      board.widgets.set(entry.id, { ...widget, parentId: frameId, cell: entry.cell });
    }
  });
  return true;
}
