/**
 * Values and small helpers shared by the agent HTTP surface.
 *
 * Kept apart from the route modules so a limit or a sanitiser has exactly one definition
 * and every route that needs it imports the same one.
 */
export const SKILL_HANDLERS = new Set([
  "builtin:diagram",
  "builtin:cards",
  "builtin:brief",
  "builtin:tidy",
]);

/** Manifest tools a skill may declare; a capability check is separate. */
export const SKILL_TOOLS = new Set([
  "read_board",
  "read_selection",
  "write_diagram",
  "propose_plan",
]);

export const RISKS = new Set(["read", "propose", "write", "destructive"]);

export const MAX_TOKENS_PER_AGENT = 5;

export const MAX_QUEUED = Number(process.env.REMO_AGENT_MAX_QUEUED ?? 5);

export function integer(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function originOf(input) {
  const x = Number(input?.x);
  const y = Number(input?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return {};
  return { x: Math.max(-100_000, Math.min(100_000, x)), y: Math.max(-100_000, Math.min(100_000, y)) };
}

export function selectionIds(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((id) => typeof id === "string").slice(0, 1000);
}

/**
 * What an organisation admin without a role on the board sees of a task or change set:
 * that it exists and how it went. Input, result and operations are board content, and
 * access to those is decided on the board (ADR-161).
 */
const OPERATOR_FIELDS = [
  "id",
  "org_id",
  "board_id",
  "agent_id",
  "status",
  "created_by",
  "created_at",
  "started_at",
  "finished_at",
];

export function operatorView(row) {
  if (!row) return row;
  return Object.fromEntries(
    OPERATOR_FIELDS.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]),
  );
}
