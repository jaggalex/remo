import type { BoardDocument } from "./board";
import type { TableAxis, TableLayout, Widget } from "@remo/model";

/**
 * Small document helpers shared by the table commands and the merged-block module.
 *
 * They stay out of the public command surface: only `@remo/doc` internals import them,
 * so a caller cannot reach a widget map through a helper by accident.
 */

export type TableAxisKind = "column" | "row";

export function frameFor(board: BoardDocument, frameId: string): Widget | null {
  const frame = board.readWidget(frameId);
  return frame?.type === "frame" ? frame : null;
}

/** A section accepts table edits unless it is locked (ADR-040). */
export function editableFrame(board: BoardDocument, frameId: string): Widget | null {
  const frame = frameFor(board, frameId);
  return frame && !frame.locked ? frame : null;
}

export function axesOf(layout: TableLayout, kind: TableAxisKind): TableAxis[] {
  return kind === "column" ? layout.columns : layout.rows;
}

export function withAxes(
  layout: TableLayout,
  kind: TableAxisKind,
  axes: TableAxis[],
): TableLayout {
  return kind === "column" ? { ...layout, columns: axes } : { ...layout, rows: axes };
}

export function writeLayout(board: BoardDocument, frame: Widget, layout: TableLayout): void {
  board.widgets.set(frame.id, { ...frame, layout });
}

export function emptyLayout(): TableLayout {
  return { kind: "table", columns: [], rows: [] };
}

export function childrenOf(board: BoardDocument, frameId: string): Widget[] {
  return board.readWidgets().filter((widget) => widget.parentId === frameId);
}

export function axisTitle(title: string, count: number): string {
  return title || String(count);
}

export function insertIndex(
  axes: TableAxis[],
  options: { beforeId?: string; afterId?: string },
): number {
  if (options.beforeId) {
    const index = axes.findIndex((axis) => axis.id === options.beforeId);
    if (index >= 0) return index;
  }
  if (options.afterId) {
    const index = axes.findIndex((axis) => axis.id === options.afterId);
    if (index >= 0) return index + 1;
  }
  return axes.length;
}
