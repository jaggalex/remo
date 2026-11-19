/**
 * Which provider key and model a task uses.
 *
 * The order is explicit: task → agent → owner default → organisation default → the
 * installation's environment key. An explicit choice that is not allowed fails the task
 * instead of silently falling back; defaults that the policy forbids are skipped so a
 * personal key cannot override an "organisation only" policy.
 *
 * The secret is decrypted here and nowhere else. Callers get a key in memory for the
 * duration of one model call; nothing returns it to a client.
 */
import { AiError } from "./ai.mjs";
import { SecretError, decryptSecret, fingerprintSecret, kekFromEnv } from "./secrets.mjs";

function policyAllows({ policy, row, scopeId, model }) {
  const mode = policy?.keyMode ?? "either";
  if (mode === "org" && row.scope !== "org") return false;
  if (mode === "personal" && row.scope !== "user") return false;
  if (row.scope === "org" && row.scope_id !== scopeId.orgId) return false;
  if (row.scope === "user" && row.scope_id !== scopeId.ownerId) return false;
  const providers = policy?.providers ?? [];
  if (providers.length && !providers.includes(row.provider)) return false;
  const models = policy?.models ?? [];
  if (models.length && !models.includes(model)) return false;
  return true;
}

/**
 * @returns {Promise<{apiKey: string, baseUrl: string, model: string, provider: string,
 *   credentialId: string|null, keyFingerprint: string, source: string}>}
 */
export async function resolveAiConfig({
  store,
  orgId,
  ownerId,
  task = {},
  agent = {},
  env = process.env,
  kek = null,
}) {
  const policy = await store.getAiPolicy(orgId);
  const key = kek ?? kekFromEnv(env);
  const scopeId = { orgId, ownerId };

  const explicit = [];
  if (task.credential_id) explicit.push({ id: task.credential_id, source: "task" });
  if (agent.credential_id) explicit.push({ id: agent.credential_id, source: "agent" });

  for (const candidate of explicit) {
    const row = await store.getAiCredential(candidate.id);
    if (!row) {
      throw new AiError("AI_CREDENTIAL_MISSING", `the ${candidate.source} key no longer exists`);
    }
    const model = task.model ?? agent.model ?? row.model ?? "";
    if (!model) throw new AiError("AI_MODEL_REQUIRED", "choose a model for this key");
    if (!policyAllows({ policy, row, scopeId, model })) {
      throw new AiError(
        "AI_CREDENTIAL_FORBIDDEN",
        `the ${candidate.source} key is not allowed by the organisation policy`,
      );
    }
    if (!key) throw new AiError("AI_CREDENTIALS_LOCKED", "the key-encryption key is not configured");
    let apiKey;
    try {
      apiKey = decryptSecret(row, { kek: key });
    } catch (error) {
      throw new AiError(
        error instanceof SecretError ? error.code : "AI_CREDENTIAL_UNREADABLE",
        error.message,
      );
    }
    await store.touchAiCredential(row.id).catch(() => {});
    return {
      apiKey,
      baseUrl: row.base_url,
      model,
      provider: row.provider,
      credentialId: row.id,
      keyFingerprint: row.fingerprint,
      source: candidate.source,
    };
  }

  const defaults = [];
  if ((policy?.keyMode ?? "either") !== "org") {
    const row = await store.getDefaultAiCredential("user", ownerId);
    if (row) defaults.push({ row, source: "user" });
  }
  if ((policy?.keyMode ?? "either") !== "personal") {
    const row = await store.getDefaultAiCredential("org", orgId);
    if (row) defaults.push({ row, source: "org" });
  }

  for (const { row, source } of defaults) {
    const model = task.model ?? agent.model ?? row.model ?? "";
    if (!model) continue;
    if (!policyAllows({ policy, row, scopeId, model })) continue;
    if (!key) continue;
    let apiKey;
    try {
      apiKey = decryptSecret(row, { kek: key });
    } catch {
      continue;
    }
    await store.touchAiCredential(row.id).catch(() => {});
    return {
      apiKey,
      baseUrl: row.base_url,
      model,
      provider: row.provider,
      credentialId: row.id,
      keyFingerprint: row.fingerprint,
      source,
    };
  }

  // The installation key is a bootstrap for single-tenant deployments and development.
  const envKey = env.REMO_AI_API_KEY;
  const envModel = task.model ?? agent.model ?? env.REMO_AI_MODEL;
  if (envKey && envModel) {
    return {
      apiKey: envKey,
      baseUrl: String(env.REMO_AI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      model: envModel,
      provider: "env",
      credentialId: null,
      keyFingerprint: fingerprintSecret(envKey),
      source: "env",
    };
  }

  throw new AiError(
    "AI_NOT_CONFIGURED",
    "no provider key is available: add one in the organisation or use the installation key",
  );
}
