import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFailures,
  isRateLimited,
  recordFailure,
  reserveAttempt,
  resetFailures,
  sweep,
  trackedFailures,
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

  it("reserves an attempt before the expensive work", () => {
    const key = "login-ip:203.0.113.7";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(reserveAttempt(key, { limit: 3 })).toBe(true);
    }
    expect(reserveAttempt(key, { limit: 3 })).toBe(false);
    clearFailures(key);
    expect(reserveAttempt(key, { limit: 3 })).toBe(true);
  });

  it("counts parallel reservations in one synchronous step", () => {
    // Two requests that both read a count of nine must not both reach scrypt.
    const results = Array.from({ length: 12 }, () =>
      reserveAttempt("login:203.0.113.7:person@example.com", { limit: 10 }),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
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

  it("stays bounded even when every bucket is live", () => {
    // A caller can create a new key per request; the map must not grow with it.
    for (const key of ["a", "b", "c", "d"]) {
      recordFailure(key, { now: 1_000, windowMs: 60_000, maxKeys: 3 });
    }
    expect(trackedFailures()).toBe(3);
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
