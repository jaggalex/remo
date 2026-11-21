/**
 * Metadata-only logging (`spec/ai-gateway.md` §7).
 *
 * Two files: `requests.log`, one JSON line per model call, and `admin.log`, one JSON line
 * per operator action. Nothing else is written: no bodies, no keys, no provider error
 * text. `sanitize` exists for the stderr paths, where an exception message might carry a
 * fragment of a request.
 */
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Remove the two shapes a leaked credential most often takes, then cap the result. This
 * is defence in depth; the request log never receives free text in the first place.
 */
export function sanitize(value, limit = 200) {
  if (value == null) return "";
  let text = String(value);
  text = text.replace(/\bsk-[A-Za-z0-9_-]{4,}/g, "sk-***");
  text = text.replace(/\bBearer\s+[^\s"',;}]+/gi, "Bearer ***");
  text = text.replace(/((?:api[_-]?key|token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1***");
  if (text.length > limit) text = `${text.slice(0, Math.max(0, limit - 1))}…`;
  return text;
}

/** One request record, in the documented field order. */
export function requestRecord({
  ts,
  rid,
  org,
  user,
  task,
  provider,
  model,
  status,
  code,
  latencyMs,
  in: input,
  out,
  cost,
}) {
  return {
    ts,
    rid,
    org,
    user,
    task,
    provider,
    model,
    status,
    code: code ?? null,
    latencyMs,
    in: input,
    out,
    cost,
  };
}

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Append-only JSONL with daily rotation. `requests.log` is always the current day's file;
 * when the clock enters a new day the old file is renamed to `requests-<day>.log`.
 */
export class MetadataLog {
  constructor({ dir, clock = () => new Date(), logger = console, retentionDays = 30 } = {}) {
    this.dir = dir;
    this.file = join(dir, "requests.log");
    this.clock = clock;
    this.logger = logger;
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    this.day = dayOf(clock());
    this.chain = Promise.resolve();
  }

  write(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    this.chain = this.chain
      .then(async () => {
        await this.#rotateIfNeeded();
        await mkdir(this.dir, { recursive: true });
        await appendFile(this.file, line, { mode: 0o600 });
      })
      .catch((error) => {
        this.logger.error?.(`request log write failed: ${error.message}`);
      });
    return this.chain;
  }

  async #rotateIfNeeded() {
    const day = dayOf(this.clock());
    if (day === this.day) return;
    try {
      await rename(this.file, join(this.dir, `requests-${this.day}.log`));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.day = day;
    await this.#prune();
  }

  async #prune() {
    let entries;
    try {
      entries = await readdir(this.dir);
    } catch {
      return;
    }
    const now = this.clock().getTime();
    for (const name of entries) {
      if (!/^requests-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const path = join(this.dir, name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs > this.retentionMs) await unlink(path);
      } catch {
        // A file another process removed is already pruned.
      }
    }
  }

  /** Recent records, newest last, for `remo-gw tail`. */
  async recent({ limit = 100, org = null, status = null } = {}) {
    await this.chain;
    const files = await this.#files();
    const records = [];
    for (const file of files) {
      let text;
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (org && record.org !== org) continue;
        if (status === "error" && !(record.status >= 400)) continue;
        if (status && status !== "error" && String(record.status) !== String(status)) continue;
        records.push(record);
      }
    }
    return records.slice(-limit);
  }

  async #files() {
    let names;
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name === "requests.log" || /^requests-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort()
      .map((name) => join(this.dir, name));
  }
}

/** Sum tokens and cost from the request log for one UTC day, optionally one org. */
export async function usageFromLogs({ dir, day, org = null }) {
  const files = (await readdir(dir).catch(() => []))
    .filter((name) => name === "requests.log" || /^requests-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .sort()
    .map((name) => join(dir, name));
  const total = { day, org, requests: 0, tokens: 0, cost: 0 };
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof record.ts !== "string" || !record.ts.startsWith(day)) continue;
      if (org && record.org !== org) continue;
      total.requests += 1;
      total.tokens += (record.in ?? 0) + (record.out ?? 0);
      total.cost += record.cost ?? 0;
    }
  }
  return total;
}

/** The operator journal: who changed what, when and why. */
export class AdminLog {
  constructor({ dir, clock = () => new Date(), logger = console } = {}) {
    this.dir = dir;
    this.file = join(dir, "admin.log");
    this.clock = clock;
    this.logger = logger;
    this.chain = Promise.resolve();
  }

  append({ action, actor = "local", target = null, reason = null, params = null }) {
    const entry = {
      ts: this.clock().toISOString(),
      actor,
      action,
      target,
      reason: reason ? sanitize(reason, 500) : null,
      params: params ?? null,
    };
    const line = `${JSON.stringify(entry)}\n`;
    this.chain = this.chain
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        await appendFile(this.file, line, { mode: 0o600 });
      })
      .catch((error) => {
        this.logger.error?.(`admin log write failed: ${error.message}`);
      });
    return this.chain;
  }
}
