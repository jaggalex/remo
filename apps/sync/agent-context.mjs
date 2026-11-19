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

export async function roomAgentHistoryAllowed(store, board, access, userId) {
  if (!board?.org_id || !access?.sources?.some((source) => source !== "link")) return false;
  const seat = await store.getOrgMembership(board.org_id, userId);
  return seat?.state === "active" && seat.relation === "member";
}

/** The requester must still be an active member with room edit rights. */
export async function roomAgentMemberCanEdit(store, boardId, userId) {
  const facts = await store.accessFacts(boardId, userId);
  return Boolean(facts?.viewer?.org?.relation === "member"
    && facts.viewer.org.state === "active"
    && effective(facts).capabilities.includes("board.edit"));
}

export async function roomAgentCanRequest(store, board, assignment, userId) {
  if (!board || board.visibility === "link" || !assignment?.enabled
      || assignment.owner_id !== board.owner_id || assignment.agent_state !== "active") {
    return false;
  }
  if (userId !== board.owner_id && !assignment.delegate_ids?.includes(userId)) return false;
  return roomAgentMemberCanEdit(store, board.id, userId);
}

/** Serialize room agent commands separately from room loading and replacement. */
export function withRoomAgentLock(store, boardId, run) {
  return store.withRoomLock ? store.withRoomLock(`\0room-agent:${boardId}`, run) : run();
}
