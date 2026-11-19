import { tableReflow, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Keep every table section equal to its table (ADR-201).
 *
 * Runs at the end of each local transaction, inside it, so whatever changed a table —
 * an axis command, a drop into a cell, a note that grew while typing, a delete — the
 * section box and the cell positions settle in the same undo step. It is one mechanism
 * for all of them: no command has to remember to call it.
 *
 * Only changes are written; a settled table writes nothing, so a remote peer's edit
 * never echoes back. The reflow is a pure function of the document, so two peers that
 * reflow the same state agree.
 */
export function settleTables(board: BoardDocument, changedIds: Iterable<string>): void {
  const touched = new Set<string>();
  for (const id of changedIds) {
    const widget = board.readWidget(id);
    if (!widget) {
      // A deleted member: its section may need to shrink. Cheap to find from the frames.
      for (const frame of board.readWidgets()) {
        if (frame.type === "frame" && frame.layout?.kind === "table") touched.add(frame.id);
      }
      break;
    }
    if (widget.type === "frame" && widget.layout?.kind === "table") touched.add(widget.id);
    if (widget.cell) dropStaleCell(board, widget);
    if (widget.parentId) touched.add(widget.parentId);
  }
  if (!touched.size) return;
  for (const frameId of touched) reflowTable(board, frameId);
}

/** A cell that no longer names an axis of the object's own section is forgotten. */
function dropStaleCell(board: BoardDocument, widget: Widget): void {
  const parent = widget.parentId ? board.readWidget(widget.parentId) : null;
  const layout = parent?.layout?.kind === "table" ? parent.layout : null;
  const valid =
    layout &&
    layout.rows.some((axis) => axis.id === widget.cell!.rowId) &&
    layout.columns.some((axis) => axis.id === widget.cell!.columnId);
  if (valid) return;
  const { cell: _cell, ...rest } = widget;
  board.widgets.set(widget.id, rest);
}

/** Put one section's objects in their cells and size the section to the table. */
export function reflowTable(board: BoardDocument, frameId: string): boolean {
  const frame = board.readWidget(frameId);
  if (!frame || frame.type !== "frame") return false;
  const widgets = board.readWidgets();
  const result = tableReflow(frame, widgets);
  if (!result) return false;
  let changed = false;
  for (const move of result.moves) {
    const widget = board.readWidget(move.id);
    if (!widget) continue;
    board.widgets.set(move.id, { ...widget, x: move.x, y: move.y });
    changed = true;
  }
  const next = {
    x: result.frame.x + result.frame.width / 2,
    y: result.frame.y + result.frame.height / 2,
    width: result.frame.width,
    height: result.frame.height,
  };
  if (
    next.x !== frame.x ||
    next.y !== frame.y ||
    next.width !== frame.width ||
    next.height !== frame.height
  ) {
    board.widgets.set(frame.id, { ...frame, ...next });
    changed = true;
  }
  return changed;
}
