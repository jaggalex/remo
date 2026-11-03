import { deleteWidgets, deletionSummary, type BoardDocument } from "@remo/doc";
import { useI18n } from "./i18n";

/**
 * Confirmation before a delete that can take connectors with it.
 *
 * A delete is not atomic for the person: the object and every line attached to it
 * disappear, and undo is the only way back. The dialog names both counts, so "why did
 * my diagram lose three lines?" is answered before it happens (ADR-077).
 */
export function DeleteDialog({
  objects,
  connectors,
  onCancel,
  onConfirm,
}: {
  objects: number;
  connectors: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, count } = useI18n();
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="auth-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="share-head">
          <div>
            <h2 id="delete-title">{t("delete.title")}</h2>
          </div>
          <button type="button" className="dialog-close" aria-label={t("delete.cancel")} onClick={onCancel}>✕</button>
        </div>
        <p>
          {objects === 0 && connectors > 0
            ? t("delete.bodyConnectors", { connectors: count("connectors", connectors) })
            : connectors > 0
              ? t("delete.bodyWithConnectors", {
                  objects: count("objects", objects),
                  connectors: count("connectors", connectors),
                })
              : t("delete.bodyObjects", { objects: count("objects", objects) })}
        </p>
        <div className="auth-actions">
          <button type="button" onClick={onCancel}>{t("delete.cancel")}</button>
          <button type="button" className="primary-button danger" onClick={onConfirm} autoFocus>
            {t("delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The confirm-before-delete step, with the counts and the write in one place.
 *
 * App only says which objects are pending; the dialog counts what would disappear, and on
 * confirmation performs the delete through the document's own function. Keeping both here
 * means the summary can never drift from the deletion it describes.
 */
export function DeleteConfirmation({
  board,
  ids,
  onCancel,
  onDeleted,
}: {
  board: BoardDocument;
  ids: readonly string[];
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const summary = deletionSummary(board, [...ids]);
  return (
    <DeleteDialog
      objects={summary.objects}
      connectors={summary.connectors}
      onCancel={onCancel}
      onConfirm={() => {
        deleteWidgets(board, [...ids]);
        onDeleted();
      }}
    />
  );
}
