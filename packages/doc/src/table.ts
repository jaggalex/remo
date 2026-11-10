import {
  newId,
  type CellPlacement,
  type TableAppearance,
  type TableAxis,
  type TableAxisSize,
  type TableLayout,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { deleteWidgets } from "./widgets";

/**
 * Table commands for a section (ADR-196, ADR-199).
 *
 * Every operation is one transaction and one undo. Axis ids are stable; order and titles
 * are not identity. Objects keep their world coordinates; `cell` is membership, and the
 * painter derives the cell box. The commands never invent a second coordinate system.
 */

export type TableAxisKind = "column" | "row";

export interface AddAxisOptions {
  /** Localized placeholder for the new axis. */
  title: string;
  /** Localized placeholder for the content axis created with the first one. */
  firstTitle?: string;
  /** Localized placeholder for the opposite axis when the first one creates it. */
  oppositeTitle?: string;
  beforeId?: string;
  afterId?: string;
}

export interface MoveToCellOptions {
  rowId: string;
  columnId: string;
}

export type DeleteAxisResult =
  | { ok: true; axisId: string; movedTo?: string; deleted: string[]; tableRemoved?: boolean }
  | { ok: false; reason: "missing" | "objects" | "no-neighbor" };

export type TableFillTarget =
  | { kind: "table" }
  | { kind: "headers" }
  | { kind: "column"; id: string }
  | { kind: "row"; id: string }
  | { kind: "cell"; rowId: string; columnId: string };

function frameFor(board: BoardDocument, frameId: string): Widget | null {
  const frame = board.readWidget(frameId);
  return frame?.type === "frame" ? frame : null;
}

/** The layout of a section, or null when it is free. */
export function tableLayoutOf(board: BoardDocument, frameId: string): TableLayout | null {
  const frame = frameFor(board, frameId);
  return frame?.layout?.kind === "table" ? frame.layout : null;
}

function axesOf(layout: TableLayout, kind: TableAxisKind): TableAxis[] {
  return kind === "column" ? layout.columns : layout.rows;
}

function withAxes(
  layout: TableLayout,
  kind: TableAxisKind,
  axes: TableAxis[],
): TableLayout {
  return kind === "column" ? { ...layout, columns: axes } : { ...layout, rows: axes };
}

function writeLayout(board: BoardDocument, frame: Widget, layout: TableLayout): void {
  board.widgets.set(frame.id, { ...frame, layout });
}

function emptyLayout(): TableLayout {
  return { kind: "table", columns: [], rows: [] };
}

function childrenOf(board: BoardDocument, frameId: string): Widget[] {
  return board.readWidgets().filter((widget) => widget.parentId === frameId);
}

function axisTitle(title: string, count: number): string {
  return title || String(count);
}

function insertIndex(
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

/**
 * Add a column or a row, at the end or between neighbours (ADR-195-style insertion).
 *
 * The first axis also creates the opposite axis and puts the section's existing children
 * in the first cell; their text, ids and links are untouched. Later axes are empty.
 */
export function addAxis(
  board: BoardDocument,
  frameId: string,
  kind: TableAxisKind,
  options: AddAxisOptions,
): string | null {
  const frame = frameFor(board, frameId);
  if (!frame) return null;
  const base = frame.layout?.kind === "table" ? frame.layout : emptyLayout();
  const oppositeKind: TableAxisKind = kind === "column" ? "row" : "column";
  const existing = axesOf(base, kind);
  const opposite = axesOf(base, oppositeKind);

  // The first axis creates the content axis beside it: old material keeps the first
  // cell and the new axis is empty (ADR-196).
  if (!existing.length) {
    const content: TableAxis = {
      id: newId(kind === "column" ? "col" : "row"),
      title: axisTitle(options.firstTitle ?? options.title, 1),
    };
    const axis: TableAxis = {
      id: newId(kind === "column" ? "col" : "row"),
      title: axisTitle(options.title, 2),
    };
    const other: TableAxis = {
      id: newId(oppositeKind === "column" ? "col" : "row"),
      title: axisTitle(options.oppositeTitle ?? "", 1),
    };
    const next = withAxes(
      withAxes(base, kind, [content, axis]),
      oppositeKind,
      [...opposite, other],
    );
    const rowId = kind === "row" ? content.id : other.id;
    const columnId = kind === "column" ? content.id : other.id;
    board.transact(() => {
      writeLayout(board, frame, next);
      for (const child of childrenOf(board, frame.id)) {
        if (child.cell) continue;
        board.widgets.set(child.id, { ...child, cell: { rowId, columnId } });
      }
    });
    return axis.id;
  }

  const axis: TableAxis = {
    id: newId(kind === "column" ? "col" : "row"),
    title: axisTitle(options.title, existing.length + 1),
  };
  const axes = [...existing];
  axes.splice(insertIndex(axes, options), 0, axis);
  const next = withAxes(base, kind, axes);
  board.transact(() => writeLayout(board, frame, next));
  return axis.id;
}

/** Rename one axis; Enter commits, Escape cancels in the UI. */
export function renameAxis(
  board: BoardDocument,
  frameId: string,
  axisId: string,
  title: string,
): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  for (const kind of ["column", "row"] as const) {
    const axes = axesOf(frame.layout, kind);
    if (!axes.some((axis) => axis.id === axisId)) continue;
    const next = axes.map((axis) =>
      axis.id === axisId ? { ...axis, title: title.trim() } : axis,
    );
    board.transact(() => writeLayout(board, frame, withAxes(frame.layout!, kind, next)));
    return true;
  }
  return false;
}

/** Set the manual size preset; `auto` removes the override. */
export function setAxisSize(
  board: BoardDocument,
  frameId: string,
  axisId: string,
  size: TableAxisSize,
): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  for (const kind of ["column", "row"] as const) {
    const axes = axesOf(frame.layout, kind);
    if (!axes.some((axis) => axis.id === axisId)) continue;
    const next = axes.map((axis) => {
      if (axis.id !== axisId) return axis;
      if (size === "auto") {
        const { size: _size, ...rest } = axis;
        return rest;
      }
      return { ...axis, size };
    });
    board.transact(() => writeLayout(board, frame, withAxes(frame.layout!, kind, next)));
    return true;
  }
  return false;
}

/** A column header can be vertical; row headers stay horizontal (ADR-196). */
export function setAxisVertical(
  board: BoardDocument,
  frameId: string,
  axisId: string,
  vertical: boolean,
): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  if (!frame.layout.columns.some((axis) => axis.id === axisId)) return false;
  const next = frame.layout.columns.map((axis) => {
    if (axis.id !== axisId) return axis;
    if (!vertical) {
      const { vertical: _vertical, ...rest } = axis;
      return rest;
    }
    return { ...axis, vertical };
  });
  board.transact(() =>
    writeLayout(board, frame, { ...frame.layout!, columns: next }),
  );
  return true;
}

/** Move an axis one place left/right (up/down). Cells keep their axis ids. */
export function moveAxis(
  board: BoardDocument,
  frameId: string,
  axisId: string,
  offset: -1 | 1,
): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  for (const kind of ["column", "row"] as const) {
    const axes = axesOf(frame.layout, kind);
    const index = axes.findIndex((axis) => axis.id === axisId);
    if (index < 0) continue;
    const target = index + offset;
    if (target < 0 || target >= axes.length) return false;
    const next = [...axes];
    [next[index], next[target]] = [next[target]!, next[index]!];
    board.transact(() => writeLayout(board, frame, withAxes(frame.layout!, kind, next)));
    return true;
  }
  return false;
}

/**
 * Delete an axis. Objects in it move to a neighbour by default (ADR-196); deleting them
 * with the axis is the second, explicit mode. An edge axis offers only its existing side.
 */
export function deleteAxis(
  board: BoardDocument,
  frameId: string,
  axisId: string,
  options:
    | { mode: "move"; toAxisId?: string }
    | { mode: "withObjects" },
): DeleteAxisResult {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") {
    return { ok: false, reason: "missing" };
  }
  const kind: TableAxisKind = frame.layout.columns.some((axis) => axis.id === axisId)
    ? "column"
    : "row";
  const axes = axesOf(frame.layout, kind);
  const index = axes.findIndex((axis) => axis.id === axisId);
  if (index < 0) return { ok: false, reason: "missing" };

  const field = kind === "column" ? "columnId" : "rowId";
  const objects = childrenOf(board, frame.id).filter(
    (child) => child.cell?.[field] === axisId,
  );

  if (objects.length && options.mode === "move") {
    const targetId =
      options.toAxisId ??
      axes[index - 1]?.id ??
      axes[index + 1]?.id;
    if (!targetId || !axes.some((axis) => axis.id === targetId)) {
      return { ok: false, reason: "no-neighbor" };
    }
    const nextAxes = axes.filter((axis) => axis.id !== axisId);
    const next = withAxes(frame.layout, kind, nextAxes);
    board.transact(() => {
      for (const child of objects) {
        const cell = child.cell;
        if (!cell) continue;
        board.widgets.set(child.id, {
          ...child,
          cell: { ...cell, [field]: targetId } as CellPlacement,
        });
      }
      if (!next.columns.length || !next.rows.length) {
        for (const child of childrenOf(board, frame.id)) {
          const { cell: _cell, ...rest } = child;
          board.widgets.set(child.id, rest);
        }
        const { layout: _layout, ...rest } = frame;
        board.widgets.set(frame.id, rest);
      } else {
        writeLayout(board, frame, next);
      }
    });
    return {
      ok: true,
      axisId,
      movedTo: targetId,
      deleted: [],
      tableRemoved: !next.columns.length || !next.rows.length || undefined,
    };
  }

  if (objects.length && options.mode === "withObjects") {
    const next = withAxes(frame.layout, kind, axes.filter((axis) => axis.id !== axisId));
    board.transact(() => {
      deleteWidgets(board, objects.map((child) => child.id));
      if (!next.columns.length || !next.rows.length) {
        const { layout: _layout, ...rest } = frame;
        board.widgets.set(frame.id, rest);
      } else {
        writeLayout(board, frame, next);
      }
    });
    return { ok: true, axisId, deleted: objects.map((child) => child.id) };
  }

  if (objects.length) return { ok: false, reason: "objects" };

  const next = withAxes(frame.layout, kind, axes.filter((axis) => axis.id !== axisId));
  board.transact(() => {
    if (!next.columns.length || !next.rows.length) {
      const { layout: _layout, ...rest } = frame;
      board.widgets.set(frame.id, rest);
    } else {
      writeLayout(board, frame, next);
    }
  });
  return { ok: true, axisId, deleted: [] };
}

/** Move a selection into one cell; membership is one transaction. */
export function moveSelectionToCell(
  board: BoardDocument,
  frameId: string,
  ids: readonly string[],
  options: MoveToCellOptions,
): { moved: string[]; blocked: string[] } {
  const frame = frameFor(board, frameId);
  const moved: string[] = [];
  const blocked: string[] = [];
  if (!frame?.layout || frame.layout.kind !== "table") return { moved, blocked };
  const row = frame.layout.rows.find((axis) => axis.id === options.rowId);
  const column = frame.layout.columns.find((axis) => axis.id === options.columnId);
  if (!row || !column) return { moved, blocked };

  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || widget.type === "frame" || widget.type === "connector" || widget.type === "card") {
        blocked.push(id);
        continue;
      }
      if (widget.locked) {
        blocked.push(id);
        continue;
      }
      board.widgets.set(id, {
        ...widget,
        parentId: frame.id,
        cell: { rowId: options.rowId, columnId: options.columnId },
      });
      moved.push(id);
    }
  });
  return { moved, blocked };
}

/** Remove the table view but keep the axes, cells and free positions (ADR-196). */
export function removeTable(board: BoardDocument, frameId: string): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  board.transact(() => writeLayout(board, frame, { ...frame.layout!, active: false }));
  return true;
}

/** Turn the kept table back on after `removeTable`. */
export function showTable(board: BoardDocument, frameId: string): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  board.transact(() => {
    const { active: _active, ...layout } = frame.layout!;
    writeLayout(board, frame, layout);
  });
  return true;
}

/** Set or clear one named fill; the most specific wins (ADR-199). */
export function setTableFill(
  board: BoardDocument,
  frameId: string,
  target: TableFillTarget,
  color: string | null,
): boolean {
  const frame = frameFor(board, frameId);
  if (!frame?.layout || frame.layout.kind !== "table") return false;
  if (target.kind === "column" && !frame.layout.columns.some((axis) => axis.id === target.id)) {
    return false;
  }
  if (target.kind === "row" && !frame.layout.rows.some((axis) => axis.id === target.id)) {
    return false;
  }
  if (
    target.kind === "cell" &&
    (!frame.layout.rows.some((axis) => axis.id === target.rowId) ||
      !frame.layout.columns.some((axis) => axis.id === target.columnId))
  ) {
    return false;
  }

  const appearance: TableAppearance = { ...(frame.layout.appearance ?? {}) };
  const setKey = (record: Record<string, string> | undefined, key: string) => {
    const next = { ...(record ?? {}) };
    if (color) next[key] = color;
    else delete next[key];
    return next;
  };

  if (target.kind === "table" || target.kind === "headers") {
    if (color) appearance[target.kind] = color;
    else delete appearance[target.kind];
  } else if (target.kind === "column") {
    const next = setKey(appearance.columns, target.id);
    if (Object.keys(next).length) appearance.columns = next;
    else delete appearance.columns;
  } else if (target.kind === "row") {
    const next = setKey(appearance.rows, target.id);
    if (Object.keys(next).length) appearance.rows = next;
    else delete appearance.rows;
  } else {
    const next = setKey(appearance.cells, `${target.rowId}:${target.columnId}`);
    if (Object.keys(next).length) appearance.cells = next;
    else delete appearance.cells;
  }

  board.transact(() =>
    writeLayout(board, frame, {
      ...frame.layout!,
      ...(Object.keys(appearance).length ? { appearance } : { appearance: undefined }),
    }),
  );
  return true;
}
