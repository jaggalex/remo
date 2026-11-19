import type { VoteBreakdownObject, VoteSession } from "./voteTypes";

/**
 * The arithmetic the voting screens share (ADR-074, ADR-117, ADR-126).
 *
 * A session's tally arrives as an aggregate: objects with votes, never voters. The panel
 * turns it into places, ties and totals here, so the board chips, the results list, the
 * published card and the history cannot disagree about what "second place" means.
 *
 * Names arrive in `breakdown`, and only for an ended open session; this module hands the
 * caller what the server sent instead of deciding who may see it.
 *
 * Pure functions, no React and no i18n: words are resolved by the caller.
 */

export interface VoteRow {
  objectId: string;
  votes: number;
}

export interface RankedRow extends VoteRow {
  /** Competition ranking: 1, 2, 2, 4 — a tie takes the places it spans. */
  place: number;
  placeEnd: number;
}

export interface Tie {
  from: number;
  to: number;
  rows: RankedRow[];
}

export interface Ranking {
  rows: RankedRow[];
  ties: Tie[];
}

/** Every object in the session, including the ones nobody voted for. */
export function voteRows(session: VoteSession): VoteRow[] {
  const tally = new Map(session.votes.map((row) => [row.object_id, row.votes]));
  return session.objectIds.map((objectId) => ({
    objectId,
    votes: tally.get(objectId) ?? 0,
  }));
}

export function totalVotes(rows: readonly VoteRow[]): number {
  return rows.reduce((sum, row) => sum + row.votes, 0);
}

export function maxVotes(rows: readonly VoteRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.votes), 0);
}

/**
 * Places with ties spelled out.
 *
 * Two objects with the same number share the place and the next place is skipped, which
 * is what "Места 2 и 3 делят …" means to a reader.
 */
export function rankRows(rows: readonly VoteRow[]): Ranking {
  const sorted = [...rows].sort((a, b) => b.votes - a.votes);
  const ranked: RankedRow[] = [];
  sorted.forEach((row, index) => {
    const previous = sorted[index - 1];
    const place = previous && previous.votes === row.votes ? ranked[index - 1]!.place : index + 1;
    ranked.push({ ...row, place, placeEnd: place });
  });
  const ties: Tie[] = [];
  for (let start = 0; start < ranked.length; ) {
    let end = start;
    while (end + 1 < ranked.length && ranked[end + 1]!.votes === ranked[start]!.votes) end += 1;
    const from = ranked[start]!.place;
    const to = end + 1;
    for (let index = start; index <= end; index += 1) ranked[index]!.placeEnd = to;
    if (end > start) ties.push({ from, to, rows: ranked.slice(start, end + 1) });
    start = end + 1;
  }
  return { rows: ranked, ties };
}

/** The rows the published card and the history describe as the winners. */
export function leaderRows(rows: readonly RankedRow[]): RankedRow[] {
  return rows.filter((row) => row.place === 1 && row.votes > 0);
}

/** The most votes any object got, at least 1, so a bar never divides by zero. */
export function barWidth(row: VoteRow, peak: number): string {
  if (peak <= 0) return "0%";
  return `${Math.round((row.votes / peak) * 100)}%`;
}

/**
 * Who voted for one object, when the session exposes it; `null` while it runs, for an
 * anonymous session, and for an object the server sent no row for.
 */
export function objectVoters(
  session: VoteSession,
  objectId: string,
): VoteBreakdownObject | null {
  return session.breakdown?.objects.find((row) => row.object_id === objectId) ?? null;
}

/** True when the results can be opened at all: names exist only in an ended open session. */
export function showsVoters(session: VoteSession): boolean {
  return Boolean(session.breakdown);
}

/** True when two deadlines are the same instant, within the precision of a request. */
export function sameDeadline(a: string | null, b: string | null, toleranceMs = 1500): boolean {
  if (!a || !b) return false;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) <= toleranceMs;
}

/** The duration choices on the start screen; "timer" follows the board's clock. */
export type VoteDuration = "timer" | "5" | "10" | "15";

export function durationMinutes(value: VoteDuration): number | null {
  return value === "timer" ? null : Number(value);
}

/**
 * The published card is plain text, not HTML (ADR-146).
 *
 * The text object stores rich-text deltas, not markup: publishing `<p>` tags put them on
 * the board literally. A snapshot is a few lines, so it is built as lines.
 */
export function publishedVoteText({
  title,
  rows,
  meta,
}: {
  title: string;
  rows: readonly { label: string; votes: number }[];
  meta: string;
}): string {
  const lines = rows.map((row, index) => `${index + 1}. ${row.label} — ${row.votes}`);
  return [title, ...lines, meta].join("\n");
}
