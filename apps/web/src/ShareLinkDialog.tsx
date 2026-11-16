import { useRef } from "react";
import { Dialog } from "@remo/ui";
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
  const field = useRef<HTMLInputElement | null>(null);
  if (!link) return null;
  return (
    <Dialog
      title={t("board.shareFallbackTitle")}
      description={t("board.shareFallbackBody")}
      size="sm"
      onClose={onClose}
    >
      <div className="auth-dialog">
        <input
          ref={field}
          className="share-fallback-input"
          readOnly
          autoFocus
          value={link}
          onFocus={(event) => event.target.select()}
        />
        <div className="auth-actions">
          <button type="button" onClick={onClose}>
            {t("delete.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              field.current?.select();
              void navigator.clipboard?.writeText(link).catch(() => {});
            }}
          >
            {t("board.copyAction")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
