import { describe, expect, it } from "vitest";
import { backoffMs } from "./backoff.mjs";

const schedule = [5_000, 15_000, 60_000];

describe("backoff ladder", () => {
  it("walks the schedule from the first attempt", () => {
    expect(schedule.map((_, index) => backoffMs(index + 1, schedule))).toEqual(schedule);
  });

  it("repeats the last step after the schedule ends", () => {
    expect(backoffMs(4, schedule)).toBe(60_000);
    expect(backoffMs(99, schedule)).toBe(60_000);
    expect(backoffMs(Number.POSITIVE_INFINITY, schedule)).toBe(60_000);
  });

  it("treats zero, negatives and fractions as the first attempt", () => {
    expect(backoffMs(0, schedule)).toBe(5_000);
    expect(backoffMs(-3, schedule)).toBe(5_000);
    expect(backoffMs(1.9, schedule)).toBe(5_000);
  });

  it("refuses an empty or malformed schedule instead of returning undefined", () => {
    expect(() => backoffMs(1, [])).toThrowError(/non-empty/);
    expect(() => backoffMs(1, null)).toThrowError(/non-empty/);
    expect(() => backoffMs(1, "soon")).toThrowError(/non-empty/);
    expect(() => backoffMs(1, [5_000, -1])).toThrowError(/non-negative/);
    expect(() => backoffMs(1, [5_000, Number.NaN])).toThrowError(/non-negative/);
  });
});
