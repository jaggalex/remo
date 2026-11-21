import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdminLog, MetadataLog, requestRecord, sanitize, usageFromLogs } from "./log.mjs";

const dirs = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "remo-gw-log-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true });
});

describe("metadata logging", () => {
  it("strips credentials from diagnostic text and caps its length", () => {
    expect(sanitize("key sk-abcdef123456 leaked")).toBe("key sk-*** leaked");
    expect(sanitize("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer ***");
    expect(sanitize("x".repeat(300), 20)).toHaveLength(20);
    expect(sanitize(null)).toBe("");
  });

  it("writes one JSON line per call without bodies or keys", async () => {
    const dir = await tempDir();
    const log = new MetadataLog({ dir });
    await log.write(
      requestRecord({
        ts: "2026-11-20T10:00:00.000Z",
        rid: "rid-1",
        org: "org-1",
        user: "user-1",
        task: "task-1",
        provider: "fake",
        model: "gpt-4o",
        status: 200,
        code: null,
        latencyMs: 12,
        in: 10,
        out: 5,
        cost: 0.0001,
      }),
    );
    const text = await readFile(join(dir, "requests.log"), "utf8");
    const record = JSON.parse(text.trim());
    expect(record).toEqual({
      ts: "2026-11-20T10:00:00.000Z",
      rid: "rid-1",
      org: "org-1",
      user: "user-1",
      task: "task-1",
      provider: "fake",
      model: "gpt-4o",
      status: 200,
      code: null,
      latencyMs: 12,
      in: 10,
      out: 5,
      cost: 0.0001,
    });
    expect(text).not.toContain("sk-abcdef");
    expect(text).not.toContain("Bearer");
  });

  it("rotates by UTC day, keeps 30 days and aggregates a day", async () => {
    const dir = await tempDir();
    let clock = new Date("2026-11-20T23:00:00Z");
    const log = new MetadataLog({ dir, clock: () => clock });
    await log.write({ ts: "2026-11-20T23:00:00.000Z", org: "o", in: 10, out: 5, cost: 0.1, status: 200 });
    clock = new Date("2026-11-21T00:00:01Z");
    await log.write({ ts: "2026-11-21T00:00:01.000Z", org: "o", in: 20, out: 7, cost: 0.2, status: 200 });
    clock = new Date("2026-11-22T00:00:01Z");
    await log.write({ ts: "2026-11-22T00:00:01.000Z", org: "o", in: 1, out: 1, cost: 0.3, status: 200 });

    const names = await readdir(dir);
    expect(names).toContain("requests-2026-11-20.log");
    expect(names).toContain("requests-2026-11-21.log");
    const usage = await usageFromLogs({ dir, day: "2026-11-20", org: "o" });
    expect(usage).toMatchObject({ day: "2026-11-20", org: "o", requests: 1, tokens: 15 });
    expect(usage.cost).toBeCloseTo(0.1);
    const other = await usageFromLogs({ dir, day: "2026-11-21", org: "other" });
    expect(other.requests).toBe(0);
  });

  it("tails records with org and error filters", async () => {
    const dir = await tempDir();
    const log = new MetadataLog({ dir });
    await log.write({ ts: "2026-11-20T10:00:00.000Z", org: "a", status: 200, rid: "1" });
    await log.write({ ts: "2026-11-20T10:00:01.000Z", org: "a", status: 502, rid: "2" });
    await log.write({ ts: "2026-11-20T10:00:02.000Z", org: "b", status: 200, rid: "3" });
    expect((await log.recent({ org: "a" })).map((record) => record.rid)).toEqual(["1", "2"]);
    expect((await log.recent({ status: "error" })).map((record) => record.rid)).toEqual(["2"]);
    expect((await log.recent({ limit: 1 })).map((record) => record.rid)).toEqual(["3"]);
  });

  it("keeps an operator journal without the admin token", async () => {
    const dir = await tempDir();
    const log = new AdminLog({ dir });
    await log.append({ action: "kill", target: "org:1", reason: "Bearer abc", actor: "127.0.0.1" });
    const text = await readFile(join(dir, "admin.log"), "utf8");
    const record = JSON.parse(text.trim());
    expect(record).toMatchObject({ action: "kill", target: "org:1", reason: "Bearer ***" });
    expect(text).not.toContain("Bearer abc");
  });
});
