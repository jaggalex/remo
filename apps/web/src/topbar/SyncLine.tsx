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
 * The word carries the meaning — "Saved", "Offline · 3 changes", "Read only" — and the
 * "?" is an icon button, not a blue underlined link.
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
        <SyncStatus state={syncState(saveState)} label={label} hint={title} />
      </span>
      <HelpLink topicId="sync.status" label={t("help.sync")} className="help-link icon-link" />
    </div>
  );
}
