import { useRef } from "react";
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
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("board.shareFallbackTitle")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="share-head">
          <div>
            <h2>{t("board.shareFallbackTitle")}</h2>
            <p className="muted">{t("board.shareFallbackBody")}</p>
          </div>
          <button
            type="button"
            className="dialog-close"
            aria-label={t("delete.cancel")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
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
    </div>
  );
}
