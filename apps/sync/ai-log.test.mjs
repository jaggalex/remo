import { describe, expect, it } from "vitest";
import { canonicalJson, fromRow, hashRun, normalizeRun, verifyAiChain } from "./ai-log.mjs";

function row(seq, prevHash, overrides = {}) {
  const run = normalizeRun({
    orgId: "o1",
    seq,
    prevHash,
    agentId: "a1",
    taskId: `t${seq}`,
    ownerId: "u1",
    boardId: "b1",
    skill: "diagram",
    skillVersion: 1,
    capabilities: ["board.edit", "board.read"],
    aclVersion: 3,
    provider: "openrouter",
    model: "m",
    credentialId: "c1",
    keyFingerprint: "abc",
    temperature: 0.2,
    maxTokens: 100,
    toolset: ["write_diagram", "read_board"],
    promptHash: "p",
    inputObjectIds: ["s2", "s1"],
    promptTokens: 10,
    completionTokens: 5,
    costUsd: 0.001,
    latencyMs: 50,
    status: "ok",
    startedAt: "2026-10-26T10:00:00.000Z",
    finishedAt: "2026-10-26T10:00:00.050Z",
    ...overrides,
  });
  return {
    org_id: run.orgId,
    seq: run.seq,
    prev_hash: run.prevHash,
    agent_id: run.agentId,
    task_id: run.taskId,
    owner_id: run.ownerId,
    board_id: run.boardId,
    skill: run.skill,
    skill_version: run.skillVersion,
    capabilities: run.capabilities,
    acl_version: run.aclVersion,
    provider: run.provider,
    model: run.model,
    credential_id: run.credentialId,
    key_fingerprint: run.keyFingerprint,
    temperature: run.temperature,
    max_tokens: run.maxTokens,
    toolset: run.toolset,
    prompt_hash: run.promptHash,
    input_object_ids: run.inputObjectIds,
    prompt_tokens: run.promptTokens,
    completion_tokens: run.completionTokens,
    cost_usd: run.costUsd,
    latency_ms: run.latencyMs,
    status: run.status,
    error_code: run.errorCode,
    error_message: run.errorMessage,
    request_id: run.requestId,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    hash: hashRun(run),
  };
}

describe("canonical JSON", () => {
  it("sorts keys and ignores undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] }, z: undefined })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
  });
});

describe("ai run chain", () => {
  it("verifies an intact chain", () => {
    const first = row(1, "");
    const second = row(2, first.hash);
    expect(verifyAiChain([first, second])).toMatchObject({ ok: true, checked: 2 });
  });

  it("detects an edited row, a wrong previous hash and a gap", () => {
    const first = row(1, "");
    const second = row(2, first.hash);
    const tampered = { ...second, model: "other" };
    expect(verifyAiChain([first, tampered])).toMatchObject({ ok: false, reason: "HASH" });

    const wrongPrev = row(2, "not-the-hash");
    expect(verifyAiChain([first, wrongPrev])).toMatchObject({ ok: false, reason: "PREV_HASH" });

    const gap = row(3, first.hash);
    expect(verifyAiChain([first, gap])).toMatchObject({ ok: false, reason: "GAP" });
  });

  it("normalizes order-insensitive arrays", () => {
    const a = normalizeRun({
      orgId: "o",
      seq: 1,
      capabilities: ["b", "a"],
      toolset: ["y", "x"],
      inputObjectIds: ["2", "1"],
    });
    const b = normalizeRun({
      orgId: "o",
      seq: 1,
      capabilities: ["a", "b"],
      toolset: ["x", "y"],
      inputObjectIds: ["1", "2"],
    });
    expect(hashRun(a)).toBe(hashRun(b));
    expect(fromRow(row(1, "", { capabilities: ["a", "b"] })).capabilities).toEqual([
      "a",
      "b",
    ]);
  });
});
