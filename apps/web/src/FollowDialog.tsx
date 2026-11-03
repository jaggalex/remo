import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";

/**
 * Who is following me, and what I may do about it (ADR-076).
 *
 * The follower count is public on purpose; hiding it is a policy, hiding the *fact* of
 * following from the followed person is not. Follow itself is ephemeral: closing the tab
 * ends it and nothing here is written to the board.
 */
export function FollowDialog({
  open,
  followers,
  peers,
  allowBringEveryone,
  canFacilitate,
  onStopFollowers,
  onBringEveryone,
  onToggleAuto,
  onClose,
}: {
  open: boolean;
  /** Names of the people currently mirroring this person. */
  followers: string[];
  /** How many other people are in the room; a request needs somebody to ask. */
  peers: number;
  allowBringEveryone: boolean;
  canFacilitate: boolean;
  onStopFollowers: () => void;
  onBringEveryone: () => void;
  onToggleAuto: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const { t, count } = useI18n();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="share-dialog follow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("follow.title")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="share-head">
          <div>
            <h2>
              {t("follow.title")} <HelpLink topicId="facilitation.follow" />
            </h2>
            <p className="muted">{t("follow.body")}</p>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label={t("follow.close")}
          >
            ×
          </button>
        </header>

        <p className="follow-count">{count("followers", followers.length)}</p>
        {followers.length ? (
          <ul className="follow-names">
            {followers.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("follow.none")}</p>
        )}

        <div className="follow-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={followers.length === 0}
            onClick={onStopFollowers}
          >
            {t("follow.stopFollowers")}
          </button>
          <button
            type="button"
            className="share-button"
            disabled={peers === 0}
            onClick={onBringEveryone}
          >
            {t("follow.bringEveryone")}
          </button>
        </div>

        {canFacilitate && (
          <label className="follow-auto">
            <input
              type="checkbox"
              checked={allowBringEveryone}
              onChange={(event) => onToggleAuto(event.target.checked)}
            />
            <span>
              {t("follow.auto")}
              <span className="muted"> — {t("follow.autoHint")}</span>
            </span>
          </label>
        )}
      </section>
    </div>
  );
}
