import { useId, useState } from "react";
import type { Widget } from "@remo/model";
import { Avatar, Badge, Button, Icon } from "@remo/ui";
import type { VoteSession } from "./voteTypes";
import { formatMoment } from "../format";
import { useI18n } from "../i18n";
import { objectLabel } from "./voteLabels";
import {
  barWidth,
  leaderRows,
  maxVotes,
  objectVoters,
  rankRows,
  showsVoters,
  totalVotes,
  voteRows,
} from "./voteModel";

/**
 * The results of one session (ТЗ §4.3, ADR-074, ADR-126).
 *
 * The list states the places and names the ties in words; the block under it shows the
 * very card that publishing will write to the board, built from the same rows, so the
 * preview cannot promise a different tally from the one that lands on the canvas.
 *
 * In an open session that has ended the server also sends who voted: every row opens to
 * the accounts behind its number, and a summary says how widely each person spread their
 * votes. Guests are one counted line in both — a link visitor has no name to show. An
 * anonymous session sends neither, and there is nothing to open.
 */
export function VoteResults({
  session,
  widgets,
  canFacilitate,
  busy,
  publishedObjectId,
  onPublish,
  onNewSession,
  onReveal,
}: {
  session: VoteSession;
  widgets: Widget[];
  canFacilitate: boolean;
  busy: boolean;
  publishedObjectId: string | null;
  onPublish: () => void;
  onNewSession: () => void;
  onReveal: (objectId: string) => void;
}) {
  const { t, lang, typeName, count } = useI18n();
  // Which rows are open. Not remembered across sessions: the names are the answer to a
  // question asked now, not a mode of the screen.
  const [openRows, setOpenRows] = useState<string[]>([]);
  const panelBase = useId();
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const label = (id: string) =>
    objectLabel(id, byId.get(id), {
      typeName,
      unnamed: (tail) => t("facilitation.vote.unnamed", { name: tail }),
    });
  /** A deleted account loses its name but not its votes; the word is ours, not a guess. */
  const voterName = (name: string | null) => name ?? t("facilitation.vote.unknownVoter");

  const rows = voteRows(session);
  const { rows: ranked, ties } = rankRows(rows);
  const peak = maxVotes(rows);
  const leaders = leaderRows(ranked);
  const total = totalVotes(rows);
  const max = session.voters * session.votesPerSubject;
  const endedAt = session.endedAt ?? session.endsAt ?? session.createdAt;
  const top = ranked.slice(0, 10);
  const namesShown = showsVoters(session);
  const breakdown = session.breakdown;
  const hasSummary = Boolean(
    breakdown && (breakdown.summary.length > 0 || breakdown.guests.votes > 0),
  );

  const toggleRow = (objectId: string) =>
    setOpenRows((previous) =>
      previous.includes(objectId)
        ? previous.filter((id) => id !== objectId)
        : [...previous, objectId],
    );

  return (
    <section className="vote-results" aria-label={t("facilitation.vote.resultsTitle")}>
      <h3 className="vote-heading">
        {leaders.length === 0
          ? t("facilitation.vote.resultsNone")
          : leaders.length === 1
            ? t("facilitation.vote.resultsLeader", { name: label(leaders[0]!.objectId) })
            : t("facilitation.vote.resultsLeaders", {
                names: leaders.map((row) => label(row.objectId)).join(", "),
              })}
      </h3>
      <p className="vote-params">
        {t("facilitation.vote.endedAt", { time: formatMoment(endedAt, lang) })} ·{" "}
        {t("facilitation.vote.voters", { n: session.voters })} ·{" "}
        {t("facilitation.vote.castOf", { votes: total, max })}
      </p>

      <ol className="vote-results-list">
        {ranked.map((row, index) => {
          const voters = objectVoters(session, row.objectId);
          const people = voters?.voters ?? [];
          const guestVotes = voters?.guests.votes ?? 0;
          const canOpen = namesShown && (people.length > 0 || guestVotes > 0);
          const open = canOpen && openRows.includes(row.objectId);
          const panelId = `${panelBase}-voters-${index}`;
          return (
            <li key={row.objectId} className={row.place <= 3 ? "is-top" : undefined}>
              <span className="vote-place">
                {row.place === row.placeEnd ? row.place : `${row.place}–${row.placeEnd}`}
              </span>
              {canOpen ? (
                <Button
                  variant="ghost"
                  size="compact"
                  className="vote-row-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={`${label(row.objectId)} · ${t("facilitation.vote.whoVoted")}`}
                  onClick={() => toggleRow(row.objectId)}
                >
                  <span className="vote-label">{label(row.objectId)}</span>
                  <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
                </Button>
              ) : (
                <span className="vote-label">{label(row.objectId)}</span>
              )}
              <span className="vote-row-bar" aria-hidden="true">
                <span style={{ width: barWidth(row, peak) }} />
              </span>
              <span className="vote-count">{row.votes}</span>
              {open && (
                <div className="vote-voters" id={panelId}>
                  <ul className="vote-voters-list">
                    {people.map((voter, voterIndex) => (
                      <li key={`${panelId}-${voterIndex}`}>
                        <Avatar name={voterName(voter.name)} size="sm" />
                        <span className="vote-voters-name">{voterName(voter.name)}</span>
                        <span className="vote-voters-count">
                          {count("dsVotes", voter.votes)}
                        </span>
                      </li>
                    ))}
                    {guestVotes > 0 && (
                      <li className="vote-voters-guest">
                        <span className="vote-voters-name">
                          {t("facilitation.vote.guests")}
                        </span>
                        <span className="vote-voters-count">
                          {count("dsVotes", guestVotes)}
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {ties.map((tie) => (
        <p key={tie.from} className="vote-tie">
          {t("facilitation.vote.tie", {
            from: tie.from,
            to: tie.to,
            names: tie.rows.map((row) => label(row.objectId)).join(", "),
          })}
        </p>
      ))}

      {breakdown && hasSummary && (
        <section className="vote-summary" aria-label={t("facilitation.vote.summaryTitle")}>
          <h4 className="vote-subheading">{t("facilitation.vote.summaryTitle")}</h4>
          <ul className="vote-summary-list">
            {breakdown.summary.map((person, index) => (
              <li key={`person-${index}`}>
                <Avatar name={voterName(person.name)} size="sm" />
                <span className="vote-summary-name">{voterName(person.name)}</span>
                <span className="vote-summary-meta">
                  {count("dsVotes", person.total)} · {count("objectsDative", person.objects)}
                </span>
              </li>
            ))}
            {breakdown.guests.votes > 0 && (
              <li className="vote-summary-guest">
                <span className="vote-summary-name">{t("facilitation.vote.guests")}</span>
                <span className="vote-summary-meta">
                  {count("dsVotes", breakdown.guests.votes)}
                </span>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="vote-preview">
        <h4 className="vote-subheading">{t("facilitation.vote.previewTitle")}</h4>
        <div className="vote-preview-card">
          <strong>{t("facilitation.vote.publishedTitle")}</strong>
          {top.map((row, index) => (
            <p key={row.objectId} className="vote-preview-line">
              {index + 1}. {label(row.objectId)} — {row.votes}
            </p>
          ))}
          <p className="vote-preview-meta">
            {t("facilitation.vote.publishedMeta", { n: session.voters })}
          </p>
        </div>
        <p className="vote-note">
          {t("facilitation.vote.previewNote")}
          {session.anonymous
            ? ` ${t("facilitation.vote.previewAnonymous")}`
            : ` ${t("facilitation.vote.previewOpen")}`}
        </p>
      </section>

      <div className="vote-actions-row">
        {session.publishedAt ? (
          <>
            <Badge tone="success" icon="check">
              {t("facilitation.vote.publishedBadge")}
            </Badge>
          </>
        ) : (
          canFacilitate && (
            <Button variant="primary" disabled={busy} onClick={onPublish}>
              {t("facilitation.vote.publishBoard")}
            </Button>
          )
        )}
        <Button variant="secondary" disabled={busy} onClick={onNewSession}>
          {t("facilitation.vote.newSession")}
        </Button>
      </div>
    </section>
  );
}
