import { useId } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * The manual copy fallback (ADR-118).
 *
 * Some browsers refuse the clipboard without a direct gesture, and a `window.prompt`
 * cannot be styled, translated or even guaranteed to appear. The link is shown in a
 * normal field, preselected, with the same "copy" action that failed before.
 */
export function ShareLinkDialog({
  link,
  onClose,
}: {
  link: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  if (!link) return null;
  return (
    <Dialog
      title={t("board.shareFallbackTitle")}
      description={t("board.shareFallbackBody")}
      size="sm"
      onClose={onClose}
    >
      <div className="dialog-stack">
        <Input
          id={fieldId}
          aria-label={t("board.shareFallbackTitle")}
          readOnly
          autoFocus
          value={link}
          onFocus={(event) => event.target.select()}
        />
        <div className="auth-actions">
          <Button onClick={onClose}>{t("delete.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              (document.getElementById(fieldId) as HTMLInputElement | null)?.select();
              void navigator.clipboard?.writeText(link).catch(() => {});
            }}
          >
            {t("board.copyAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
