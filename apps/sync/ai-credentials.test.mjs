import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAiConfig } from "./ai-credentials.mjs";
import { anchorAiLogs } from "./ai-anchor.mjs";
import { encryptSecret } from "./secrets.mjs";

const kek = { key: Buffer.alloc(32, 3), id: "v1" };
const secret = "sk-test-value";

function credential(id, scope, scopeId, overrides = {}) {
  const encrypted = encryptSecret(secret, {
    scope,
    scopeId,
    provider: "openrouter",
    id,
    kek,
  });
  return {
    id,
    scope,
    scope_id: scopeId,
    provider: "openrouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    fingerprint: "fp-" + id,
    state: "active",
    ...encrypted,
    ...overrides,
  };
}

function storeWith({ policy = {}, rows = [], defaults = {} } = {}) {
  const touched = [];
  return {
    touched,
    getAiPolicy: async () => ({ keyMode: "either", providers: [], models: [], ...policy }),
    getAiCredential: async (id) => rows.find((row) => row.id === id) ?? null,
    getDefaultAiCredential: async (scope, scopeId) =>
      rows.find(
        (row) =>
          row.scope === scope &&
          row.scope_id === scopeId &&
          row.id === defaults[`${scope}:${scopeId}`],
      ) ?? null,
    touchAiCredential: async (id) => touched.push(id),
  };
}

describe("resolveAiConfig", () => {
  it("prefers the task key, then the agent key", async () => {
    const store = storeWith({
      rows: [credential("task", "user", "u1"), credential("agent", "user", "u1")],
    });
    const task = await resolveAiConfig({
      store,
      orgId: "o1",
      ownerId: "u1",
      task: { credential_id: "task" },
      agent: { credential_id: "agent" },
      kek,
    });
    expect(task).toMatchObject({ apiKey: secret, credentialId: "task", source: "task" });

    const agent = await resolveAiConfig({
      store,
      orgId: "o1",
      ownerId: "u1",
      agent: { credential_id: "agent" },
      kek,
    });
    expect(agent.credentialId).toBe("agent");
  });

  it("falls back to personal then organisation defaults", async () => {
    const store = storeWith({
      rows: [credential("personal", "user", "u1"), credential("org", "org", "o1")],
      defaults: { "user:u1": "personal", "org:o1": "org" },
    });
    const personal = await resolveAiConfig({ store, orgId: "o1", ownerId: "u1", kek });
    expect(personal.credentialId).toBe("personal");

    const orgOnly = storeWith({
      policy: { keyMode: "org" },
      rows: [credential("personal", "user", "u1"), credential("org", "org", "o1")],
      defaults: { "user:u1": "personal", "org:o1": "org" },
    });
    const org = await resolveAiConfig({ store: orgOnly, orgId: "o1", ownerId: "u1", kek });
    expect(org.credentialId).toBe("org");
  });

  it("refuses an explicit key that policy forbids instead of falling back", async () => {
    const store = storeWith({
      policy: { keyMode: "org" },
      rows: [credential("personal", "user", "u1"), credential("org", "org", "o1")],
      defaults: { "user:u1": "personal", "org:o1": "org" },
    });
    await expect(
      resolveAiConfig({ store, orgId: "o1", ownerId: "u1", task: { credential_id: "personal" }, kek }),
    ).rejects.toMatchObject({ code: "AI_CREDENTIAL_FORBIDDEN" });
  });

  it("applies provider and model allowlists", async () => {
    const store = storeWith({
      policy: { models: ["allowed-model"] },
      rows: [credential("org", "org", "o1", { model: "other" })],
      defaults: { "org:o1": "org" },
    });
    await expect(
      resolveAiConfig({ store, orgId: "o1", ownerId: "u1", agent: { model: "other" }, kek }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });

    const allowed = await resolveAiConfig({
      store,
      orgId: "o1",
      ownerId: "u1",
      agent: { model: "allowed-model" },
      kek,
    });
    expect(allowed.model).toBe("allowed-model");
  });

  it("uses the installation key as the last resort", async () => {
    const store = storeWith();
    const config = await resolveAiConfig({
      store,
      orgId: "o1",
      ownerId: "u1",
      env: {
        REMO_AI_API_KEY: "env-key",
        REMO_AI_MODEL: "env-model",
        REMO_AI_BASE_URL: "https://example.com/v1/",
      },
      kek,
    });
    expect(config).toMatchObject({
      apiKey: "env-key",
      model: "env-model",
      baseUrl: "https://example.com/v1",
      source: "env",
    });
  });

  it("fails cleanly without a key, a model, or a KEK", async () => {
    await expect(
      resolveAiConfig({ store: storeWith(), orgId: "o1", ownerId: "u1", env: {}, kek }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });

    const noModel = storeWith({
      rows: [credential("org", "org", "o1", { model: null })],
      defaults: { "org:o1": "org" },
    });
    await expect(
      resolveAiConfig({ store: noModel, orgId: "o1", ownerId: "u1", kek }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });

    const locked = storeWith({
      rows: [credential("org", "org", "o1")],
      defaults: { "org:o1": "org" },
    });
    await expect(
      resolveAiConfig({ store: locked, orgId: "o1", ownerId: "u1", kek: null, env: {} }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("reports a missing explicit credential", async () => {
    await expect(
      resolveAiConfig({
        store: storeWith(),
        orgId: "o1",
        ownerId: "u1",
        task: { credential_id: "gone" },
        kek,
      }),
    ).rejects.toMatchObject({ code: "AI_CREDENTIAL_MISSING" });
  });
});

describe("anchorAiLogs", () => {
  let dir = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("writes the head once and records where it went", async () => {
    dir = await mkdtemp(join(tmpdir(), "remo-anchor-"));
    const anchors = [];
    let head = { seq: 2, hash: "hash-2" };
    const store = {
      orgsWithAiRuns: async () => ["o1"],
      latestAiRun: async () => head,
      latestAiAnchor: async () => anchors[anchors.length - 1] ?? null,
      recordAiAnchor: async (row) => {
        anchors.push(row);
        return row;
      },
    };
    const env = { REMO_AI_ANCHOR_DIR: dir };
    const first = await anchorAiLogs({ store, env, log: { error() {} } });
    expect(first).toMatchObject({ skipped: false, anchored: 1 });
    const file = await readFile(join(dir, "o1.jsonl"), "utf8");
    expect(file).toContain('"hash":"hash-2"');

    const again = await anchorAiLogs({ store, env, log: { error() {} } });
    expect(again.anchored).toBe(0);

    head = { seq: 3, hash: "hash-3" };
    const third = await anchorAiLogs({ store, env, log: { error() {} } });
    expect(third.anchored).toBe(1);
    expect((await readFile(join(dir, "o1.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("does nothing when no destination is configured", async () => {
    const result = await anchorAiLogs({ store: {}, env: {}, log: { error() {} } });
    expect(result).toEqual({ skipped: true, anchored: 0 });
  });
});
