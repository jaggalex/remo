/**
 * One model call for an agent task: resolve the key, count the prompt, log the run.
 *
 * Kept apart from the skills so the evidential journal is written the same way for
 * every one of them (ADR-090, spec/AI-agents-v1.md §9). The caller decides whether the
 * answer is a diagram or a plan; this module never touches the board.
 *
 * In gateway mode (ADR-251) a stored key becomes `X-Remo-Upstream` + `X-Remo-Upstream-Key`
 * on the gateway request, so a BYOK key is still the user's and still never travels
 * outside the tunnel. A gateway we cannot reach fails the task; there is no direct call.
 */
import { createHash } from "node:crypto";
import { AiClient, gatewaySettings } from "./ai.mjs";
import { FAKE_PLAN_MODEL, fakeModelEnabled, fakePlanClient } from "./ai-fake.mjs";
import { resolveAiConfig } from "./ai-credentials.mjs";

export class AgentCallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentCallError";
    this.code = code;
  }
}

/** Provider names that are local labels rather than gateway registry ids. */
const NON_REGISTRY_PROVIDERS = new Set(["custom", "env", "gateway", "fake", "test"]);

/**
 * What `X-Remo-Upstream` names: a registry id for a known provider, the key's base URL
 * for a BYOK/custom key or an installation provider the gateway matches by address.
 */
function gatewayUpstream(providerInfo) {
  const provider = String(providerInfo?.provider ?? "");
  if (provider && !NON_REGISTRY_PROVIDERS.has(provider)) return provider;
  return String(providerInfo?.baseUrl ?? "").replace(/\/+$/, "");
}

export async function callAgentModel({
  store,
  task,
  agent,
  skill,
  prompt,
  budget,
  capabilities = [],
  aclVersion = 1,
  inputObjectIds = [],
  ai = null,
  env = process.env,
  now = Date.now,
  temperature = 0.2,
}) {
  const estimatedPrompt = Math.ceil((prompt.system.length + prompt.user.length) / 4);
  if (estimatedPrompt >= budget.maxTokens) {
    throw new AgentCallError("BUDGET_TOO_SMALL", `the prompt needs about ${estimatedPrompt} tokens`);
  }
  const maxOutput = Math.max(16, Math.min(budget.maxTokens - estimatedPrompt, 8000));
  const promptHash = createHash("sha256")
    .update(`${prompt.system}\n${prompt.user}`)
    .digest("hex");

  const gateway = gatewaySettings(env);
  const gatewayMode = Boolean(gateway.url);
  const failWith = (error) =>
    new AgentCallError(error?.code ?? "AI_NOT_CONFIGURED", error?.message ?? String(error));

  // Resolve the key and model only after all policy checks, and never log the secret.
  let client = null;
  let providerInfo = {
    source: "injected",
    provider: "test",
    model: "injected",
    credentialId: null,
    keyFingerprint: null,
  };
  // Browser acceptance uses a deterministic plan instead of a provider. The fake wins
  // over the service's real client, and is refused unless this is an e2e run on a
  // process that is not production.
  if (fakeModelEnabled(env)) {
    client = fakePlanClient();
    providerInfo = {
      source: "fake",
      provider: "fake",
      model: FAKE_PLAN_MODEL,
      credentialId: null,
      keyFingerprint: null,
    };
  } else if (gatewayMode) {
    // The key may live in the gateway, so the environment client is usable without one.
    // A stored credential still wins for the upstream headers, so BYOK keys keep working
    // through the gateway instead of being replaced by the installation key.
    let resolved = null;
    try {
      resolved = await resolveAiConfig({
        store,
        orgId: task.org_id,
        ownerId: agent.owner_id,
        task,
        agent,
        env,
      });
    } catch (error) {
      // Only "no key at all" falls back to the gateway's own key. An explicit key that
      // policy forbids must fail the task, not silently use another one.
      if (error?.code !== "AI_NOT_CONFIGURED") throw failWith(error);
    }
    providerInfo = resolved ?? {
      source: "gateway",
      provider: env.REMO_AI_API_KEY ? "env" : "gateway",
      baseUrl: String(env.REMO_AI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(
        /\/+$/,
        "",
      ),
      model: task.model ?? agent.model ?? env.REMO_AI_MODEL ?? "",
      credentialId: null,
      keyFingerprint: null,
    };
    // The service client may carry the installation model; a stored key with its own
    // model needs a client for that model, not the environment one.
    client =
      ai && ai.gatewayMode === true && ai.model === providerInfo.model
        ? ai
        : new AiClient({
            apiKey: providerInfo.apiKey ?? "",
            baseUrl: providerInfo.baseUrl ?? "",
            model: providerInfo.model,
            gateway,
          });
  } else if (ai && ai.configured !== false) {
    // The installation key is only a fallback. An unconfigured environment client must
    // not win over a key stored for the organisation (ADR-142).
    client = ai;
    providerInfo = {
      source: "env",
      provider: "env",
      model: ai.model ?? "",
      credentialId: null,
      keyFingerprint: null,
    };
  }
  if (!client) {
    try {
      providerInfo = await resolveAiConfig({
        store,
        orgId: task.org_id,
        ownerId: agent.owner_id,
        task,
        agent,
        env,
      });
    } catch (error) {
      throw failWith(error);
    }
    client = new AiClient({
      apiKey: providerInfo.apiKey,
      baseUrl: providerInfo.baseUrl,
      model: providerInfo.model,
    });
  }

  const startedCall = now();
  let completion = null;
  let latencyMs = 0;
  const logRun = async (status, extra = {}) => {
    if (typeof store.appendAiRun !== "function") return;
    await store.appendAiRun({
      orgId: task.org_id,
      agentId: task.agent_id,
      taskId: task.id,
      ownerId: agent.owner_id,
      boardId: task.board_id,
      skill: skill.slug,
      skillVersion: skill.version,
      capabilities,
      aclVersion: Number(aclVersion ?? 1),
      provider: providerInfo.provider,
      model: completion?.model ?? providerInfo.model,
      credentialId: providerInfo.credentialId,
      keyFingerprint: providerInfo.keyFingerprint,
      gatewayProvider: completion?.gatewayProvider ?? null,
      temperature,
      maxTokens: maxOutput,
      toolset: skill.tools ?? [],
      promptHash,
      inputObjectIds,
      promptTokens: completion?.usage?.promptTokens ?? 0,
      completionTokens: completion?.usage?.completionTokens ?? 0,
      costUsd: completion?.usage?.costUsd ?? 0,
      latencyMs,
      status,
      errorCode: extra.code ?? null,
      errorMessage: extra.message ?? null,
      requestId: completion?.requestId ?? null,
      startedAt: new Date(startedCall).toISOString(),
      finishedAt: new Date(now()).toISOString(),
    });
  };

  try {
    completion = await client.chatJson({
      system: prompt.system,
      user: prompt.user,
      maxTokens: maxOutput,
      temperature,
      ...(gatewayMode
        ? {
            gateway: {
              upstream: gatewayUpstream(providerInfo),
              upstreamKey: providerInfo.apiKey ?? "",
              orgId: task.org_id,
              userId: agent.owner_id,
              taskId: task.id,
            },
          }
        : {}),
    });
    latencyMs = Math.max(0, now() - startedCall);
  } catch (error) {
    latencyMs = Math.max(0, now() - startedCall);
    await logRun("failed", {
      code: error?.code ?? "AI_FAILED",
      message: skill.slug === "room-draft" ? null : error?.message ?? String(error),
    }).catch((logError) => {
      // A failed call that cannot be journaled is still a failed call: the task fails
      // on the provider error, not on the logging error.
      void logError;
    });
    throw new AgentCallError(error?.code ?? "AI_FAILED", error?.message ?? String(error));
  }

  try {
    await logRun("ok");
  } catch (error) {
    // A task whose call is not in the evidential journal must not change the board.
    throw new AgentCallError("AI_LOG_FAILED", error?.message ?? "could not append the AI run");
  }

  return { completion, providerInfo, promptHash, maxOutput, estimatedPrompt };
}
