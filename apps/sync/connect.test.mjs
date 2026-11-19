import { describe, expect, it } from "vitest";
import { connectWithRetry } from "./postgres.mjs";

describe("database connect retry (ADR-087)", () => {
  it("returns after the first successful attempt", async () => {
    let calls = 0;
    const attempt = await connectWithRetry({
      connect: async () => {
        calls += 1;
      },
      sleep: async () => {},
      log: { error() {} },
    });
    expect(attempt).toBe(1);
    expect(calls).toBe(1);
  });

  it("survives a database that is still starting", async () => {
    let calls = 0;
    const attempt = await connectWithRetry({
      attempts: 4,
      connect: async () => {
        calls += 1;
        if (calls < 3) throw new Error("read ECONNRESET");
      },
      sleep: async () => {},
      log: { error() {} },
    });
    expect(attempt).toBe(3);
    expect(calls).toBe(3);
  });

  it("reports the last error instead of pretending a store exists", async () => {
    await expect(
      connectWithRetry({
        attempts: 2,
        connect: async () => {
          throw new Error("ECONNREFUSED");
        },
        sleep: async () => {},
        log: { error() {} },
      }),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
