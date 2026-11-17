import { ReadOnlyBadge, SyncStatus } from "@remo/ui";
import type { SyncState } from "@remo/ui";
import type { SaveState } from "@remo/doc";
import { useI18n } from "../i18n";
import { HelpLink } from "../help/HelpLink";

/** The save state as a token state, never as a guess (ADR-084). */
function syncState(save: SaveState): SyncState {
  if (save.state === "saved") return "saved";
  if (save.state === "offline") return "offline";
  if (save.state === "pending") return "pending";
  return "connecting";
}

/**
 * Saving, and the help article about it (ADR-119, Ш4).
 *
 * Saved and saving are an icon with the word in the tooltip; offline and stopped input
 * keep the word on screen (ADR-232). The "?" is an icon button, not a blue link.
 */
export function SyncLine({
  saveState,
  label,
  title,
  readOnly,
}: {
  saveState: SaveState;
  label: string;
  title: string;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="topbar-sync">
      {readOnly && <ReadOnlyBadge />}
      <span
        className={`save-state ${saveState.state}${saveState.blocked ? " blocked" : ""}`}
        data-state={saveState.state}
        data-pending={saveState.pending}
      >
        <SyncStatus
          state={syncState(saveState)}
          label={label}
          hint={title}
          quiet
          alert={saveState.blocked}
        />
      </span>
      <HelpLink topicId="sync.status" label={t("help.sync")} className="help-link icon-link" />
    </div>
  );
}
