import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFailures,
  isRateLimited,
  recordFailure,
  resetFailures,
  sweep,
} from "./attempts.mjs";

beforeEach(() => resetFailures());

describe("the failure limiter", () => {
  it("allows ten failures, then refuses the key", () => {
    const key = "login:127.0.0.1:person@example.com";
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(isRateLimited(key)).toBe(false);
      recordFailure(key);
    }
    expect(isRateLimited(key)).toBe(false);
    recordFailure(key);
    expect(isRateLimited(key)).toBe(true);
  });

  it("keys independently, so one address does not lock another", () => {
    recordFailure("login:127.0.0.1:a@example.com", { windowMs: 60_000 });
    expect(isRateLimited("login:127.0.0.1:b@example.com")).toBe(false);
  });

  it("forgets the key after a success", () => {
    const key = "link:127.0.0.1:board";
    for (let attempt = 0; attempt < 10; attempt += 1) recordFailure(key);
    expect(isRateLimited(key)).toBe(true);
    clearFailures(key);
    expect(isRateLimited(key)).toBe(false);
  });

  it("reopens the window when it expires", () => {
    const key = "login:127.0.0.1:late@example.com";
    const start = 1_000;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      recordFailure(key, { now: start, windowMs: 1_000 });
    }
    expect(isRateLimited(key, { now: start + 999 })).toBe(true);
    expect(isRateLimited(key, { now: start + 1_000 })).toBe(false);
  });

  it("drops expired buckets instead of growing forever", () => {
    recordFailure("old", { now: 1_000, windowMs: 10 });
    recordFailure("new", { now: 1_000, windowMs: 10_000 });
    sweep(2_000);
    expect(isRateLimited("old", { now: 2_000 })).toBe(false);
    expect(isRateLimited("new", { now: 2_000 })).toBe(false);
    // `new` is still inside its window, so its count survived the sweep.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      recordFailure("new", { now: 2_000, windowMs: 10_000 });
    }
    expect(isRateLimited("new", { now: 2_000 })).toBe(true);
  });
});
