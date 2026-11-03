import { useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "@remo/ui";
import { useI18n } from "../i18n";
import { chipPlacement, type Box } from "./chipPlacement";

/**
 * One counter on one object (ADR-119 §4.3, §10.3, ADR-117).
 *
 * Five states, one shape: no votes yet ("0 +"), someone else's votes ("4 +"), my own
 * vote ("1 · ваш − +", accent plate), no votes left in my budget ("+" disabled with the
 * reason), and a session that has ended (the number and the word "итог", no controls —
 * the count stays until the results are published).
 *
 * The sum and my own vote are never mixed: the number is the aggregate the server sent,
 * the caption names my part in words. Screen readers hear the same split through the
 * group's name ("Голосов за объект: 5. Ваш голос: 1"), while the buttons name the object
 * they act on.
 *
 * The size is measured before paint and the position comes from `chipPlacement`, so the
 * chip never covers a connector's label or a neighbour, never leaves the canvas, and the
 * object under it never moves.
 */
export function VoteChip({
  id,
  object,
  votes,
  mine,
  running,
  remaining,
  busy,
  label,
  viewport,
  obstacles,
  leftInset,
  onVote,
  onWithdraw,
}: {
  id: string;
  /** The object's box on screen. */
  object: Box;
  votes: number;
  mine: boolean;
  running: boolean;
  remaining: number;
  busy: boolean;
  /** The object's name, for the buttons and the tooltips. */
  label: string;
  viewport: { width: number; height: number };
  obstacles: readonly Box[];
  /** Strip kept free on the left for the floating rail (S5b). */
  leftInset?: number;
  onVote: (id: string) => void;
  onWithdraw: (id: string) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      // Fractional on purpose: `offsetWidth` rounds, and a half pixel shows up as a
      // 7.5 px gap from the object's corner instead of the 8 px the rule asks for.
      const box = node.getBoundingClientRect();
      const width = box.width;
      const height = box.height;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    read();
    // The chip's width depends on its words and on the language; a vote changes both.
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const state = !running
    ? "ended"
    : mine
      ? "mine"
      : remaining === 0
        ? "limit"
        : votes > 0
          ? "others"
          : "none";
  const place = chipPlacement({ object, chip: size, viewport, obstacles, leftInset });
  const measured = size.width > 0;
  /** Why the "+" cannot be used — the reason stays the same while a request is in flight. */
  const blocked = mine
    ? t("facilitation.vote.alreadyVoted")
    : remaining === 0
      ? t("facilitation.vote.noVotesLeft")
      : null;

  const aria = !running
    ? t("facilitation.vote.chipResult", { n: votes })
    : mine
      ? `${t("facilitation.vote.chipVotes", { n: votes })}. ${t("facilitation.vote.chipMyVote", { n: 1 })}`
      : t("facilitation.vote.chipVotes", { n: votes });

  return (
    <div
      ref={ref}
      role="group"
      aria-label={aria}
      className={`vote-chip ${state}`}
      style={{ left: place.left, top: place.top, visibility: measured ? undefined : "hidden" }}
    >
      <span className="vote-chip-count" aria-hidden="true">
        {votes}
      </span>
      {running && mine && (
        <span className="vote-chip-caption" aria-hidden="true">
          {t("facilitation.vote.chipMine")}
        </span>
      )}
      {!running && (
        <span className="vote-chip-caption" aria-hidden="true">
          {t("facilitation.vote.total")}
        </span>
      )}
      {running && mine && (
        <IconButton
          icon="minus"
          className="vote-chip-button minus"
          label={t("facilitation.vote.withdrawOn", { name: label })}
          title={t("facilitation.vote.withdraw")}
          size="compact"
          disabled={busy}
          onClick={() => onWithdraw(id)}
        />
      )}
      {running && (
        <IconButton
          icon="plus"
          className="vote-chip-button plus"
          label={t("facilitation.vote.voteOn", { name: label })}
          title={blocked ?? t("facilitation.vote.vote")}
          size="compact"
          disabled={busy || Boolean(blocked)}
          onClick={() => onVote(id)}
        />
      )}
    </div>
  );
}
