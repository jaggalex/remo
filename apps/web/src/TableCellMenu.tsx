import { useEffect, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import { mergeCells, splitCell } from "@remo/doc";
import { layoutTable, tableCellAt, type Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import type { ContextTarget } from "./canvasTargets";
import { Menu, type MenuItem } from "@remo/ui";
import { useI18n } from "./i18n";
import { duplicateAxisNear, insertAxisNear, mergeFailureText } from "./tableActions";
import {
  clearTableCellSelection,
  tableCellRangeIds,
  tableCellSelection,
  type TableCellSelection,
} from "./tableCellSelection";

/**
 * The cell menu and its keyboard entry (ADR-204).
 *
 * Right-click or Shift+F10 on a selected cell opens the same commands the header menu
 * and the panel call: insert and duplicate an axis, merge or split the range. It lives
 * outside the canvas so the gesture machine stays about objects and cells.
 */
export interface TableCellMenuState {
  point: { x: number; y: number } | null;
  openForTarget: (target: ContextTarget, x: number, y: number) => boolean;
  close: () => void;
}

export function useTableCellMenu(
  widgets: Widget[],
  camera: Camera,
  viewport: { width: number; height: number },
  selectedIds: readonly string[],
): TableCellMenuState {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      const selection = tableCellSelection();
      if (!selection) return;
      const frame = widgets.find((widget) => widget.id === selection.frameId);
      const grid = frame ? layoutTable(frame, widgets) : null;
      const cell = grid
        ? tableCellAt(grid, selection.anchor.rowId, selection.anchor.columnId)
        : null;
      if (!cell) return;
      event.preventDefault();
      setPoint({
        x: (cell.rect.x + cell.rect.width / 2 - camera.x) * camera.zoom + viewport.width / 2,
        y: (cell.rect.y + cell.rect.height / 2 - camera.y) * camera.zoom + viewport.height / 2,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [widgets, camera, viewport]);

  const openForTarget = (target: ContextTarget, x: number, y: number): boolean => {
    const selection = tableCellSelection();
    const table = selection
      ? widgets.find((widget) => widget.id === selection.frameId)
      : undefined;
    const onTable =
      selection &&
      table?.layout?.kind === "table" &&
      selectedIds.length === 1 &&
      selectedIds[0] === table.id &&
      target.kind === "selection" &&
      target.ids.length === 1 &&
      target.ids[0] === table.id;
    if (!onTable) return false;
    setPoint({ x, y });
    return true;
  };

  return { point, openForTarget, close: () => setPoint(null) };
}

export function TableCellMenu({
  board,
  widgets,
  selection,
  point,
  onClose,
  onNotice,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selection: TableCellSelection;
  point: { x: number; y: number };
  onClose: () => void;
  onNotice?: (text: string) => void;
}) {
  const { t } = useI18n();
  const frame = widgets.find((widget) => widget.id === selection.frameId);
  const layout = frame?.layout?.kind === "table" ? frame.layout : null;
  if (!frame || !layout) return null;
  const grid = layoutTable(frame, widgets);
  const range = tableCellRangeIds(layout, selection.anchor, selection.focus);
  const anchorCell = grid
    ? tableCellAt(grid, selection.anchor.rowId, selection.anchor.columnId)
    : null;
  const merged = Boolean(anchorCell && (anchorCell.rowSpan > 1 || anchorCell.columnSpan > 1));
  const rowTitle = t("section.axis.placeholderRow", { n: layout.rows.length + 1 });
  const columnTitle = t("section.axis.placeholderColumn", { n: layout.columns.length + 1 });
  const close = onClose;

  const items: MenuItem[] = [
    {
      label: t("section.axis.insertAbove"),
      onSelect: () => {
        insertAxisNear(board, frame.id, "row", selection.anchor.rowId, "before", rowTitle);
        close();
      },
    },
    {
      label: t("section.axis.insertBelow"),
      onSelect: () => {
        insertAxisNear(board, frame.id, "row", selection.anchor.rowId, "after", rowTitle);
        close();
      },
    },
    {
      label: t("section.axis.insertLeft"),
      onSelect: () => {
        insertAxisNear(
          board,
          frame.id,
          "column",
          selection.anchor.columnId,
          "before",
          columnTitle,
        );
        close();
      },
    },
    {
      label: t("section.axis.insertRight"),
      onSelect: () => {
        insertAxisNear(
          board,
          frame.id,
          "column",
          selection.anchor.columnId,
          "after",
          columnTitle,
        );
        close();
      },
    },
    { separator: true },
    {
      label: t("section.axis.duplicateRow"),
      onSelect: () => {
        duplicateAxisNear(board, frame.id, "row", selection.anchor.rowId, rowTitle);
        close();
      },
    },
    {
      label: t("section.axis.duplicateColumn"),
      onSelect: () => {
        duplicateAxisNear(board, frame.id, "column", selection.anchor.columnId, columnTitle);
        close();
      },
    },
  ];

  if (merged) {
    items.push(
      { separator: true },
      {
        label: t("section.cell.split"),
        onSelect: () => {
          splitCell(board, frame.id, selection.anchor.rowId, selection.anchor.columnId);
          close();
        },
      },
    );
  } else if (range.length > 1) {
    items.push(
      { separator: true },
      {
        label: t("section.cell.merge"),
        onSelect: () => {
          const result = mergeCells(board, frame.id, range);
          if (result.ok) {
            clearTableCellSelection();
          } else {
            onNotice?.(mergeFailureText(t, result.reason));
          }
          close();
        },
      },
    );
  }

  return (
    <div className="table-cell-menu" style={{ left: point.x, top: point.y }}>
      <Menu label={t("section.cell.range")} items={items} onClose={onClose} />
    </div>
  );
}
