import { describe, expect, it } from "vitest";
import { clampTimerMs, formatRemaining, timerPhase, timerRemainingMs } from "./timer";
import type { TimerState } from "./types";

const base: TimerState = {
  durationMs: 300_000,
  endsAt: null,
  remainingMs: null,
  state: "idle",
  setBy: "Alex",
};

describe("shared timer (ADR-075)", () => {
  it("is idle until it is started", () => {
    expect(timerPhase(base, 1_000)).toBe("idle");
    expect(timerRemainingMs(base, 1_000)).toBe(0);
  });

  it("derives the remaining time from endsAt, not from a local counter", () => {
    const timer: TimerState = {
      ...base,
      state: "running",
      endsAt: new Date(10_000).toISOString(),
    };
    expect(timerRemainingMs(timer, 1_000)).toBe(9_000);
    expect(timerPhase(timer, 1_000)).toBe("running");
  });

  it("turns expired by itself when the stored end is in the past", () => {
    const timer: TimerState = {
      ...base,
      state: "running",
      endsAt: new Date(10_000).toISOString(),
    };
    expect(timerPhase(timer, 10_000)).toBe("expired");
    expect(timerRemainingMs(timer, 12_000)).toBe(0);
  });

  it("keeps the paused value and resumes from it", () => {
    const timer: TimerState = { ...base, state: "paused", remainingMs: 42_000 };
    expect(timerPhase(timer, 999_999)).toBe("paused");
    expect(timerRemainingMs(timer, 999_999)).toBe(42_000);
  });

  it("formats minutes, seconds and hours, rounding up the last second", () => {
    expect(formatRemaining(300_000)).toBe("05:00");
    expect(formatRemaining(999)).toBe("00:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(3_600_000)).toBe("1:00:00");
    expect(formatRemaining(3_725_000)).toBe("1:02:05");
  });

  it("clamps a chosen length to what the product allows", () => {
    expect(clampTimerMs(1)).toBe(60_000);
    expect(clampTimerMs(5 * 60_000)).toBe(300_000);
    expect(clampTimerMs(30 * 24 * 60 * 60_000)).toBe(24 * 60 * 60_000);
    expect(clampTimerMs(Number.NaN)).toBe(300_000);
  });
});
