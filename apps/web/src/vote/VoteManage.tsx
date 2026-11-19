import { useState } from "react";
import { formatRemaining, type Widget } from "@remo/model";
import { Badge, Banner, Button, ConfirmDialog, IconButton } from "@remo/ui";
import type { VoteSession } from "./voteTypes";
import { useI18n } from "../i18n";
import { objectLabel } from "./voteLabels";
import { barWidth, maxVotes, totalVotes, voteRows } from "./voteModel";

/**
 * Running a session (ТЗ §4.3, ADR-117).
 *
 * Three numbers answer "how are we doing", the list keeps the full scope — including
 * objects that are off screen — and the only vote controls are on the board itself.
 * «+1 мин» and «Завершить сейчас…» are two different acts with two different weights:
 * the second one closes the session for everyone, so it asks first.
 *
 * An open session says so in words for the whole run, before the first vote and after
 * it: the board will see what each person voted for (ADR-126). An anonymous one keeps
 * the sentence it always had.
 */
export function VoteManage({
  session,
  widgets,
  canFacilitate,
  busy,
  left,
  pinnedToTimer,
  onExtend,
  onEnd,
  onReveal,
}: {
  session: VoteSession;
  widgets: Widget[];
  canFacilitate: boolean;
  busy: boolean;
  left: number | null;
  pinnedToTimer: boolean;
  onExtend: () => void;
  onEnd: () => void;
  onReveal: (objectId: string) => void;
}) {
  const { t, count, typeName } = useI18n();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const rows = voteRows(session);
  const peak = maxVotes(rows);
  const label = (id: string) =>
    objectLabel(id, byId.get(id), {
      typeName,
      unnamed: (tail) => t("facilitation.vote.unnamed", { name: tail }),
    });

  const params = [
    `${count("dsVotes", session.votesPerSubject)} ${t("facilitation.vote.perPerson")}`,
    session.anonymous
      ? t("facilitation.vote.anonymousShort")
      : t("facilitation.vote.openWord"),
    ...(pinnedToTimer ? [t("facilitation.vote.withTimer")] : []),
  ].join(" · ");

  return (
    <section className="vote-session" aria-label={t("facilitation.vote.manage")}>
      <p className="vote-params">{params}</p>

      {/**
       * Consent, in words, for as long as the session runs — including before the first
       * vote. The same sentence the start form promised, so the two never disagree
       * (ADR-126).
       */}
      {session.anonymous ? (
        <p className="vote-note">{t("facilitation.vote.anonymousNote")}</p>
      ) : (
        <Banner tone="warning" icon="eye">
          {t("facilitation.vote.openNote")}
        </Banner>
      )}

      <div className="vote-stats">
        <div className="vote-stat">
          <span className="vote-stat-value">{left === null ? "—" : formatRemaining(left)}</span>
          <span className="vote-stat-label">{t("facilitation.vote.leftTime")}</span>
        </div>
        <div className="vote-stat">
          <span className="vote-stat-value">{session.voters}</span>
          <span className="vote-stat-label">{t("facilitation.vote.votedCount")}</span>
        </div>
        <div className="vote-stat">
          <span className="vote-stat-value">{totalVotes(rows)}</span>
          <span className="vote-stat-label">{t("facilitation.vote.castCount")}</span>
        </div>
      </div>

      <h4 className="vote-subheading">
        {t("facilitation.vote.objects")}
        <Badge tone="neutral" count={session.objectIds.length} />
      </h4>
      <ul className="vote-list">
        {rows.map((row) => (
          <li key={row.objectId}>
            <span className="vote-label">{label(row.objectId)}</span>
            <span className="vote-row-bar" aria-hidden="true">
              <span style={{ width: barWidth(row, peak) }} />
            </span>
            <span className="vote-count">{row.votes}</span>
            <IconButton
              icon="eye"
              label={`${t("facilitation.vote.showOnBoard")}: ${label(row.objectId)}`}
              size="compact"
              disabled={busy}
              onClick={() => onReveal(row.objectId)}
            />
          </li>
        ))}
      </ul>

      {canFacilitate && (
        <div className="vote-actions-row">
          <Button variant="secondary" size="compact" disabled={busy} onClick={onExtend}>
            {t("facilitation.vote.extend")}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            disabled={busy}
            onClick={() => setConfirmEnd(true)}
          >
            {t("facilitation.vote.endNow")}
          </Button>
        </div>
      )}

      {confirmEnd && (
        <ConfirmDialog
          title={t("facilitation.vote.endConfirmTitle")}
          confirmLabel={t("facilitation.vote.endConfirmAction")}
          tone="accent"
          loading={busy}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => {
            setConfirmEnd(false);
            onEnd();
          }}
        >
          {t("facilitation.vote.endConfirmBody")}
        </ConfirmDialog>
      )}
    </section>
  );
}
