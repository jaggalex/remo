import { describe, expect, it } from "vitest";
import { CLOSE_RATE_LIMITED, CLOSE_ROOM_FULL, limitBackoffMs } from "./sync";

describe("reconnect after a write budget close (ADR-173)", () => {
  it("waits, doubles and stops at a cap", () => {
    expect(limitBackoffMs(CLOSE_RATE_LIMITED, 0)).toBe(5_000);
    expect(limitBackoffMs(CLOSE_RATE_LIMITED, 1)).toBe(10_000);
    expect(limitBackoffMs(CLOSE_RATE_LIMITED, 10)).toBe(60_000);
  });

  it("waits longer for a full room, where space returns only after a deletion", () => {
    expect(limitBackoffMs(CLOSE_ROOM_FULL, 0)).toBe(30_000);
    expect(limitBackoffMs(CLOSE_ROOM_FULL, 10)).toBe(300_000);
  });

  it("uses the server's close codes", () => {
    expect([CLOSE_RATE_LIMITED, CLOSE_ROOM_FULL]).toEqual([4429, 4413]);
  });
});
