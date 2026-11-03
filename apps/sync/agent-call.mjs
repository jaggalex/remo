/**
 * One model call for an agent task: resolve the key, count the prompt, log the run.
 *
 * Kept apart from the skills so the evidential journal is written the same way for
 * every one of them (ADR-090, spec/AI-agents-v1.md §9). The caller decides whether the
 * answer is a diagram or a plan; this module never touches the board.
 */
import { createHash } from "node:crypto";
import { AiClient } from "./ai.mjs";
import { FAKE_PLAN_MODEL, fakeModelEnabled, fakePlanClient } from "./ai-fake.mjs";
import { resolveAiConfig } from "./ai-credentials.mjs";

export class AgentCallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentCallError";
    this.code = code;
  }
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
      throw new AgentCallError(
        error?.code ?? "AI_NOT_CONFIGURED",
        error?.message ?? String(error),
      );
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
    });
    latencyMs = Math.max(0, now() - startedCall);
  } catch (error) {
    latencyMs = Math.max(0, now() - startedCall);
    await logRun("failed", {
      code: error?.code ?? "AI_FAILED",
      message: error?.message ?? String(error),
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
