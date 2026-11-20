import { Button, IconButton } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * "Storage is full": the notice above the canvas when an upload is refused by a quota
 * (ADR-249 §7, `spec/images.md` §9.4).
 *
 * It says the reason the server gave and offers the one action that can change it. The
 * text comes from the caller because two reasons share this shape — the organisation's
 * bytes and the room's image count — and each has its own sentence (§9.3).
 */
export function QuotaNotice({
  title,
  text,
  onSeePlans,
  onDismiss,
}: {
  /** The reason, in the words of the upload row (`image.error.quota`, `…roomImages`). */
  title: string;
  /** What it means for the next upload, one sentence. */
  text: string;
  /** Opens the organisation's plan tab; absent when there is nowhere to go. */
  onSeePlans?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="quota-notice" role="status">
      <div className="quota-notice-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <div className="quota-notice-actions">
        {onSeePlans && (
          <Button size="compact" variant="primary" onClick={onSeePlans}>
            {t("billing.seePlans")}
          </Button>
        )}
        {onDismiss && (
          <IconButton
            icon="close"
            size="compact"
            label={t("billing.dismiss")}
            onClick={onDismiss}
          />
        )}
      </div>
    </div>
  );
}
