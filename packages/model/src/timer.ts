import type { TimerState } from "./types";

/**
 * The shared timer, as a value (ADR-075).
 *
 * Everything a client shows — remaining time, "running / paused / time is up" — is
 * derived from the stored `endsAt` and `remainingMs`. No client keeps a countdown of its
 * own as the truth, so a late joiner, a reconnect and a laptop that slept all agree.
 */
export type TimerPhase = "idle" | "running" | "paused" | "expired";

export const TIMER_DEFAULT_MS = 5 * 60_000;
export const TIMER_MIN_MS = 60_000;
export const TIMER_MAX_MS = 24 * 60 * 60_000;

export function timerPhase(timer: TimerState | null | undefined, now = Date.now()): TimerPhase {
  if (!timer) return "idle";
  if (timer.state === "paused") return "paused";
  if (timer.state !== "running" || !timer.endsAt) return "idle";
  return new Date(timer.endsAt).getTime() <= now ? "expired" : "running";
}

export function timerRemainingMs(
  timer: TimerState | null | undefined,
  now = Date.now(),
): number {
  if (!timer) return 0;
  if (timer.state === "paused") return Math.max(0, timer.remainingMs ?? timer.durationMs);
  if (timer.state !== "running" || !timer.endsAt) return Math.max(0, timer.remainingMs ?? 0);
  return Math.max(0, new Date(timer.endsAt).getTime() - now);
}

/**
 * `05:00`, `1:05:00`. Rounds up, so the last second shows `00:01` rather than `00:00`
 * while the timer is still running.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Clamp a chosen duration to the range the product allows. */
export function clampTimerMs(ms: number): number {
  if (!Number.isFinite(ms)) return TIMER_DEFAULT_MS;
  return Math.min(TIMER_MAX_MS, Math.max(TIMER_MIN_MS, Math.round(ms)));
}
