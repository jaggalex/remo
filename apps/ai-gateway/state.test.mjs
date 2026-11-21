import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore, utcDay } from "./state.mjs";

const dirs = [];

async function storeAt({ time = Date.parse("2026-11-20T10:00:00Z") } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "remo-gw-state-"));
  dirs.push(dir);
  let clock = time;
  const now = () => new Date(clock);
  const store = new StateStore(join(dir, "state.json"), { now });
  await store.load();
  return {
    dir,
    store,
    file: join(dir, "state.json"),
    advance(ms) {
      clock += ms;
    },
    setTime(value) {
      clock = value;
    },
  };
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true });
});

describe("operator state", () => {
  it("keeps a kill switch per scope and clears it when until passes", async () => {
    const { store, advance } = await storeAt();
    for (const [scope, id] of [
      ["provider", "openrouter"],
      ["org", "org-1"],
      ["user", "user-1"],
    ]) {
      store.setKill(scope, id, { reason: "incident" });
      expect(store.killInfo(scope, id)).toMatchObject({ on: true, reason: "incident" });
    }
    store.setKill("global", null, { reason: "everything" });
    expect(store.killInfo("global")).toMatchObject({ on: true, reason: "everything" });

    store.setKill("org", "timed", {
      until: new Date(Date.parse("2026-11-20T10:00:01Z")).toISOString(),
    });
    expect(store.killInfo("org", "timed")).toMatchObject({ on: true });
    advance(2000);
    expect(store.killInfo("org", "timed")).toBe(null);

    store.unsetKill("provider", "openrouter");
    expect(store.killInfo("provider", "openrouter")).toBe(null);
    store.unsetKill("global");
    expect(store.killInfo("global")).toBe(null);
  });

  it("persists kills, overrides and daily counters across a restart", async () => {
    const { store, file } = await storeAt();
    store.setKill("provider", "openrouter", { reason: "maintenance" });
    store.setLimitOverride("org-1", { rpm: 60, tokensPerDay: 5_000_000 });
    store.addUsage({ org: "org-1", user: "user-1", tokens: 1200, cost: 0.25 });
    await store.flush();

    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.usage.org["org-1"]).toBe(1200);
    expect(saved.kill.provider.openrouter.reason).toBe("maintenance");

    const loaded = new StateStore(file, { now: () => new Date("2026-11-20T11:00:00Z") });
    await loaded.load();
    expect(loaded.killInfo("provider", "openrouter")).toMatchObject({ on: true });
    expect(loaded.limitsFor("org-1")).toEqual({ rpm: 60, tokensPerDay: 5_000_000 });
    expect(loaded.snapshot().usage.org["org-1"]).toBe(1200);
    expect(loaded.snapshot().usage.user["user-1"]).toBe(1200);
    expect(loaded.snapshot().usage.cost.global).toBeCloseTo(0.25);
  });

  it("starts a new UTC day with empty counters", async () => {
    const { store, setTime } = await storeAt({
      time: Date.parse("2026-11-20T23:59:00Z"),
    });
    store.addUsage({ org: "org-1", user: "user-1", tokens: 100, cost: 1 });
    expect(store.snapshot().usage.day).toBe("2026-11-20");
    expect(store.snapshot().usage.org["org-1"]).toBe(100);

    setTime(Date.parse("2026-11-21T00:01:00Z"));
    const next = store.snapshot();
    expect(next.usage.day).toBe("2026-11-21");
    expect(next.usage.org).toEqual({});
    expect(next.usage.user).toEqual({});
    expect(next.usage.cost).toEqual({ global: 0, org: {} });
  });

  it("does not mix an old file day into today", async () => {
    const { store, file } = await storeAt();
    store.addUsage({ org: "org-1", user: "user-1", tokens: 10, cost: 0 });
    await store.flush();
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.usage.day = "2026-11-19";
    await writeFile(file, JSON.stringify(raw), "utf8");

    const loaded = new StateStore(file, { now: () => new Date("2026-11-20T10:00:00Z") });
    await loaded.load();
    expect(loaded.snapshot().usage.org).toEqual({});
    expect(utcDay(new Date("2026-11-20T23:00:00Z"))).toBe("2026-11-20");
  });
});
