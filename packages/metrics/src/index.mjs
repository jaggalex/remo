/**
 * Product metrics contract (ADR-082).
 *
 * One envelope and one event list for web and sync. The recorder never throws into the
 * product: a metrics sink is best-effort, and a missing/disabled sink is a no-op.
 */
export const METRIC_NAMES = Object.freeze([
  "session.started",
  "org.created",
  "board.created",
  "board.trashed",
  "board.restored",
  "board.duplicated",
  "board.saved",
  "object.created",
  "connector.created",
  "connector.waypoint_added",
  "share.invited",
  "role.changed",
  "link.enabled",
  "link.security",
  "export.requested",
  "export.completed",
  "agent.task.finished",
  "scenario.started",
  "scenario.completed",
  "onboarding.step",
  "activation.first_value",
  "help.opened",
  "help.search",
  "billing.subscription_started",
]);

export const ACTOR_TYPES = Object.freeze(["user", "agent", "visitor"]);

/**
 * The one place a new product fact is declared: name, required props and a short
 * purpose. A metric formula belongs in SQL/dashboards, not in this table; if a new KPI
 * needs a fact that is not emitted yet, add an event here once.
 */
export const METRIC_CATALOG = Object.freeze({
  "session.started": { required: [], optional: ["entry"], purpose: "A signed-in session began" },
  "org.created": { required: ["source"], optional: [], purpose: "A workspace (organisation) was created" },
  "board.created": { required: [], optional: ["teamId"], purpose: "A board was created" },
  "board.trashed": { required: [], optional: [], purpose: "A board was moved to the trash" },
  "board.restored": { required: [], optional: [], purpose: "A board was restored from the trash" },
  "board.duplicated": { required: ["sourceId"], optional: [], purpose: "A board was copied" },
  "board.saved": { required: ["objectCount"], optional: ["connectorCount"], purpose: "The client received a save acknowledgement" },
  "object.created": { required: ["objectType"], optional: [], purpose: "An object was added" },
  "connector.created": { required: ["routing"], optional: [], purpose: "A connector was created" },
  "connector.waypoint_added": { required: [], optional: [], purpose: "A rigid point was added" },
  "share.invited": { required: ["role"], optional: ["subjectType"], purpose: "A person was invited to a board" },
  "role.changed": { required: ["from", "to"], optional: [], purpose: "A board role changed" },
  "link.enabled": { required: ["state"], optional: [], purpose: "The public link changed state" },
  "link.security": { required: [], optional: ["password", "expires"], purpose: "Link password or expiry changed" },
  "export.requested": { required: ["scope", "format"], optional: ["objectCount"], purpose: "An export job was requested" },
  "export.completed": { required: ["scope", "format"], optional: ["bytes"], purpose: "An export result was delivered" },
  "agent.task.finished": { required: ["status", "skill"], optional: ["actions", "costUsd", "seconds"], purpose: "An agent task finished" },
  "scenario.started": { required: ["scenarioId"], optional: [], purpose: "A key user scenario began" },
  "scenario.completed": { required: ["scenarioId", "outcome"], optional: ["durationMs", "failureReason"], purpose: "A key user scenario finished" },
  "onboarding.step": { required: ["step"], optional: [], purpose: "A mandatory or optional onboarding step changed" },
  "activation.first_value": { required: ["kind"], optional: [], purpose: "The first useful result was reached" },
  "help.opened": { required: [], optional: ["topicId"], purpose: "A help topic was opened" },
  "help.search": { required: ["lang", "queryLength", "resultCount"], optional: [], purpose: "Help search ran; query text is never sent" },
  "billing.subscription_started": { required: ["plan"], optional: [], purpose: "Billing only; reserved until a billing source exists" },
});

const CONTENT_KEYS = new Set(["text", "title", "content", "email", "name", "query", "boardName", "userName"]);

export function createRecorder({ sink = null, enabled = false } = {}) {
  return {
    get enabled() {
      return Boolean(enabled && sink);
    },
    emit(event) {
      if (!enabled || !sink) return;
      try {
        sink(event);
      } catch {
        // Metrics must never break a board or an agent task.
      }
    },
  };
}

/** Build a validated envelope. IDs are UUIDs; no names, emails or board content. */
export function metricEvent({
  name,
  orgId,
  actorId = null,
  actorType = "user",
  boardId = null,
  sessionId = null,
  appVersion = "dev",
  props = {},
}) {
  if (!METRIC_NAMES.includes(name)) throw new Error(`unknown metric: ${name}`);
  if (!ACTOR_TYPES.includes(actorType)) throw new Error(`unknown actor type: ${actorType}`);
  const definition = METRIC_CATALOG[name];
  if (!definition) throw new Error(`unknown metric: ${name}`);
  for (const key of definition.required) {
    if (!(key in (props ?? {}))) throw new Error(`metric ${name} needs prop ${key}`);
  }
  for (const [key, value] of Object.entries(props ?? {})) {
    if (CONTENT_KEYS.has(key)) throw new Error(`metric ${name}: prop ${key} may contain content or personal data`);
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`metric ${name}: prop ${key} must be a scalar`);
    }
  }
  return {
    event_id: crypto.randomUUID(),
    name,
    occurred_at: new Date().toISOString(),
    org_id: orgId ?? null,
    actor_id: actorId ?? null,
    actor_type: actorType,
    board_id: boardId ?? null,
    session_id: sessionId ?? null,
    app_version: appVersion,
    schema_version: 1,
    props: props ?? {},
  };
}
