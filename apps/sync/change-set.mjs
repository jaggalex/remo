/**
 * Change sets: a package of deterministic domain operations with an estimate, chunked
 * execution, progress and resume.
 *
 * v1 has cards. ADR-077 adds connectors: create, change routing, replace rigid
 * waypoints. The contract is the same for every operation — validate → estimate →
 * execute — so there is still one permission and audit path.
 */
import { CARD_LIMITS, convertToCards, makeId } from "./cards.mjs";
import { CommandError, commandObjectId, runCommand } from "./commands.mjs";

const ROUTINGS = new Set(["straight", "elbow", "curved"]);
const CONNECTABLE = new Set(["shape", "image", "stamp", "sticky_note", "text", "card"]);
const MAX_WAYPOINTS = 32;

export const CARD_OPS = new Set(["create_cards"]);
export const CONNECTOR_OPS = new Set([
  "create_connector",
  "set_connector_waypoints",
  "set_connector_routing",
]);
export const CHANGE_SET_OPS = new Set([...CARD_OPS, ...CONNECTOR_OPS]);
export const CHANGE_SET_LIMITS = {
  operations: 10,
  sources: CARD_LIMITS.maxPerTask,
  chunk: CARD_LIMITS.chunk,
  waypoints: MAX_WAYPOINTS,
};

export class ChangeSetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChangeSetError";
    this.code = code;
  }
}

function routingOrError(value, fallback = "elbow") {
  const routing = value ?? fallback;
  if (!ROUTINGS.has(routing)) {
    throw new ChangeSetError("BAD_ROUTING", "routing must be straight, elbow or curved");
  }
  return routing;
}

function waypointList(value) {
  if (!Array.isArray(value) || value.length > MAX_WAYPOINTS) {
    throw new ChangeSetError(
      "BAD_WAYPOINTS",
      `waypoints must be an array of at most ${MAX_WAYPOINTS} points`,
    );
  }
  return value.map((point) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ChangeSetError("BAD_WAYPOINTS", "every waypoint needs finite x and y");
    }
    return {
      id: String(point?.id ?? makeId("wp")),
      x,
      y,
      rigid: point?.rigid !== false,
    };
  });
}

function validateConnectorOperation(operation) {
  if (operation.op === "create_connector") {
    const from = String(operation.from ?? "");
    const to = String(operation.to ?? "");
    if (!from || !to) {
      throw new ChangeSetError("BAD_CONNECTOR", "a connector needs from and to");
    }
    // ADR-077: a self-loop is rejected in v1, with the reason the API contract names.
    if (from === to) {
      throw new ChangeSetError("connector_self_loop", "a connector cannot join an object to itself");
    }
    routingOrError(operation.routing);
    if (operation.waypoints !== undefined) waypointList(operation.waypoints);
    return;
  }

  const connectorId = String(operation.connectorId ?? "");
  if (!connectorId) {
    throw new ChangeSetError("BAD_CONNECTOR", "a connector operation needs connectorId");
  }
  if (operation.op === "set_connector_routing") {
    routingOrError(operation.routing, "elbow");
    return;
  }
  if (operation.op === "set_connector_waypoints") {
    routingOrError(operation.routing, "elbow");
    waypointList(operation.waypoints ?? []);
  }
}

export function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > CHANGE_SET_LIMITS.operations) {
    throw new ChangeSetError(
      "BAD_OPERATIONS",
      `a change set needs 1 to ${CHANGE_SET_LIMITS.operations} operations`,
    );
  }
  let sources = 0;
  let changes = 0;
  for (const operation of operations) {
    if (!operation || !CHANGE_SET_OPS.has(operation.op)) {
      throw new ChangeSetError(
        "BAD_OPERATION",
        "supported operations: create_cards, create_connector, set_connector_waypoints, set_connector_routing",
      );
    }
    if (CARD_OPS.has(operation.op)) {
      if (!Array.isArray(operation.selectionIds) || operation.selectionIds.length === 0) {
        throw new ChangeSetError("EMPTY_SELECTION", "an operation needs a selection");
      }
      if (operation.mode && operation.mode !== "copy" && operation.mode !== "move") {
        throw new ChangeSetError("BAD_MODE", "mode must be copy or move");
      }
      sources += operation.selectionIds.length;
      changes += operation.selectionIds.length;
    } else {
      validateConnectorOperation(operation);
      sources += 1;
      changes += 1;
    }
  }
  if (sources > CHANGE_SET_LIMITS.sources) {
    throw new ChangeSetError(
      "CHANGE_SET_TOO_LARGE",
      `a change set is limited to ${CHANGE_SET_LIMITS.sources} source objects`,
    );
  }
  return { operations: operations.length, sources, changes };
}

function cardOptions(operation, agent, taskId, origin) {
  return {
    target: operation.target ?? { kind: "standalone" },
    mode: operation.mode === "move" ? "move" : "copy",
    origin,
    agent,
    taskId,
    skill: "cards",
  };
}

function widgetById(ydoc, id) {
  return ydoc.getMap("widgets").get(String(id));
}

function assertConnectorTargets(ydoc, operation) {
  const from = widgetById(ydoc, operation.from);
  const to = widgetById(ydoc, operation.to);
  if (!from || !to) {
    throw new ChangeSetError("CONNECTOR_TARGET_MISSING", "both connector targets must exist");
  }
  if (!CONNECTABLE.has(from.type) || !CONNECTABLE.has(to.type)) {
    throw new ChangeSetError("CONNECTOR_TARGET_INVALID", "both targets must be connectable");
  }
  const already = [...ydoc.getMap("widgets").values()].some(
    (widget) =>
      widget?.type === "connector" &&
      [widget.start?.item, widget.end?.item].includes(String(operation.from)) &&
      [widget.start?.item, widget.end?.item].includes(String(operation.to)),
  );
  if (already) throw new ChangeSetError("CONNECTOR_EXISTS", "these objects already have a connector");
}

function assertConnector(ydoc, connectorId) {
  const widget = widgetById(ydoc, connectorId);
  if (!widget || widget.type !== "connector") {
    throw new ChangeSetError("CONNECTOR_MISSING", "the connector does not exist");
  }
  return widget;
}

/** Read-only plan: how many changes, what is skipped, and does the budget fit. */
export function estimateChangeSet({
  ydoc,
  operations,
  budget,
  agent,
  taskId,
  origin,
  processed = [],
}) {
  const plan = validateOperations(operations);
  const done = new Set(processed);
  let cards = 0;
  let connectorChanges = 0;
  const skipped = [];
  for (const [operationIndex, operation] of operations.entries()) {
    if (!CARD_OPS.has(operation.op) && done.has(`connector:${operationIndex}`)) continue;
    if (CARD_OPS.has(operation.op)) {
      const selectionIds = operation.selectionIds.filter((id) => !done.has(String(id)));
      if (!selectionIds.length) continue;
      const estimate = convertToCards(ydoc, {
        ...cardOptions(operation, agent, taskId, origin),
        selectionIds,
        maxCards: Number.POSITIVE_INFINITY,
        dryRun: true,
      });
      cards += estimate.count;
      skipped.push(...estimate.skipped);
    } else if (operation.op === "create_connector") {
      assertConnectorTargets(ydoc, operation);
      connectorChanges += 1;
    } else {
      const connector = assertConnector(ydoc, operation.connectorId);
      if (connector.locked) {
        // A locked connector is skipped, not forced (ADR-107).
        skipped.push({ sourceId: String(operation.connectorId), reason: "locked" });
        continue;
      }
      if (operation.waypoints !== undefined) waypointList(operation.waypoints);
      connectorChanges += 1;
    }
  }
  const changes = cards + connectorChanges;
  // Everything being locked is a reported skip, not a failure; nothing usable at all is.
  const lockedOnly =
    changes === 0 && skipped.length > 0 && skipped.every((entry) => entry.reason === "locked");
  // A resume whose every operation is already processed has nothing left to do; that is
  // a successful no-op, not an empty selection.
  const allProcessed = operations.every((operation, index) =>
    CARD_OPS.has(operation.op)
      ? operation.selectionIds.every((id) => done.has(String(id)))
      : done.has(`connector:${index}`),
  );
  if (changes === 0 && !lockedOnly && !allProcessed) {
    throw new ChangeSetError("EMPTY_SELECTION", "nothing with text was selected");
  }
  if (changes > budget.maxActions) {
    throw new ChangeSetError(
      "BUDGET_ACTIONS",
      `the task allows ${budget.maxActions} changes but ${changes} are needed`,
    );
  }
  return { cards, changes, skipped, operations: operations.length };
}

function mapCommandError(error) {
  if (!(error instanceof CommandError)) return error;
  const codes = {
    SELF_LOOP: "connector_self_loop",
    CONNECTOR_EXISTS: "CONNECTOR_EXISTS",
    OBJECT_EXISTS: "CONNECTOR_EXISTS",
    OBJECT_NOT_FOUND: "CONNECTOR_TARGET_MISSING",
    NOT_CONNECTABLE: "CONNECTOR_TARGET_INVALID",
    NOT_CONNECTOR: "CONNECTOR_MISSING",
  };
  return new ChangeSetError(codes[error.code] ?? error.code, error.message);
}

/**
 * Connector creation is the command layer's job (ADR-092).
 *
 * The change set keeps the plan, progress and resume; the write itself goes through the
 * same registry an integration uses, so one rule decides whether a line is allowed.
 */
function createConnectorFromOperation(ydoc, operation, agent, taskId, operationIndex) {
  const widgets = ydoc.getMap("widgets");
  const key = `change-set:${taskId ?? "task"}:${operationIndex}`;
  const id =
    operation.id !== undefined
      ? String(operation.id)
      : commandObjectId({
          boardId: taskId ?? "",
          actorId: agent?.id ?? "agent",
          key: `board.connector.create:${key}`,
          prefix: "conn",
        });
  if (widgets.has(id)) {
    // Already there (a resume after the write): nothing happened, so nothing to announce.
    return { connector: { id, kind: "connector", from: operation.from, to: operation.to }, events: [] };
  }
  try {
    const { result, events } = runCommand({
      ydoc,
      name: "board.connector.create",
      input: {
        id,
        from: String(operation.from),
        to: String(operation.to),
        routing: operation.routing,
        arrow: operation.arrow,
        ...(operation.waypoints !== undefined ? { waypoints: operation.waypoints } : {}),
        style: {
          // The line Plain preset (ADR-129): grey 600 at 2 px, the same value the model
          // writes for a new line, so an agent's line rings its chip like a hand-drawn one.
          strokeColor: operation.strokeColor ?? "#58534e",
          strokeWidth: Number(operation.strokeWidth ?? 2),
        },
      },
      actor: { type: "agent", id: agent?.id ?? "agent", name: agent?.name ?? "Agent" },
      createdBy: agent?.name ?? null,
      ...(agent
        ? {
            agent: {
              id: agent.id,
              name: agent.name,
              taskId: taskId ?? null,
              skill: "change-set",
            },
          }
        : {}),
      idempotencyKey: key,
      boardId: taskId ?? "",
    });
    return {
      connector: {
        id: result.id,
        kind: "connector",
        from: operation.from,
        to: operation.to,
        routing: operation.routing ?? "elbow",
      },
      events,
    };
  } catch (error) {
    throw mapCommandError(error);
  }
}

/** Routing and waypoint changes go through the same registry. */
function updateConnector(ydoc, operation, agent, taskId, operationIndex) {
  try {
    const { result, events } = runCommand({
      ydoc,
      name: "board.connector.update",
      input:
        operation.op === "set_connector_routing"
          ? { id: String(operation.connectorId), routing: operation.routing }
          : {
              id: String(operation.connectorId),
              routing: operation.routing ?? "elbow",
              waypoints: operation.waypoints ?? [],
            },
      actor: { type: "agent", id: agent?.id ?? "agent", name: agent?.name ?? "Agent" },
      idempotencyKey: `change-set:${taskId ?? "task"}:${operationIndex}`,
      boardId: taskId ?? "",
    });
    return {
      connector: { id: result.id, kind: "connector", routing: result.routing },
      events,
    };
  } catch (error) {
    throw mapCommandError(error);
  }
}

/**
 * Execute an operation list. `progress.processed` is the resume point: a card source
 * already converted, or a connector operation already applied, is not repeated.
 */
export async function executeChangeSet({
  ydoc,
  operations,
  agent,
  taskId,
  budget,
  origin,
  progress = {},
  changeSetId = null,
  onProgress = null,
  onEvents = null,
  shouldContinue = null,
}) {
  validateOperations(operations);
  const processed = new Set(Array.isArray(progress.processed) ? progress.processed : []);
  const planned = estimateChangeSet({
    ydoc,
    operations,
    budget,
    agent,
    taskId,
    origin,
    processed: [...processed],
  });
  const total = planned.changes;
  const created = [];
  const connectors = [];
  const skipped = [...planned.skipped];
  const allSources = operations.flatMap((operation) => operation.selectionIds ?? []);
  const events = [];
  let chunks = 0;

  /**
   * The dedupe key of one agent action (ADR-097). A resumed run that re-applies a chunk
   * writes the same key, and the outbox keeps one row.
   */
  const eventsFor = (operationIndex, kind, batch) =>
    batch.map((event) => ({
      ...event,
      dedupeKey: changeSetId
        ? `change-set:${changeSetId}:${operationIndex}:${kind}:${event.subject}`
        : null,
    }));

  const announce = async (batch) => {
    if (!batch.length) return;
    events.push(...batch);
    await onEvents?.(batch);
  };

  for (const [operationIndex, operation] of operations.entries()) {
    if (!CARD_OPS.has(operation.op)) {
      const key = `connector:${operationIndex}`;
      if (processed.has(key)) continue;
      if (shouldContinue && !(await shouldContinue())) {
        return {
          cancelled: true,
          created,
          connectors,
          skipped,
          events,
          count: created.length + connectors.length,
          processed: [...processed],
          total,
          chunks,
        };
      }
      if (operation.op !== "create_connector") {
        const target = widgetById(ydoc, operation.connectorId);
        if (target?.locked) {
          // Already reported by the plan; the run just leaves it alone.
          processed.add(key);
          continue;
        }
      }
      const applied =
        operation.op === "create_connector"
          ? createConnectorFromOperation(ydoc, operation, agent, taskId, operationIndex)
          : updateConnector(ydoc, operation, agent, taskId, operationIndex);
      connectors.push(applied.connector);
      processed.add(key);
      chunks += 1;
      await announce(eventsFor(operationIndex, "connector", applied.events ?? []));
      await onProgress?.({
        done: created.length + connectors.length,
        total,
        chunks,
        processed: [...processed],
      });
      continue;
    }

    const pending = operation.selectionIds.filter((id) => !processed.has(String(id)));
    for (let index = 0; index < pending.length; index += CHANGE_SET_LIMITS.chunk) {
      if (shouldContinue && !(await shouldContinue())) {
        return {
          cancelled: true,
          created,
          connectors,
          skipped,
          events,
          count: created.length + connectors.length,
          processed: [...processed],
          total,
          chunks,
        };
      }
      const chunk = pending.slice(index, index + CHANGE_SET_LIMITS.chunk);
      const converted = convertToCards(ydoc, {
        ...cardOptions(operation, agent, taskId, origin),
        selectionIds: chunk,
        maxCards: chunk.length,
      });
      created.push(...converted.created);
      // The plan already reported some skips; the run must not report them twice.
      for (const entry of converted.skipped) {
        if (!skipped.some((seen) => seen.sourceId === entry.sourceId && seen.reason === entry.reason)) {
          skipped.push(entry);
        }
      }
      for (const id of chunk) processed.add(String(id));
      chunks += 1;
      await announce(
        eventsFor(
          operationIndex,
          "card",
          converted.created.map((card) => ({
            type: "board.item.created",
            subject: card.id,
            payload: { objectType: "card" },
          })),
        ),
      );
      await onProgress?.({
        done: created.length + connectors.length,
        total,
        chunks,
        processed: [...processed],
      });
    }
  }

  return {
    created,
    connectors,
    skipped,
    events,
    count: created.length + connectors.length,
    total,
    chunks,
    processed: [...processed],
    sources: allSources.length,
    operations: operations.length,
    target: operations.length === 1 ? operations[0].target ?? { kind: "standalone" } : null,
  };
}
