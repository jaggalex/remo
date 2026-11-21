import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Limits, RateWindow, Semaphore } from "./limits.mjs";
import { validateConfig } from "./registry.mjs";
import { StateStore } from "./state.mjs";

const dirs = [];

function config(overrides = {}) {
  const raw = {
    region: "eu",
    listen: "127.0.0.1:0",
    admin: "127.0.0.1:0",
    limits: {
      concurrency: 2,
      perOrg: { rpm: 10, tokensPerDay: 10_000 },
      perUser: { rpm: 10, tokensPerDay: 10_000 },
      global: { rpm: 100 },
    },
    providers: [
      {
        id: "fake",
        baseUrl: "https://provider.test/v1",
        models: ["*"],
        regions: ["eu"],
        rpm: 100,
        byok: true,
      },
    ],
    ...overrides,
  };
  return validateConfig(raw);
}

async function harness({ cfg = config(), time = Date.parse("2026-11-20T10:00:00Z") } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "remo-gw-limits-"));
  dirs.push(dir);
  let clock = time;
  const nowDate = () => new Date(clock);
  const state = new StateStore(join(dir, "state.json"), { now: nowDate });
  await state.load();
  const limits = new Limits({ state, config: cfg, now: () => clock, busyWaitMs: 20 });
  return {
    state,
    limits,
    cfg,
    advance(ms) {
      clock += ms;
    },
    setTime(value) {
      clock = value;
    },
    provider: cfg.providers[0],
  };
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true });
});

describe("rate windows", () => {
  it("is a one-minute sliding window and reports a Retry-After", () => {
    let now = 0;
    const window = new RateWindow({ now: () => now, spanMs: 60_000 });
    expect(window.check("k", 2, now).ok).toBe(true);
    window.record("k", now);
    window.record("k", now);
    const refused = window.check("k", 2, now);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBe(60);
    now = 30_000;
    expect(window.check("k", 2, now).retryAfter).toBe(30);
    now = 60_001;
    expect(window.check("k", 2, now).ok).toBe(true);
  });

  it("enforces global, provider, org and user levels", async () => {
    const cfg = config({
      limits: {
        concurrency: 2,
        perOrg: { rpm: 2, tokensPerDay: 10_000 },
        perUser: { rpm: 10, tokensPerDay: 10_000 },
        global: { rpm: 100 },
      },
    });
    const org = await harness({ cfg });
    const provider = org.provider;
    expect(org.limits.checkRate({ provider, org: "o", user: "u" }).ok).toBe(true);
    expect(org.limits.checkRate({ provider, org: "o", user: "u" }).ok).toBe(true);
    expect(org.limits.checkRate({ provider, org: "o", user: "u" })).toMatchObject({
      ok: false,
      scope: "org",
    });
  });

  it("never charges a window when another level refuses", async () => {
    const cfg = config({
      limits: {
        concurrency: 2,
        perOrg: { rpm: 10, tokensPerDay: 10_000 },
        perUser: { rpm: 1, tokensPerDay: 10_000 },
        global: { rpm: 100 },
      },
    });
    const { limits, provider } = await harness({ cfg });
    expect(limits.checkRate({ provider, org: "o", user: "u" }).ok).toBe(true);
    const refused = limits.checkRate({ provider, org: "o", user: "u" });
    expect(refused).toMatchObject({ ok: false, scope: "user" });
    // The org window stayed at one entry, so a second org is still admitted.
    expect(limits.checkRate({ provider, org: "o", user: "other" }).ok).toBe(true);
  });
});

describe("daily limits", () => {
  it("refuses an organisation whose token budget is spent and resets at midnight", async () => {
    const cfg = config({
      limits: {
        concurrency: 2,
        perOrg: { rpm: 100, tokensPerDay: 100 },
        perUser: { rpm: 100, tokensPerDay: 1000 },
        global: { rpm: 100 },
      },
    });
    const { limits, state, provider, setTime } = await harness({ cfg });
    state.addUsage({ org: "o", user: "u", tokens: 100, cost: 0 });
    expect(limits.checkDaily({ org: "o", user: "u" })).toMatchObject({ ok: false, scope: "org" });

    setTime(Date.parse("2026-11-21T00:00:30Z"));
    expect(limits.checkDaily({ org: "o", user: "u" }).ok).toBe(true);
    expect(limits.checkRate({ provider, org: "o", user: "u" }).ok).toBe(true);
  });

  it("counts the user budget separately and honours an org override", async () => {
    const cfg = config({
      limits: {
        concurrency: 2,
        perOrg: { rpm: 100, tokensPerDay: 100 },
        perUser: { rpm: 100, tokensPerDay: 50 },
        global: { rpm: 100 },
      },
    });
    const { limits, state } = await harness({ cfg });
    state.addUsage({ org: "o", user: "u", tokens: 50, cost: 0 });
    expect(limits.checkDaily({ org: "o", user: "u" })).toMatchObject({ ok: false, scope: "user" });
    state.setLimitOverride("o", { tokensPerDay: 1000 });
    expect(limits.checkDaily({ org: "o", user: "u" })).toMatchObject({ ok: false, scope: "user" });
    state.addUsage({ org: "o", user: "v", tokens: 0, cost: 0 });
    expect(limits.checkDaily({ org: "o", user: "v" }).ok).toBe(true);
  });

  it("refuses when the daily spend cap is reached and recovers the next day", async () => {
    const cfg = config({
      limits: {
        concurrency: 2,
        perOrg: { rpm: 100, tokensPerDay: 10_000 },
        perUser: { rpm: 100, tokensPerDay: 10_000 },
        global: { rpm: 100, costPerDay: 1 },
      },
    });
    const { limits, state, setTime } = await harness({ cfg });
    state.addUsage({ org: "o", user: "u", tokens: 10, cost: 1 });
    expect(limits.checkCost()).toMatchObject({ ok: false, scope: "global" });
    setTime(Date.parse("2026-11-21T00:00:01Z"));
    expect(limits.checkCost().ok).toBe(true);
  });
});

describe("the concurrency semaphore", () => {
  it("waits briefly, answers null on timeout and passes a released slot on", async () => {
    const semaphore = new Semaphore(1);
    const first = await semaphore.acquire(20);
    expect(first).toBeTypeOf("function");
    expect(await semaphore.acquire(20)).toBe(null);
    first();
    const second = await semaphore.acquire(20);
    expect(second).toBeTypeOf("function");
    second();
    expect(semaphore.inflight).toBe(0);
  });

  it("admits queued callers when a reload raises the limit", async () => {
    const semaphore = new Semaphore(1);
    const first = await semaphore.acquire(100);
    const waiting = semaphore.acquire(1000);
    semaphore.setLimit(2);
    const second = await waiting;
    expect(second).toBeTypeOf("function");
    first();
    second();
  });
});
