import { useI18n } from "./i18n";

/**
 * Board deletion is a trash action, not an object delete (ADR-073).
 *
 * The dialog names both consequences before the click: how many objects leave the
 * directory, and whether a public link is open. The link is switched off in the same
 * transaction, so restoring the board later does not resurrect an old URL.
 */
export function BoardDeleteDialog({
  title,
  objects,
  linkEnabled,
  onCancel,
  onConfirm,
}: {
  title: string;
  objects: number;
  linkEnabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, count } = useI18n();
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="auth-dialog" role="alertdialog" aria-modal="true" aria-labelledby="board-delete-title">
        <div className="share-head">
          <div>
            <h2 id="board-delete-title">{t("boardDelete.title", { title })}</h2>
          </div>
          <button type="button" className="dialog-close" aria-label={t("delete.cancel")} onClick={onCancel}>
            ✕
          </button>
        </div>
        <p>{t("boardDelete.body", { objects: count("objects", objects) })}</p>
        {linkEnabled && <p className="help-notice">{t("delete.linkConsequence")}</p>}
        <p className="muted">{t("boardDelete.trashNote")}</p>
        <div className="auth-actions">
          <button type="button" onClick={onCancel}>
            {t("delete.cancel")}
          </button>
          <button type="button" className="primary-button danger" onClick={onConfirm} autoFocus>
            {t("boardDelete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
