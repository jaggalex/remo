/**
 * Limits (`spec/ai-gateway.md` §5.5).
 *
 * Three mechanisms, in the order the spec names them: a sliding one-minute window at
 * global, provider, organisation and user level; daily token budgets per organisation and
 * user; and a semaphore for concurrent upstream calls. The window and the semaphore are
 * in memory (a restart forgets at most one minute of request times), while the daily
 * counters live in `state.json`.
 */

/** A one-minute sliding window per key, with a clock the tests can move. */
export class RateWindow {
  constructor({ now = () => Date.now(), spanMs = 60_000 } = {}) {
    this.now = now;
    this.spanMs = spanMs;
    this.windows = new Map();
  }

  #fresh(key, nowMs) {
    const entries = this.windows.get(key);
    if (!entries) return [];
    while (entries.length && entries[0] <= nowMs - this.spanMs) entries.shift();
    if (!entries.length) this.windows.delete(key);
    return entries;
  }

  count(key, nowMs = this.now()) {
    return this.#fresh(key, nowMs).length;
  }

  /** A verdict without consuming a slot, so a later refusal does not spend the budget. */
  check(key, limit, nowMs = this.now()) {
    if (!Number.isFinite(limit) || limit <= 0) {
      return { ok: false, retryAfter: Math.ceil(this.spanMs / 1000) };
    }
    const entries = this.#fresh(key, nowMs);
    if (entries.length < limit) return { ok: true };
    const waitMs = entries[0] + this.spanMs - nowMs;
    return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  record(key, nowMs = this.now()) {
    const entries = this.#fresh(key, nowMs);
    entries.push(nowMs);
    this.windows.set(key, entries);
    return entries.length;
  }

  clear() {
    this.windows.clear();
  }
}

/**
 * A counting semaphore with a bounded wait. The wait is short by design: a queue in front
 * of a model call would only move latency around, while `503 GATEWAY_BUSY` tells sync to
 * retry later.
 */
export class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  get inflight() {
    return this.active;
  }

  acquire(timeoutMs) {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.#releaser());
    }
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        resolve(null);
      }, Math.max(1, timeoutMs));
      waiter.timer.unref?.();
      this.queue.push(waiter);
    });
  }

  #releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        // The slot passes directly to the waiter; `active` does not change.
        next.resolve(this.#releaser());
        return;
      }
      this.active = Math.max(0, this.active - 1);
    };
  }

  /** A reload may raise or lower the limit; waiters are admitted when capacity appears. */
  setLimit(limit) {
    this.limit = limit;
    while (this.active < this.limit && this.queue.length) {
      const next = this.queue.shift();
      clearTimeout(next.timer);
      this.active += 1;
      next.resolve(this.#releaser());
    }
  }
}

export function secondsUntilMidnight(now = new Date()) {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/**
 * The request-facing limit checks. `state` owns the daily counters and overrides; this
 * class owns the windows and the semaphore.
 */
export class Limits {
  constructor({ state, config, now = () => Date.now(), busyWaitMs = 2000 } = {}) {
    this.state = state;
    this.config = config;
    this.now = now;
    this.busyWaitMs = busyWaitMs;
    this.window = new RateWindow({ now });
    this.semaphore = new Semaphore(config.limits.concurrency);
  }

  setConfig(config) {
    this.config = config;
    if (this.semaphore.limit !== config.limits.concurrency) {
      this.semaphore.setLimit(config.limits.concurrency);
    }
  }

  get inflight() {
    return this.semaphore.inflight;
  }

  #orgOverride(org) {
    return this.state.limitsFor(org) ?? {};
  }

  /**
   * Check every window in the spec's order (global, provider, org, user). Recording only
   * happens when all four admit the request.
   */
  checkRate({ provider, org, user, nowMs = this.now() }) {
    const limits = this.config.limits;
    const override = this.#orgOverride(org);
    const checks = [
      { scope: "global", key: "global", limit: limits.global.rpm },
      { scope: "provider", key: `provider:${provider.id}`, limit: provider.rpm },
      { scope: "org", key: `org:${org}`, limit: override.rpm ?? limits.perOrg.rpm },
      { scope: "user", key: `user:${user}`, limit: limits.perUser.rpm },
    ];
    for (const check of checks) {
      const verdict = this.window.check(check.key, check.limit, nowMs);
      if (!verdict.ok) {
        return { ok: false, scope: check.scope, retryAfter: verdict.retryAfter };
      }
    }
    for (const check of checks) this.window.record(check.key, nowMs);
    return { ok: true };
  }

  /** Daily tokens are checked before the call; they are attributed after it. */
  checkDaily({ org, user, now = this.now() }) {
    const usage = this.state.snapshot().usage;
    const override = this.#orgOverride(org);
    const orgLimit = override.tokensPerDay ?? this.config.limits.perOrg.tokensPerDay;
    if (orgLimit != null && (usage.org[org] ?? 0) >= orgLimit) {
      return { ok: false, scope: "org", retryAfter: secondsUntilMidnight(new Date(now)) };
    }
    const userLimit = this.config.limits.perUser.tokensPerDay;
    if (userLimit != null && (usage.user[user] ?? 0) >= userLimit) {
      return { ok: false, scope: "user", retryAfter: secondsUntilMidnight(new Date(now)) };
    }
    return { ok: true };
  }

  /** The optional daily spend cap. Cost is a number in installation currency per million. */
  checkCost({ now = this.now() } = {}) {
    const limit = this.config.limits.global.costPerDay;
    if (limit == null) return { ok: true };
    const used = this.state.snapshot().usage.cost.global;
    if (used >= limit) {
      return { ok: false, scope: "global", retryAfter: secondsUntilMidnight(new Date(now)) };
    }
    return { ok: true };
  }

  /** Returns a release function, or null when the queue waited longer than `busyWaitMs`. */
  acquire() {
    return this.semaphore.acquire(this.busyWaitMs);
  }

  recordUsage({ org, user, tokens, cost }) {
    this.state.addUsage({ org, user, tokens, cost });
  }
}
