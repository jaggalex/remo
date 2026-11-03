/**
 * Shared pieces of running a task: environment limits, the owner's access and a few
 * small normalisers. Kept out of `agent-runner.mjs` so the runner stays an orchestrator
 * and every skill uses the same decision (ADR-093).
 */
import { agentEffective } from "./agents.mjs";
import { effective } from "./iam.mjs";

export function agentLimitsFromEnv(env = process.env) {
  return {
    maxTokens: Number(env.REMO_AGENT_MAX_TOKENS ?? 32_000),
    maxCostUsd: Number(env.REMO_AGENT_MAX_COST_USD ?? 2),
    maxActions: Number(env.REMO_AGENT_MAX_ACTIONS ?? 500),
  };
}

export function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100_000, Math.min(100_000, number)) : fallback;
}

export function selectionTexts(ydoc, ids) {
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const found = [];
  for (const id of Array.isArray(ids) ? ids.slice(0, 20) : []) {
    const widget = widgets.get(String(id));
    if (!widget) continue;
    const text = texts.get(String(id))?.toString() ?? widget.title ?? widget.content ?? "";
    if (!String(text).trim()) continue;
    found.push({ id: widget.id, type: widget.type, text: String(text).slice(0, 200) });
  }
  return found;
}

export async function audit(store, log, event) {
  try {
    await store.recordAudit(event);
  } catch (error) {
    log.error?.("[agent] audit failed:", error.message);
  }
}

/** Owner access and the agent decision, loaded fresh from the store. */
export async function decide(store, task, agent) {
  const board = await store.getIamBoard(task.board_id);
  const facts = await store.accessFacts(task.board_id, agent.owner_id);
  const ownerAccess = facts
    ? effective({
        board: facts.board,
        viewer: facts.viewer,
        grants: facts.grants,
        policy: facts.policy,
      })
    : { allowed: false, reason: "NOT_FOUND", capabilities: [], sources: [] };
  const policy = await store.getOrgPolicy(task.org_id);
  return {
    board,
    decision: agentEffective({
      agent,
      ownerAccess,
      // The store speaks SQL names; the policy function speaks the domain names.
      board: board ? { ...board, agentsEnabled: board.agents_enabled === true } : null,
      policy,
      task: { ...task, status: "running" },
    }),
  };
}
