import { useEffect, useMemo, useState } from "react";
import type { Widget } from "@remo/model";
import { Dialog, Tabs } from "@remo/ui";
import { api, type VoteSession } from "./api";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";
import { useNow } from "./useNow";
import { publishedVoteText } from "./vote/voteModel";
import type { VoteController } from "./useVoteSessions";
import { VoteHistory } from "./vote/VoteHistory";
import { VoteManage } from "./vote/VoteManage";
import { VoteResults } from "./vote/VoteResults";
import { VoteStart } from "./vote/VoteStart";
import { objectLabel } from "./vote/voteLabels";
import {
  durationMinutes,
  sameDeadline,
  type VoteDuration,
} from "./vote/voteModel";

/**
 * The voting panel (ADR-074, ADR-117, ТЗ §4.3).
 *
 * Two tabs: the session (start it, or manage it while it runs) and its results, with the
 * past sessions under them. Voting itself happens on the board — the panel never casts a
 * vote, it keeps the full scope, the facilitator's two controls and the records.
 *
 * The panel never counts votes itself: it sends one command and renders the aggregate the
 * server returns. `remaining` is per subject, so a late joiner sees the same budget and a
 * second browser gets its own.
 */
export function VotePanel({
  open,
  vote,
  widgets,
  canFacilitate,
  selectedIds,
  timerEndsAt,
  timerLeft,
  onClose,
  onPublish,
  onReveal,
}: {
  open: boolean;
  vote: VoteController;
  widgets: Widget[];
  canFacilitate: boolean;
  selectedIds: readonly string[];
  /** When the board timer runs, the session ends with it, not on its own clock. */
  timerEndsAt: string | null;
  timerLeft: number | null;
  onClose: () => void;
  /** The results card is written by the board's own command layer, not by the server. */
  onPublish: (sessionId: string, content: string) => Promise<string | null>;
  onReveal: (objectId: string) => void;
}) {
  const { t, typeName } = useI18n();
  const { sessions, active, busy, error, offset, run } = vote;
  const [tab, setTab] = useState<"session" | "results">("session");
  const [viewSessionId, setViewSessionId] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quota, setQuota] = useState(3);
  const [duration, setDuration] = useState<VoteDuration>("5");
  const [anonymous, setAnonymous] = useState(true);

  const running = active?.state === "open";
  const now = useNow(running, active?.endsAt ?? "");
  const clock = now + offset;
  const left = active?.endsAt ? Math.max(0, new Date(active.endsAt).getTime() - clock) : null;
  /** The server also derives this, but the board must stop the instant the clock hits 0. */
  const expired = running && left !== null && left <= 0;
  const openSession = running && !expired;
  const pinnedToTimer = sameDeadline(active?.endsAt ?? null, timerEndsAt);

  useEffect(() => {
    if (expired) void vote.load();
  }, [expired, vote.load]);

  const byId = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget])), [widgets]);

  // Each opening starts where the work is: results once a session has ended, the form
  // otherwise. The preference is not remembered across openings — a facilitator who
  // returns to the board usually comes back to start the next session.
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setViewSessionId(null);
    setPublishedId(null);
    setDuration(timerEndsAt ? "timer" : "5");
    setTab(vote.active && vote.active.state !== "open" ? "results" : "session");
    // `vote.active` is read on purpose only when the panel opens: a later change is a
    // different question, handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, timerEndsAt]);

  // A session that ends while the panel is open lands on its results, not on a stale
  // "Manage" screen whose clock has already run out.
  const activeState = active ? `${active.id}:${active.state}` : "";
  useEffect(() => {
    if (open && active?.state === "ended") setTab("results");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeState]);

  const resultsSession =
    sessions.find((session) => session.id === viewSessionId) ??
    sessions.find((session) => session.state === "ended") ??
    null;
  const historySessions = sessions.filter(
    (session) => session.state === "ended" && session.id !== resultsSession?.id,
  );

  if (!open) return null;

  const label = (id: string) =>
    objectLabel(id, byId.get(id), {
      typeName,
      unnamed: (tail) => t("facilitation.vote.unnamed", { name: tail }),
    });

  const start = () => {
    const minutes =
      duration === "timer" && !timerEndsAt ? durationMinutes("5") : durationMinutes(duration);
    void run(async () => {
      const created = await api.createVoteSession(vote.boardId, {
        objectIds: [...selectedIds],
        votesPerSubject: quota,
        minutes,
        anonymous,
        // The board's deadline is sent only when the session is actually pinned to the
        // timer: a chosen 5/10/15 minutes must not be overridden by a running timer.
        ...(duration === "timer" && timerEndsAt ? { endsAt: timerEndsAt } : {}),
      });
      setNotice(t("facilitation.vote.started", { n: created.session.objectIds.length }));
      setTab("session");
    });
  };

  const publish = (session: VoteSession) =>
    void run(async () => {
      const result = await api.publishVoteSession(session.id);
      const top = result.results.objects.slice(0, 10);
      const content = publishedVoteText({
        title: t("facilitation.vote.publishedTitle"),
        rows: top.map((row) => ({ label: label(row.object_id), votes: row.votes })),
        meta: t("facilitation.vote.publishedMeta", { n: result.results.voters }),
      });
      const objectId = await onPublish(session.id, content);
      if (objectId) setPublishedId(objectId);
      setViewSessionId(session.id);
      setTab("results");
      setNotice(t("facilitation.vote.published"));
    });

  const openResults = (sessionId: string) => {
    setViewSessionId(sessionId);
    setTab("results");
  };

  const tabSessionLabel = openSession
    ? canFacilitate
      ? t("facilitation.vote.manage")
      : t("facilitation.vote.tabSession")
    : t("facilitation.vote.newSession");

  return (
    <Dialog
      title={t("facilitation.vote.title")}
      size="md"
      onClose={onClose}
    >
      <p className="vote-params vote-intro">
        {t("facilitation.vote.body")} <HelpLink topicId="facilitation.vote" />
      </p>

      <Tabs
        label={t("facilitation.vote.title")}
        value={tab}
        onChange={(value) => setTab(value === "results" ? "results" : "session")}
        tabs={[
          { id: "session", label: tabSessionLabel },
          { id: "results", label: t("facilitation.vote.results") },
        ]}
      />

      {error && (
        <p className="vote-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="vote-notice">{notice}</p>}

      {tab === "session" &&
        (openSession && active ? (
          <VoteManage
            session={active}
            widgets={widgets}
            canFacilitate={canFacilitate}
            busy={busy}
            left={left}
            pinnedToTimer={pinnedToTimer}
            onExtend={() => void run(() => api.extendVoteSession(active.id, 1))}
            onEnd={() => void run(() => api.endVoteSession(active.id))}
            onReveal={onReveal}
          />
        ) : canFacilitate ? (
          <VoteStart
            selectedCount={selectedIds.length}
            quota={quota}
            duration={duration}
            anonymous={anonymous}
            timerEndsAt={timerEndsAt}
            timerLeft={timerLeft}
            busy={busy}
            onQuota={setQuota}
            onDuration={setDuration}
            onAnonymous={setAnonymous}
            onStart={start}
          />
        ) : (
          <p className="vote-note">{t("facilitation.vote.none")}</p>
        ))}

      {tab === "results" && (
        <>
          {sessions.length === 0 ? (
            <VoteHistory
              sessions={[]}
              widgets={widgets}
              canFacilitate={canFacilitate}
              busy={busy}
              onOpenResults={openResults}
              onPublish={publish}
              onNewSession={() => setTab("session")}
            />
          ) : (
            <>
              {resultsSession && resultsSession.state === "ended" ? (
                <VoteResults
                  session={resultsSession}
                  widgets={widgets}
                  canFacilitate={canFacilitate}
                  busy={busy}
                  publishedObjectId={publishedId}
                  onPublish={() => publish(resultsSession)}
                  onNewSession={() => setTab("session")}
                  onReveal={onReveal}
                />
              ) : (
                <p className="vote-note">{t("facilitation.vote.resultsPending")}</p>
              )}
              {historySessions.length > 0 && (
                <VoteHistory
                  sessions={historySessions}
                  widgets={widgets}
                  canFacilitate={canFacilitate}
                  busy={busy}
                  onOpenResults={openResults}
                  onPublish={publish}
                  onNewSession={() => setTab("session")}
                />
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
