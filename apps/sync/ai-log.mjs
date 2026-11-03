/**
 * The evidential journal: one hash-chained row per model call.
 *
 * The chain makes silent edits detectable; the external anchor (a file or an endpoint
 * outside the database) makes a rewrite of the whole chain detectable too. Neither says
 * the provider told the truth — it says our record of the call has not changed since it
 * was written.
 */
import { createHash } from "node:crypto";

/** Deterministic JSON: sorted keys, undefined omitted. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return value === null || value === undefined ? null : String(value);
}

/** The exact shape that is hashed; both insert and verify use it. */
export function normalizeRun(input) {
  return {
    orgId: String(input.orgId),
    seq: number(input.seq),
    prevHash: String(input.prevHash ?? ""),
    agentId: text(input.agentId),
    taskId: text(input.taskId),
    ownerId: text(input.ownerId),
    boardId: text(input.boardId),
    skill: text(input.skill),
    skillVersion: input.skillVersion == null ? null : number(input.skillVersion),
    capabilities: [...(input.capabilities ?? [])].map(String).sort(),
    aclVersion: input.aclVersion == null ? null : number(input.aclVersion),
    provider: text(input.provider),
    model: text(input.model),
    credentialId: text(input.credentialId),
    keyFingerprint: text(input.keyFingerprint),
    temperature: input.temperature == null ? null : number(input.temperature),
    maxTokens: input.maxTokens == null ? null : number(input.maxTokens),
    toolset: [...(input.toolset ?? [])].map(String).sort(),
    promptHash: text(input.promptHash),
    inputObjectIds: [...(input.inputObjectIds ?? [])].map(String).sort(),
    promptTokens: number(input.promptTokens),
    completionTokens: number(input.completionTokens),
    costUsd: Number(number(input.costUsd).toFixed(8)),
    latencyMs: input.latencyMs == null ? null : number(input.latencyMs),
    status: String(input.status ?? "unknown"),
    errorCode: text(input.errorCode),
    errorMessage: text(input.errorMessage),
    requestId: text(input.requestId),
    startedAt: iso(input.startedAt),
    finishedAt: iso(input.finishedAt),
  };
}

export function hashRun(run) {
  return createHash("sha256").update(canonicalJson(run)).digest("hex");
}

export function fromRow(row) {
  return normalizeRun({
    orgId: row.org_id,
    seq: row.seq,
    prevHash: row.prev_hash,
    agentId: row.agent_id,
    taskId: row.task_id,
    ownerId: row.owner_id,
    boardId: row.board_id,
    skill: row.skill,
    skillVersion: row.skill_version,
    capabilities: row.capabilities,
    aclVersion: row.acl_version,
    provider: row.provider,
    model: row.model,
    credentialId: row.credential_id,
    keyFingerprint: row.key_fingerprint,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    toolset: row.toolset,
    promptHash: row.prompt_hash,
    inputObjectIds: row.input_object_ids,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    requestId: row.request_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

/** Recompute a chain of rows ordered by seq. */
export function verifyAiChain(rows) {
  let previous = "";
  let expected = 1;
  for (const row of rows) {
    const run = fromRow(row);
    if (run.seq !== expected) {
      return { ok: false, brokenAt: run.seq, reason: "GAP", checked: expected - 1 };
    }
    if (run.prevHash !== previous) {
      return { ok: false, brokenAt: run.seq, reason: "PREV_HASH", checked: expected - 1 };
    }
    const hash = hashRun(run);
    if (hash !== row.hash) {
      return { ok: false, brokenAt: run.seq, reason: "HASH", checked: expected - 1 };
    }
    previous = row.hash;
    expected += 1;
  }
  return { ok: true, brokenAt: null, reason: null, checked: rows.length, lastHash: previous };
}
