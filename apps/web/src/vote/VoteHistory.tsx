import { useState } from "react";
import type { Widget } from "@remo/model";
import { Badge, Button, EmptyState } from "@remo/ui";
import type { VoteSession } from "./voteTypes";
import { formatMoment } from "../format";
import { useI18n } from "../i18n";
import { objectLabel } from "./voteLabels";
import { leaderRows, rankRows, totalVotes, voteRows } from "./voteModel";

/**
 * Past sessions (ТЗ §4.3, ADR-074).
 *
 * A collapsed row names the leader in one line; an open one shows the top three and the
 * way to the results card. An unpublished session can be published from here, through
 * the same command as from the results screen.
 */
export function VoteHistory({
  sessions,
  widgets,
  canFacilitate,
  busy,
  onOpenResults,
  onPublish,
  onNewSession,
}: {
  sessions: VoteSession[];
  widgets: Widget[];
  canFacilitate: boolean;
  busy: boolean;
  onOpenResults: (sessionId: string) => void;
  onPublish: (session: VoteSession) => void;
  onNewSession: () => void;
}) {
  const { t, lang, typeName, typeDative, count } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const label = (id: string) =>
    objectLabel(id, byId.get(id), {
      typeName,
      unnamed: (tail) => t("facilitation.vote.unnamed", { name: tail }),
    });

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon="vote"
        title={t("facilitation.vote.historyEmptyTitle")}
        example={t("facilitation.vote.historyEmptyExample")}
        action={{
          label: t("facilitation.vote.newSession"),
          icon: "plus",
          onClick: onNewSession,
        }}
      >
        {t("facilitation.vote.historyEmptyBody")}
      </EmptyState>
    );
  }

  const nameFor = (session: VoteSession) => {
    const types = session.objectIds.map((id) => byId.get(id)?.type ?? "unsupported");
    const unique = new Set(types);
    // "Голосование по 6 стикерам" when one type fills the scope; otherwise the same
    // sentence with "по N объектам" — never "6 объект".
    const scope =
      unique.size === 1
        ? typeDative(types[0]!, types.length)
        : count("objectsDative", types.length);
    return t("facilitation.vote.scopeTitle", { scope });
  };

  return (
    <section className="vote-history" aria-label={t("facilitation.vote.historyTitle")}>
      <h4 className="vote-subheading">{t("facilitation.vote.historyTitle")}</h4>
      <ul className="vote-history-list">
        {sessions.map((session) => {
          const open = openId === session.id;
          const rows = voteRows(session);
          const { rows: ranked } = rankRows(rows);
          const leader = leaderRows(ranked)[0];
          return (
            <li key={session.id} className="vote-history-item">
              <Button
                variant="ghost"
                className="vote-history-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : session.id)}
              >
                <span className="vote-history-title">{nameFor(session)}</span>
                <span className="vote-history-when">{formatMoment(session.createdAt, lang)}</span>
                <Badge tone={session.publishedAt ? "success" : "neutral"} icon={session.publishedAt ? "check" : undefined}>
                  {session.publishedAt
                    ? t("facilitation.vote.publishedBadge")
                    : t("facilitation.vote.unpublishedBadge")}
                </Badge>
                <Badge tone="neutral">
                  {session.anonymous
                    ? t("facilitation.vote.anonymousShort")
                    : t("facilitation.vote.openWord")}
                </Badge>
                <span className="vote-history-meta">
                  {t("facilitation.vote.voters", { n: session.voters })} ·{" "}
                  {count("dsVotes", totalVotes(rows))}
                </span>
              </Button>

              {!open && leader && (
                <p className="vote-history-leader">
                  {t("facilitation.vote.historyLeader", {
                    name: label(leader.objectId),
                    votes: leader.votes,
                  })}
                </p>
              )}

              {open && (
                <div className="vote-history-body">
                  <ol className="vote-results-list">
                    {ranked.slice(0, 3).map((row) => (
                      <li key={row.objectId}>
                        <span className="vote-place">{row.place}</span>
                        <span className="vote-label">{label(row.objectId)}</span>
                        <span className="vote-count">{row.votes}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="vote-actions-row">
                    <Button
                      variant="secondary"
                      size="compact"
                      onClick={() => onOpenResults(session.id)}
                    >
                      {t("facilitation.vote.historyOpen")}
                    </Button>
                    {canFacilitate && !session.publishedAt && (
                      <Button
                        variant="secondary"
                        size="compact"
                        disabled={busy}
                        onClick={() => onPublish(session)}
                      >
                        {t("facilitation.vote.publishBoard")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
