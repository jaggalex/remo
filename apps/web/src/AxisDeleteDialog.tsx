import type { BoardDocument } from "@remo/doc";
import { deleteAxis, tableLayoutOf } from "@remo/doc";
import type { Widget } from "@remo/model";
import { Button, Dialog } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * The one confirmation for deleting an axis that holds objects (ADR-196).
 *
 * Both entry points use it: the section panel and the axis menu on the canvas. It offers
 * only neighbours that exist and moves by default; deleting the objects is the explicit
 * second choice. One transaction and one undo per action.
 */
export interface AxisDeleteTarget {
  frameId: string;
  axisId: string;
  kind: "column" | "row";
}

export function AxisDeleteDialog({
  board,
  widgets,
  target,
  onClose,
  onDeleted,
}: {
  board: BoardDocument;
  widgets: Widget[];
  target: AxisDeleteTarget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t, count } = useI18n();
  const layout = tableLayoutOf(board, target.frameId);
  const axes = layout
    ? target.kind === "column"
      ? layout.columns
      : layout.rows
    : [];
  const axis = axes.find((entry) => entry.id === target.axisId);
  if (!layout || !axis) return null;

  const index = axes.findIndex((entry) => entry.id === axis.id);
  const before = index > 0 ? axes[index - 1] : undefined;
  const after = index >= 0 && index < axes.length - 1 ? axes[index + 1] : undefined;
  const field = target.kind === "column" ? "columnId" : "rowId";
  const objects = widgets.filter(
    (widget) => widget.parentId === target.frameId && widget.cell?.[field] === axis.id,
  );
  const name = axis.title || t("section.axis.untitled");

  const finish = (mode: "move" | "withObjects", toAxisId?: string) => {
    const result = deleteAxis(
      board,
      target.frameId,
      axis.id,
      mode === "move" ? { mode, toAxisId } : { mode },
    );
    if (!result.ok) return;
    onDeleted();
  };

  return (
    <Dialog
      title={t(
        target.kind === "row" ? "section.axis.deleteRowTitle" : "section.axis.deleteTitle",
        { name },
      )}
      size="sm"
      onClose={onClose}
      footer={
        <div className="axis-delete-actions">
          <Button size="compact" variant="secondary" onClick={onClose}>
            {t("delete.cancel")}
          </Button>
          {before && (
            <Button
              size="compact"
              variant="secondary"
              onClick={() => finish("move", before.id)}
            >
              {t(
                target.kind === "column"
                  ? "section.axis.moveToLeft"
                  : "section.axis.moveToAbove",
                { name: before.title || t("section.axis.untitled") },
              )}
            </Button>
          )}
          {after && (
            <Button
              size="compact"
              variant="secondary"
              onClick={() => finish("move", after.id)}
            >
              {t(
                target.kind === "column"
                  ? "section.axis.moveToRight"
                  : "section.axis.moveToBelow",
                { name: after.title || t("section.axis.untitled") },
              )}
            </Button>
          )}
          <Button size="compact" variant="danger" onClick={() => finish("withObjects")}>
            {t("section.axis.deleteWithObjects", { count: objects.length })}
          </Button>
        </div>
      }
    >
      {t(
        target.kind === "row" ? "section.axis.deleteRowBody" : "section.axis.deleteBody",
        { count: count("objects", objects.length) },
      )}
      <p className="muted">{t("section.axis.undoHint")}</p>
    </Dialog>
  );
}
