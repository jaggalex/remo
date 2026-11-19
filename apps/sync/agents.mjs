/**
 * Agents as principals: the one decision function, budgets and skill choice.
 *
 * An agent has no grants of its own. It acts on behalf of exactly one owner, and only
 * inside a task: `agentEffective` takes the owner's already-computed access and can
 * only narrow it. This is the same shape as `effective()` in iam.mjs — one deterministic
 * function with a reason code, tested without a database (ADR-061,
 * spec/AI-agents-v1.md).
 */

/** Capabilities an agent may never hold, whatever the task or the skill says. */
export const AGENT_FORBIDDEN = new Set([
  "board.share",
  "board.manage",
  "board.transfer",
  "board.delete",
]);

const MODE_CAPABILITIES = {
  read: ["board.read"],
  propose: ["board.read"],
  write: ["board.read", "board.edit"],
};

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Money is not a count: a budget of one tenth of a dollar must stay 0.1, not become 0.
 *
 * Four decimals is the precision a price list can have (a fraction of a cent) while
 * still cutting the float noise a typed value carries. The limits are applied before
 * rounding, so a value above the ceiling becomes the ceiling itself.
 */
function clampMoney(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const bounded = Math.min(max, Math.max(min, number));
  return Math.round(bounded * 10_000) / 10_000;
}

/**
 * Budget in the units a provider actually bills.
 *
 * Tokens are enforced before and after the call (`max_tokens` plus a check on the
 * reported usage); money is checked after the call and a conservative per-model price
 * is used when the provider does not report a cost. Actions and seconds bound the
 * amount of change and the wall-clock time of one task.
 */
export function normalizeBudget(input = {}, limits = {}) {
  return {
    maxTokens: clamp(input.maxTokens, 256, limits.maxTokens ?? 64_000, 8_000),
    maxCostUsd: clampMoney(input.maxCostUsd, 0, limits.maxCostUsd ?? 5, 0.5),
    maxActions: clamp(input.maxActions, 1, limits.maxActions ?? 200, 40),
    maxSeconds: clamp(input.maxSeconds, 10, 600, 120),
  };
}

/**
 * Why this person cannot ask an agent on this board.
 *
 * Two refusals that a person fixes differently: a public link is not an account (sign
 * in), and a reader is not an editor (ask for edit rights). Returning the reason as a
 * code keeps the UI honest instead of one generic "forbidden" (ADR-066, AG-12).
 */
export function aiEntryRefusal(access) {
  if (!access?.allowed) return "NO_ACCESS";
  const sources = access.sources ?? [];
  // A link-only visitor has no account behind the decision, so there is nobody on whose
  // behalf an agent could act. A signed-in viewer with a grant is an account.
  if (sources.length === 1 && sources[0] === "link") return "ACCOUNT_REQUIRED";
  if (!access.capabilities?.includes("board.edit")) return "NO_CAPABILITY";
  return null;
}

/**
 * A task without a budget is not created (ADR-086).
 *
 * Filling in defaults here would be generous with somebody else's money: the defaults
 * exist for the runner once a budget is agreed, not as a substitute for agreeing.
 */
export function budgetMissing(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return true;
  return !["maxTokens", "maxCostUsd", "maxActions", "maxSeconds"].some((key) => {
    const value = input[key];
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  });
}

export function withinBudget(budget, usage) {
  const tokens = Number(usage.promptTokens ?? 0) + Number(usage.completionTokens ?? 0);
  const cost = Number(usage.costUsd ?? 0);
  const actions = Number(usage.actions ?? 0);
  const seconds = Number(usage.seconds ?? 0);
  if (tokens > budget.maxTokens) return false;
  if (cost > budget.maxCostUsd + 1e-9) return false;
  if (actions > budget.maxActions) return false;
  if (seconds > budget.maxSeconds) return false;
  return true;
}

/**
 * Can this agent run this task on this board?
 *
 * `ownerAccess` is the result of `effective()` for the owner, so an agent is never
 * stronger than the person it belongs to. The result lists the sources it inherited,
 * which is what the UI and the audit show when somebody asks "why could it do that".
 */
export function agentEffective({ agent, ownerAccess, board, policy, task }) {
  const deny = (reason) => ({
    allowed: false,
    mode: null,
    capabilities: [],
    reason,
    sources: [],
  });

  if (!agent || agent.state !== "active") return deny("AGENT_DISABLED");
  if (!ownerAccess?.allowed) return deny(ownerAccess?.reason ?? "OWNER_NO_ACCESS");
  if (policy?.agentsEnabled !== true) return deny("AGENTS_DISABLED_ORG");
  if (board?.agentsEnabled !== true) return deny("AGENTS_DISABLED_BOARD");
  if (!task) return deny("TASK_REQUIRED");
  if (task.status !== "running" && task.status !== "queued") return deny("TASK_NOT_ACTIVE");

  const mode = task.mode ?? "write";
  const modeCapabilities = MODE_CAPABILITIES[mode];
  if (!modeCapabilities) return deny("BAD_MODE");

  const requested = Array.isArray(task.capabilities) && task.capabilities.length
    ? task.capabilities
    : modeCapabilities;
  if (requested.some((capability) => AGENT_FORBIDDEN.has(capability))) {
    return deny("FORBIDDEN_CAPABILITY");
  }

  const capabilities = requested.filter(
    (capability) =>
      modeCapabilities.includes(capability) &&
      ownerAccess.capabilities.includes(capability),
  );

  if (!capabilities.includes("board.read")) return deny("NO_CAPABILITY");
  if (mode !== "read" && !capabilities.includes("board.edit")) {
    return deny("NO_CAPABILITY");
  }

  return {
    allowed: true,
    mode,
    capabilities,
    reason: "ALLOW",
    sources: [...new Set([...(ownerAccess.sources ?? []), `agent:${agent.id}`, `task:${task.id}`])],
  };
}

const DIAGRAM_HINTS = /(diagram|flow|process|scheme|chart|диаграм|схем|процесс|блок)/i;
const CARD_HINTS = /(card|kanban|task|карточ|канбан|задач)/i;
const TIDY_HINTS =
  /(упорядоч|приберис|приберись|наведи\s+порядок|разложи|разложить|выровняй|tidy\s*up|tidy|arrange|line\s*up)/i;
const BRIEF_HINTS =
  /(us[-\s]?карт|user[-\s]?story|story[-\s]?map|карт[ауы]?\s+истори|создай\s+фрейм|сделай\s+фрейм|фрейм\s+с|создай\s+структур|собери\s+структур|swimlane|дорожк)/i;

/**
 * Pick a published skill for a task.
 *
 * The model does not choose freely: the catalog is already filtered by the caller and
 * the server validates the skill's requirements again before running it. With one
 * built-in skill this is a deterministic match, which is what makes it auditable; an
 * LLM router can replace it later without changing the contract.
 */
export function resolveSkill(skills, { slug = null, intent = "" } = {}) {
  const published = skills.filter((skill) => skill.state === "published");
  // An explicit slug is the caller's decision and always wins over a hint.
  if (slug) {
    return published.find((skill) => skill.slug === slug) ?? null;
  }
  // "Create a frame with ..." is a structure, even when the request also says
  // "cards": the story-map skill owns the frame, the cards skill owns conversion.
  if (BRIEF_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "brief-to-board") ?? null;
  }
  // "Tidy up", "приберись", "разложи" are an arrangement request, never a conversion:
  // the selected objects stay the same objects and only their coordinates change.
  if (TIDY_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "tidy-selection") ?? null;
  }
  if (CARD_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "cards") ?? null;
  }
  if (DIAGRAM_HINTS.test(intent)) {
    return published.find((skill) => skill.slug === "diagram") ?? null;
  }
  return published[0] ?? null;
}
