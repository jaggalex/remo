import { useCallback, useEffect, useState } from "react";
import type { TimerPhase, Widget } from "@remo/model";
import { formatRemaining } from "@remo/model";
import type { Access, OrgSummary, SessionUser } from "./api";
import { api } from "./api";
import { billingApi } from "./apiBilling";
import { requestBillingTab } from "./billingNav";
import { currentRoom } from "./identity";
import { roleSourceLine } from "./roleSource";
import { useNow } from "./useNow";
import { useTheme } from "./useTheme";
import { useAccountPreferences } from "./useAccountPreferences";
import type { Lang, TranslationKey } from "./i18n";
import type { VoteController } from "./useVoteSessions";

/**
 * Everything the header owns that is not the board itself (ADR-119).
 *
 * The four menus open panels and dialogs that `App` already had; this hook keeps their
 * state and the three board-level actions (a copy, the trash, signing out) together, so
 * `App` stays a composition and the header stays presentational.
 */
export function useBoardHeader({
  access,
  me,
  setMe,
  orgs,
  boardOrgId,
  vote,
  timerWidget,
  timerPhase,
  timerLeft,
  refreshAccess,
  setAgentOpen,
  showNotice,
  t,
  lang,
  setLang,
}: {
  access: Access | null;
  me: SessionUser | null;
  setMe: (user: SessionUser | null) => void;
  orgs: OrgSummary[];
  boardOrgId: string | null;
  vote: VoteController;
  timerWidget: Widget | undefined;
  timerPhase: TimerPhase;
  timerLeft: number;
  refreshAccess: () => Promise<void>;
  setAgentOpen: (value: boolean) => void;
  showNotice: (message: string) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  lang: Lang;
  setLang: (value: Lang) => void;
}) {
  const { theme, setTheme } = useTheme();
  // Theme and language are the two display preferences that follow the account (ADR-150).
  useAccountPreferences({ me, theme, setTheme, lang, setLang });
  const [presentOpen, setPresentOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsUnread, setCommentsUnread] = useState(0);
  const [reactionRequest, setReactionRequest] = useState<{ emoji: string; at: number } | null>(
    null,
  );
  const [restoreRequest, setRestoreRequest] = useState(0);
  const [trashOpen, setTrashOpen] = useState(false);

  /** Signing out from the account menu is the same act as in the organisation screen. */
  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // A failed request still ends this tab's session: the server refused, not the person.
    }
    setMe(null);
    setAgentOpen(false);
    void refreshAccess();
  }, [refreshAccess, setAgentOpen, setMe]);

  /** A copy is a new board with its own access, not a second name for this one. */
  const duplicateBoard = useCallback(async () => {
    try {
      const copy = await api.duplicateBoard(currentRoom());
      window.location.href = `/?room=${encodeURIComponent(copy.board.id)}`;
    } catch (failure) {
      showNotice(failure instanceof Error ? failure.message : t("org.failed"));
    }
  }, [showNotice, t]);

  /** Trashing closes the room: the board leaves the directory for everyone (ADR-073). */
  const trashBoard = useCallback(async () => {
    try {
      await api.deleteBoard(currentRoom());
      setTrashOpen(false);
      window.location.href = "/";
    } catch (failure) {
      setTrashOpen(false);
      showNotice(failure instanceof Error ? failure.message : t("org.failed"));
    }
  }, [showNotice, t]);

  /**
   * A frozen room keeps its content and loses only the right to change it (§2.5).
   *
   * The signal is the organisation's billing read, not the role: a viewer is read-only
   * for a different reason and must not be told the plan froze the room. The server's
   * `readOnly` covers the seat grace; `frozenRooms` names individual rooms once the
   * chooser ships. No signal means no banner.
   */
  const [planFrozen, setPlanFrozen] = useState(false);
  useEffect(() => {
    setPlanFrozen(false);
    if (!boardOrgId) return;
    const editable = access?.allowed === true && access.capabilities.includes("board.edit");
    if (editable) return;
    let alive = true;
    billingApi
      .org(boardOrgId)
      .then((summary) => {
        if (!alive) return;
        // `frozenRooms` is the explicit list once the chooser ships; until then an
        // organisation above its room limit is the signal that some rooms are frozen.
        const overRooms =
          summary.limits.rooms !== null && summary.usage.rooms > summary.limits.rooms;
        setPlanFrozen(
          summary.readOnly || overRooms || summary.frozenRooms.includes(currentRoom()),
        );
      })
      .catch(() => {
        // Billing is off, or the room is not the billing subject: silence is honest.
      });
    return () => {
      alive = false;
    };
  }, [access, boardOrgId]);

  const orgName = orgs.find((org) => org.id === boardOrgId)?.name ?? null;
  const roleLine = roleSourceLine(t, access?.role ?? null, access?.sources ?? []);

  // The header names a running session in words, not only with a dot (spec §10, Ш2).
  const voteTick = useNow(vote.running, vote.active?.endsAt ?? "");
  const voteEndsMs = vote.active?.endsAt ? new Date(vote.active.endsAt).getTime() : 0;
  const voteLeft = vote.running && voteEndsMs ? Math.max(0, voteEndsMs - (voteTick + vote.offset)) : 0;
  const voteHint = vote.running
    ? t("facilitation.vote.rowRunning", { time: formatRemaining(voteLeft) })
    : t("facilitation.vote.notRunning");
  const timerHint = !timerWidget
    ? t("facilitation.timer.idle")
    : timerPhase === "expired"
      ? t("facilitation.timer.timeUp")
      : timerPhase === "paused"
        ? `${t("facilitation.timer.pause")} · ${formatRemaining(timerLeft)}`
        : formatRemaining(timerLeft);

  return {
    theme,
    setTheme,
    presentOpen,
    setPresentOpen,
    commentsOpen,
    setCommentsOpen,
    commentsUnread,
    setCommentsUnread,
    reactionRequest,
    react: (emoji: string) => setReactionRequest({ emoji, at: Date.now() }),
    restoreRequest,
    requestRestore: () => setRestoreRequest((value) => value + 1),
    trashOpen,
    setTrashOpen,
    trashBoard,
    signOut,
    duplicateBoard,
    orgName,
    roleLine,
    voteHint,
    timerHint,
    planFrozen,
    onOpenBilling: () => requestBillingTab(boardOrgId),
  };
}
