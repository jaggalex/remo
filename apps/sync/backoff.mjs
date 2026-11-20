/**
 * The one retry ladder (ADR-246).
 *
 * Webhooks and mail both ask the same question — "how long after attempt N?" — and differ
 * only in the schedule. Keeping the index arithmetic in one place is what stops the two
 * ladders from drifting apart; a second copy would be the defect.
 */

/**
 * `schedule[attempts - 1]`, clamped on both ends. `attempts` is 1-based, so the first
 * attempt is the first step and anything at or below zero is treated as the first attempt.
 * Beyond the last step the last step repeats.
 *
 * @param {number} attempts 1-based attempt number
 * @param {number[]} schedule non-empty ladder of milliseconds
 * @returns {number} milliseconds to wait before the next attempt
 */
export function backoffMs(attempts, schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    throw new Error("backoffMs: schedule must be a non-empty array of milliseconds");
  }
  for (const step of schedule) {
    if (!Number.isFinite(step) || step < 0) {
      throw new Error(
        "backoffMs: schedule must hold finite, non-negative milliseconds only",
      );
    }
  }
  // `Math.trunc` because a caller may pass a float; NaN would otherwise index `undefined`.
  const step = Math.trunc(attempts);
  const index = Math.min(Math.max(Number.isNaN(step) ? 1 : step, 1), schedule.length) - 1;
  return schedule[index];
}
