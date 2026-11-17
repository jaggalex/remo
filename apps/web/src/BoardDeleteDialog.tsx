import { ConfirmDialog } from "@remo/ui";
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
    <ConfirmDialog
      title={t("boardDelete.title", { title })}
      confirmLabel={t("boardDelete.confirm")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>{t("boardDelete.body", { objects: count("objects", objects) })}</p>
      {linkEnabled && <p className="help-notice">{t("delete.linkConsequence")}</p>}
      <p className="muted">{t("boardDelete.trashNote")}</p>
    </ConfirmDialog>
  );
}
