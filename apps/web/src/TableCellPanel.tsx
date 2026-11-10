import { useEffect, useMemo, useState } from "react";
import type { BoardDocument } from "@remo/doc";
import { GATHERABLE_TYPES, moveSelectionToCell } from "@remo/doc";
import { layoutTable, tableCellPlacement } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { Button, Select } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * “Move to cell…” for a selection that already lives in a section table (ADR-196).
 *
 * A keyboard and menu path to the same command the drag drop uses: the target cell is
 * chosen by name, the selection keeps its arrangement and the whole move is one undo.
 */
export function TableCellPanel({
  board,
  widgets,
  selectedIds,
  writeBlocked,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: string[];
  writeBlocked: boolean;
}) {
  const { t } = useI18n();
  const selected = selectedIds
    .map((id) => widgets.find((widget) => widget.id === id))
    .filter((widget): widget is Widget => Boolean(widget));
  const parentId = selected[0]?.parentId ?? null;
  const frame = parentId
    ? widgets.find((widget) => widget.id === parentId && widget.type === "frame")
    : undefined;
  const layout =
    frame?.layout?.kind === "table" && frame.layout.active !== false
      ? frame.layout
      : null;
  const movable =
    Boolean(frame && layout) &&
    selected.length > 0 &&
    selected.every(
      (widget) =>
        widget.parentId === frame?.id &&
        !widget.locked &&
        GATHERABLE_TYPES.has(widget.type),
    );

  const options = useMemo(() => {
    if (!layout) return [];
    return layout.columns.flatMap((column) =>
      layout.rows.map((row) => ({
        value: `${row.id}:${column.id}`,
        label: `${column.title || t("section.axis.untitled")} × ${
          row.title || t("section.axis.untitled")
        }`,
      })),
    );
  }, [layout, t]);

  const current =
    selected.length > 0 &&
    selected.every(
      (widget) =>
        widget.cell?.rowId === selected[0]!.cell?.rowId &&
        widget.cell?.columnId === selected[0]!.cell?.columnId,
    ) &&
    selected[0]!.cell
      ? `${selected[0]!.cell!.rowId}:${selected[0]!.cell!.columnId}`
      : "";

  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current, frame?.id]);

  if (!frame || !layout || !movable) return null;

  const [rowId, columnId] = value.split(":");
  const alreadyThere = value !== "" && value === current;
  const move = () => {
    if (!rowId || !columnId || alreadyThere) return;
    const grid = layoutTable(frame, widgets);
    const offset = grid
      ? tableCellPlacement(grid, rowId, columnId, widgets, selectedIds)
      : null;
    moveSelectionToCell(board, frame.id, selectedIds, {
      rowId,
      columnId,
      ...(offset ? { offset } : {}),
    });
  };

  return (
    <div className="table-cell-panel">
      <h2>{t("section.cell.moveTo")}</h2>
      <Select
        label={t("section.cell.target")}
        value={value}
        disabled={writeBlocked || Boolean(frame.locked)}
        options={[
          { value: "", label: t("section.cell.choose"), disabled: true },
          ...options,
        ]}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <Button
        size="compact"
        variant="secondary"
        disabled={writeBlocked || Boolean(frame.locked) || !value || alreadyThere}
        onClick={move}
      >
        {t("section.cell.move")}
      </Button>
    </div>
  );
}
