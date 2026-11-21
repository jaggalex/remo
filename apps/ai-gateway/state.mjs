/**
 * Operator state: kill switches, temporary limit overrides and daily usage
 * (`spec/ai-gateway.md` §4.2).
 *
 * The file changes without a deploy, so it is separate from `config.json` and written
 * atomically: a crash can lose at most the last minute of counters, never leave a torn
 * JSON file. The day key is UTC, so every installation rolls over at the same instant.
 */
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

const SCOPES = new Set(["global", "provider", "org", "user"]);

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function emptyState(now = new Date()) {
  return {
    kill: { global: { on: false }, provider: {}, org: {}, user: {} },
    limitOverrides: { org: {} },
    usage: {
      day: utcDay(now),
      org: {},
      user: {},
      // Token counters keep the documented number shape. Cost needs a second map because
      // one number cannot say both how many tokens and how much money a day used.
      cost: { global: 0, org: {} },
    },
  };
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberMap(value) {
  const out = {};
  if (!plainObject(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry) && entry >= 0) out[key] = entry;
  }
  return out;
}

function killMap(value) {
  const out = {};
  if (!plainObject(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (plainObject(entry) && entry.on === true) {
      out[key] = {
        on: true,
        ...(typeof entry.reason === "string" && entry.reason ? { reason: entry.reason } : {}),
        ...(typeof entry.until === "string" && entry.until ? { until: entry.until } : {}),
      };
    }
  }
  return out;
}

function normalize(raw, now) {
  const state = emptyState(now);
  if (!plainObject(raw)) return state;
  if (plainObject(raw.kill)) {
    state.kill.global = plainObject(raw.kill.global) ? raw.kill.global : { on: false };
    state.kill.provider = killMap(raw.kill.provider);
    state.kill.org = killMap(raw.kill.org);
    state.kill.user = killMap(raw.kill.user);
  }
  if (plainObject(raw.limitOverrides?.org)) {
    for (const [id, patch] of Object.entries(raw.limitOverrides.org)) {
      if (!plainObject(patch)) continue;
      const entry = {};
      if (Number.isInteger(patch.rpm) && patch.rpm > 0) entry.rpm = patch.rpm;
      if (Number.isInteger(patch.tokensPerDay) && patch.tokensPerDay > 0) {
        entry.tokensPerDay = patch.tokensPerDay;
      }
      if (Object.keys(entry).length) state.limitOverrides.org[id] = entry;
    }
  }
  if (plainObject(raw.usage)) {
    // An older day's counters are never mixed into today's budget.
    state.usage.day = typeof raw.usage.day === "string" ? raw.usage.day : state.usage.day;
    state.usage.org = numberMap(raw.usage.org);
    state.usage.user = numberMap(raw.usage.user);
    const cost = raw.usage.cost;
    if (plainObject(cost)) {
      state.usage.cost.global =
        typeof cost.global === "number" && cost.global >= 0 ? cost.global : 0;
      state.usage.cost.org = numberMap(cost.org);
    }
  }
  return state;
}

function assertScope(scope) {
  if (!SCOPES.has(scope)) throw new Error(`unknown kill switch scope "${scope}"`);
}

/**
 * One state file, loaded once at start and flushed by the server once a minute and on
 * shutdown. Mutations are synchronous and cheap; persistence is explicit so a request
 * never waits for the disk.
 */
export class StateStore {
  constructor(file, { now = () => new Date(), logger = console, autosaveMs = 0 } = {}) {
    this.file = file;
    this.now = now;
    this.logger = logger;
    this.state = emptyState(now());
    this.dirty = false;
    this.version = 0;
    this.saving = Promise.resolve();
    this.timer = null;
    this.autosaveMs = autosaveMs;
  }

  async load() {
    let raw;
    try {
      raw = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.error?.(`state file ${this.file} is unreadable (${error.message}); using defaults`);
      }
      this.state = emptyState(this.now());
      this.dirty = false;
      return this.state;
    }
    this.state = normalize(raw, this.now());
    this.ensureDay();
    this.dirty = false;
    return this.state;
  }

  /** Start the UTC day afresh when the clock crossed midnight. */
  ensureDay() {
    const day = utcDay(this.now());
    if (this.state.usage.day === day) return false;
    this.state.usage.day = day;
    this.state.usage.org = {};
    this.state.usage.user = {};
    this.state.usage.cost = { global: 0, org: {} };
    this.touch();
    return true;
  }

  /** A deep copy for readers; it also performs the lazy midnight rollover. */
  snapshot() {
    this.ensureDay();
    return structuredClone(this.state);
  }

  touch() {
    this.version += 1;
    this.dirty = true;
    if (this.autosaveMs > 0) this.#schedule();
  }

  #schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.autosaveMs);
    this.timer.unref?.();
  }

  /** `{on, reason?, until?}` while the switch is active; expired `until` clears itself. */
  killInfo(scope, id = null) {
    assertScope(scope);
    this.ensureDay();
    const entry =
      scope === "global" ? this.state.kill.global : this.state.kill[scope]?.[String(id)];
    if (!entry || entry.on !== true) return null;
    if (entry.until && Date.parse(entry.until) <= this.now().getTime()) {
      if (scope === "global") this.state.kill.global = { on: false };
      else delete this.state.kill[scope][String(id)];
      this.touch();
      return null;
    }
    return entry;
  }

  setKill(scope, id, { reason = "", until = null } = {}) {
    assertScope(scope);
    const entry = { on: true };
    if (reason) entry.reason = String(reason).slice(0, 500);
    if (until) {
      const time = Date.parse(until);
      if (!Number.isFinite(time)) throw new Error("until must be an ISO timestamp");
      entry.until = new Date(time).toISOString();
    }
    if (scope === "global") this.state.kill.global = entry;
    else {
      this.state.kill[scope] ??= {};
      this.state.kill[scope][String(id)] = entry;
    }
    this.touch();
    return entry;
  }

  unsetKill(scope, id = null) {
    assertScope(scope);
    if (scope === "global") this.state.kill.global = { on: false };
    else if (this.state.kill[scope]) delete this.state.kill[scope][String(id)];
    this.touch();
  }

  setLimitOverride(org, { rpm, tokensPerDay } = {}) {
    const id = String(org);
    const entry = { ...(this.state.limitOverrides.org[id] ?? {}) };
    if (rpm !== undefined) {
      if (!Number.isInteger(rpm) || rpm < 1) throw new Error("rpm must be a positive integer");
      entry.rpm = rpm;
    }
    if (tokensPerDay !== undefined) {
      if (!Number.isInteger(tokensPerDay) || tokensPerDay < 1) {
        throw new Error("tokensPerDay must be a positive integer");
      }
      entry.tokensPerDay = tokensPerDay;
    }
    this.state.limitOverrides.org[id] = entry;
    this.touch();
    return entry;
  }

  clearLimitOverride(org) {
    delete this.state.limitOverrides.org[String(org)];
    this.touch();
  }

  /** Counts a successful call after the provider answered. */
  addUsage({ org, user, tokens = 0, cost = 0 } = {}) {
    this.ensureDay();
    const tokenCount = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
    const money = Number.isFinite(cost) && cost > 0 ? cost : 0;
    if (org) {
      this.state.usage.org[String(org)] = (this.state.usage.org[String(org)] ?? 0) + tokenCount;
      this.state.usage.cost.org[String(org)] =
        (this.state.usage.cost.org[String(org)] ?? 0) + money;
    }
    if (user) {
      this.state.usage.user[String(user)] = (this.state.usage.user[String(user)] ?? 0) + tokenCount;
    }
    this.state.usage.cost.global += money;
    this.touch();
  }

  limitsFor(org) {
    return this.state.limitOverrides.org[String(org)] ?? null;
  }

  /** Write the current state atomically, serialising concurrent flushes. */
  flush() {
    this.saving = this.saving.then(() => this.#write()).catch((error) => {
      this.logger.error?.(`state flush failed: ${error.message}`);
    });
    return this.saving;
  }

  async #write() {
    if (!this.dirty) return;
    const version = this.version;
    const text = `${JSON.stringify(this.state)}\n`;
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.file);
    if (version === this.version) this.dirty = false;
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}
