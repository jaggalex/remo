import { useEffect, useMemo, useState } from "react";
import { kanbanTitles, type Camera, type KanbanLayout } from "@remo/canvas";
import { renameColumn, renameSwimlane, type BoardDocument } from "@remo/doc";
import { useI18n } from "./i18n";
import { closeKanbanTitleEdit, useKanbanTitleEdit } from "./kanbanTitleEditStore";

/** Text width in a CSS font, for the title boxes; one offscreen context for the app. */
let measuring: CanvasRenderingContext2D | null = null;
export function measureText(text: string, font: string): number {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (!measuring) return text.length * 10;
  measuring.font = font;
  return measuring.measureText(text).width;
}

/**
 * The field over a kanban title being renamed (ADR-244): the same field for a double
 * click and for the menu's «Переименовать». Enter or leaving commits, Escape cancels, an
 * empty title is refused. It looks like the table header's editor, its sibling.
 */
export function KanbanTitleEditor({
  board,
  layouts,
  camera,
  viewport,
  fontFamily,
}: {
  board: BoardDocument;
  layouts: Map<string, KanbanLayout>;
  camera: Camera;
  viewport: { width: number; height: number };
  fontFamily: string;
}) {
  const { t } = useI18n();
  const edit = useKanbanTitleEdit();
  const target = useMemo(() => {
    if (!edit) return null;
    const layout = layouts.get(edit.kanbanId);
    if (!layout) return null;
    return kanbanTitles(layout, measureText, fontFamily).find(
      (entry) => entry.kind === edit.kind && entry.id === edit.id,
    ) ?? null;
  }, [edit, layouts, fontFamily]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(target?.title ?? "");
    // Only a new target resets the draft; a rerender of the same one keeps the typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.kanbanId, edit?.kind, edit?.id]);

  // A title that is gone (its column deleted by someone else) closes the field.
  useEffect(() => {
    if (edit && !target) closeKanbanTitleEdit();
  }, [edit, target]);

  if (!edit || !target) return null;

  const finish = (commit: boolean) => {
    const value = draft.trim();
    if (commit && value && value !== target.title) {
      if (edit.kind === "column") renameColumn(board, edit.kanbanId, edit.id, value);
      else renameSwimlane(board, edit.kanbanId, edit.id, value);
    }
    closeKanbanTitleEdit();
  };

  const { box } = target;
  const left = (box.x - camera.x) * camera.zoom + viewport.width / 2;
  const top = (box.y - camera.y) * camera.zoom + viewport.height / 2;
  const width = Math.max(box.width * camera.zoom, 168);
  const height = 32;
  return (
    <input
      className="table-header-editor kanban-title-editor"
      style={{ left, top: top + (box.height * camera.zoom) / 2 - height / 2, width, height }}
      autoFocus
      value={draft}
      maxLength={80}
      aria-label={edit.kind === "column" ? t("menu.renameColumn") : t("menu.renameSwimlane")}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        // The canvas must not see these keys: Escape would clear the selection, Delete
        // would delete it.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}
