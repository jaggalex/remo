import { useEffect, useState } from "react";
import { mergeCells, splitCell, type BoardDocument } from "@remo/doc";
import { cellRect, layoutTable, tableCellAt, type Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { Button } from "@remo/ui";
import { useI18n } from "./i18n";
import { mergeFailureText } from "./tableActions";
import {
  clearTableCellSelection,
  tableCellRangeIds,
  useTableCellSelection,
} from "./tableCellSelection";

/**
 * The selected table cell or range, drawn over the canvas (ADR-204).
 *
 * The canvas paints the grid; this layer draws the transient selection and the one
 * action a range has — merge or split. Nothing here is a document field: a click on the
 * grid sets the store, and the layer reads it, so the painter stays a pure function of
 * the board.
 */
export function TableSelectionLayer({
  board,
  widgets,
  camera,
  viewport,
  selectedIds,
  readOnly,
  presenting,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  selectedIds: readonly string[];
  readOnly: boolean;
  presenting: boolean;
}) {
  const { t } = useI18n();
  const selection = useTableCellSelection();
  const [notice, setNotice] = useState<string | null>(null);
  const frame = selection
    ? widgets.find((widget) => widget.id === selection.frameId)
    : undefined;
  const grid = frame ? layoutTable(frame, widgets) : null;

  useEffect(() => {
    if (!selection) return;
    if (!selectedIds.includes(selection.frameId)) {
      clearTableCellSelection();
      return;
    }
    if (!frame || frame.layout?.kind !== "table" || frame.layout.active === false) {
      clearTableCellSelection();
    }
  }, [selection, selectedIds, frame]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (presenting || !selection || !grid || !frame?.layout) return null;

  const range = tableCellRangeIds(frame.layout, selection.anchor, selection.focus);
  const seen = new Set<string>();
  const cells = [];
  for (const ref of range) {
    const rect = cellRect(grid, ref.rowId, ref.columnId);
    if (!rect) continue;
    const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(rect);
  }
  if (!cells.length) return null;

  const toScreen = (rect: { x: number; y: number; width: number; height: number }) => ({
    left: (rect.x - camera.x) * camera.zoom + viewport.width / 2,
    top: (rect.y - camera.y) * camera.zoom + viewport.height / 2,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  });

  const anchorCell = tableCellAt(grid, selection.anchor.rowId, selection.anchor.columnId);
  const merged = Boolean(anchorCell && (anchorCell.rowSpan > 1 || anchorCell.columnSpan > 1));
  const screen = cells.map(toScreen);
  const left = Math.min(...screen.map((rect) => rect.left));
  const top = Math.min(...screen.map((rect) => rect.top));
  const right = Math.max(...screen.map((rect) => rect.left + rect.width));

  const columnTitle =
    frame.layout.columns.find((axis) => axis.id === selection.anchor.columnId)?.title ||
    t("section.axis.untitled");
  const rowTitle =
    frame.layout.rows.find((axis) => axis.id === selection.anchor.rowId)?.title ||
    t("section.axis.untitled");

  const merge = () => {
    const result = mergeCells(board, frame.id, range);
    if (result.ok) {
      clearTableCellSelection();
      return;
    }
    setNotice(mergeFailureText(t, result.reason));
  };

  const split = () => {
    if (!splitCell(board, frame.id, selection.anchor.rowId, selection.anchor.columnId)) {
      setNotice(t("section.locked"));
    }
  };

  return (
    <>
      <div className="table-cell-selection" aria-hidden="true">
        {screen.map((rect) => (
          <div
            key={`${rect.left}:${rect.top}`}
            className="table-cell-box"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          />
        ))}
      </div>
      <p className="table-range-live" role="status" aria-live="polite">
        {t("section.cell.selected", { column: columnTitle, row: rowTitle })}
      </p>
      {!readOnly && (merged || range.length > 1) && (
        <div
          className="table-range-bar"
          style={{ left: (left + right) / 2, top: top - 8 }}
          role="toolbar"
          aria-label={t("section.cell.range")}
        >
          {merged ? (
            <Button size="compact" variant="secondary" onClick={split}>
              {t("section.cell.split")}
            </Button>
          ) : (
            <Button size="compact" variant="secondary" onClick={merge}>
              {t("section.cell.merge")}
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p className="table-range-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </>
  );
}
