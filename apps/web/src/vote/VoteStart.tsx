import { formatRemaining } from "@remo/model";
import { Button, ChoiceCard, IconButton, Segmented } from "@remo/ui";
import { useI18n } from "../i18n";
import type { VoteDuration } from "./voteModel";

/**
 * Starting a session (ТЗ §4.3, ADR-074).
 *
 * Two decisions carry consequences, so they are not a number field and a checkbox:
 * the quota is a stepper and anonymity is two cards that say what each choice means.
 * The duration is a segment; «С таймером» exists only while the board timer runs, and
 * then it is the one clock the session follows (ADR-117).
 */
export function VoteStart({
  selectedCount,
  quota,
  duration,
  anonymous,
  timerEndsAt,
  timerLeft,
  busy,
  onQuota,
  onDuration,
  onAnonymous,
  onStart,
}: {
  selectedCount: number;
  quota: number;
  duration: VoteDuration;
  anonymous: boolean;
  timerEndsAt: string | null;
  timerLeft: number | null;
  busy: boolean;
  onQuota: (quota: number) => void;
  onDuration: (duration: VoteDuration) => void;
  onAnonymous: (anonymous: boolean) => void;
  onStart: () => void;
}) {
  const { t, count } = useI18n();
  const timerLabel =
    timerLeft !== null
      ? `${t("facilitation.vote.timerOption")} · ${formatRemaining(timerLeft)}`
      : t("facilitation.vote.timerOption");

  return (
    <section className="vote-start" aria-label={t("facilitation.vote.startTitle")}>
      <h3 className="vote-heading">
        {t("facilitation.vote.scopeTitle", { scope: count("objectsDative", selectedCount) })}
      </h3>
      <p className="vote-params">
        {selectedCount
          ? t("facilitation.vote.scopeSelected", { n: selectedCount })
          : t("facilitation.vote.scopeEmpty")}
      </p>

      <div className="vote-field">
        <span className="vote-field-label">{t("facilitation.vote.quota")}</span>
        <div className="vote-stepper" role="group" aria-label={t("facilitation.vote.quota")}>
          <IconButton
            icon="minus"
            label={t("facilitation.vote.quotaLess")}
            size="compact"
            disabled={busy || quota <= 1}
            onClick={() => onQuota(Math.max(1, quota - 1))}
          />
          <span className="vote-stepper-value" aria-live="polite">
            {quota}
          </span>
          <IconButton
            icon="plus"
            label={t("facilitation.vote.quotaMore")}
            size="compact"
            disabled={busy || quota >= 100}
            onClick={() => onQuota(Math.min(100, quota + 1))}
          />
        </div>
      </div>

      <div className="vote-field">
        <span className="vote-field-label">{t("facilitation.vote.duration")}</span>
        <Segmented
          label={t("facilitation.vote.duration")}
          value={duration}
          onChange={(value) => onDuration(value as VoteDuration)}
          options={[
            { value: "5", label: t("facilitation.vote.minutes5") },
            { value: "10", label: t("facilitation.vote.minutes10") },
            { value: "15", label: t("facilitation.vote.minutes15") },
            {
              value: "timer",
              label: timerLabel,
              disabled: !timerEndsAt,
            },
          ]}
        />
        {!timerEndsAt && <p className="vote-hint">{t("facilitation.vote.timerOptionHint")}</p>}
        {timerEndsAt && duration === "timer" && (
          <p className="vote-hint vote-timer-note">
            {t("facilitation.vote.followsTimer", {
              time: formatRemaining(timerLeft ?? 0),
            })}
          </p>
        )}
      </div>

      <div className="vote-field">
        <ChoiceCard
          label={t("facilitation.vote.anonymous")}
          value={anonymous ? "anonymous" : "open"}
          onChange={(value) => onAnonymous(value === "anonymous")}
          options={[
            {
              value: "anonymous",
              title: t("facilitation.vote.anonymousTitle"),
              hint: t("facilitation.vote.anonymousHint"),
            },
            {
              value: "open",
              title: t("facilitation.vote.openTitle"),
              hint: t("facilitation.vote.openHint"),
            },
          ]}
        />
      </div>

      <div className="vote-actions-row">
        <Button
          variant="primary"
          disabled={busy || selectedCount === 0}
          onClick={onStart}
        >
          {t("facilitation.vote.start")}
        </Button>
      </div>
    </section>
  );
}
