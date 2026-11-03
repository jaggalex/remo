/**
 * The HTTP surface of the command layer (ADR-092).
 *
 * `POST /boards/:id/commands` is the only way an integration writes to a board. The
 * route checks the person's capability, validates the input through the registry, runs
 * the command in one Yjs transaction, waits until the update is durable, records the
 * idempotency key and writes an audit row.
 */
import { COMMANDS, CommandError, runCommand } from "./commands.mjs";
import { callerFromRequest, callerReachesOrg, hasScope } from "./integrations.mjs";
import { readJsonBody } from "./http-body.mjs";

/** One command at a time per board: Yjs merges, but a stale check needs a queue. */
const locks = new Map();

async function withBoardLock(boardId, task) {
  const previous = (locks.get(boardId) ?? Promise.resolve()).catch(() => {});
  const run = previous.then(task);
  locks.set(boardId, run.catch(() => {}));
  try {
    return await run;
  } finally {
    // The chain keeps the lock alive for the next caller; nothing to release here.
  }
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function fail(response, status, error, message) {
  json(response, status, { error, message });
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   url: URL,
 *   store: any,
 *   getDocument: (boardId: string) => Promise<any>,
 *   resolveAccess: (boardId: string) => Promise<any>,
 *   log?: Console,
 * }} input
 */
export async function handleCommands({
  request,
  response,
  url,
  store,
  getDocument,
  resolveAccess,
  log = console,
}) {
  const match = url.pathname.match(/^\/boards\/([^/]+)\/commands$/);
  if (!match) return false;
  // The command log needs a database; disk mode is a development fallback without IAM.
  if (!store.recordCommandRun || !store.flushRoom) return false;
  if (request.method !== "POST") {
    fail(response, 405, "METHOD_NOT_ALLOWED", "use POST");
    return true;
  }

  const boardId = decodeURIComponent(match[1]);
  // A person uses the session cookie; an integration uses `Authorization: Bearer
  // remo_it_…`. Both resolve to a caller whose board access is the same question (ADR-096).
  const caller = await callerFromRequest(request, store);
  // A token that is revoked or expired is refused before the board question is asked:
  // answering 404 first would hide the real reason from the integrator.
  if (caller?.kind === "refused") {
    await store
      .recordAudit?.({
        actorType: "integration",
        boardId,
        action: "board.command.denied",
        reason: caller.reason,
      })
      .catch((error) => log.error?.("[commands] audit failed:", error.message));
    fail(response, 401, caller.reason, "this integration token cannot be used");
    return true;
  }
  const acting = caller;
  const context = await resolveAccess(boardId, acting);
  if (!context?.resolved?.access?.allowed) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "board not found");
    return true;
  }
  const access = context.resolved.access;
  const orgId = context.iam?.org_id ?? context.board?.orgId ?? null;
  if (!callerReachesOrg(acting, orgId)) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "board not found");
    return true;
  }
  const actor =
    acting?.kind === "integration"
      ? { type: "integration", id: acting.token.id, name: acting.token.label }
      : { type: "user", id: acting?.user?.id ?? null, name: acting?.user?.name ?? null };
  const requestId = String(request.headers["x-request-id"] ?? "").slice(0, 100) || null;
  const audit = (event) =>
    store
      .recordAudit?.({
        actorType: actor.type,
        actorId: actor.id,
        orgId,
        boardId,
        requestId,
        sessionId: acting?.session?.sessionId ?? null,
        ...event,
      })
      .catch((error) => log.error?.("[commands] audit failed:", error.message));

  if (!acting) {
    await audit({ action: "board.command.denied", reason: "ACCOUNT_REQUIRED" });
    fail(
      response,
      403,
      "ACCOUNT_REQUIRED",
      "commands need an account or an integration token; a public link is view-only",
    );
    return true;
  }
  // A scope narrows its owner's access, it never widens it (ADR-096).
  if (acting.kind === "integration" && !hasScope(acting, "board.edit")) {
    await audit({ action: "board.command.denied", reason: "SCOPE_REQUIRED" });
    fail(response, 403, "SCOPE_REQUIRED", "this token does not carry board.edit");
    return true;
  }
  if (!access.capabilities.includes("board.edit")) {
    await audit({ action: "board.command.denied", reason: "NO_CAPABILITY" });
    fail(response, 403, "FORBIDDEN", "you cannot change this board");
    return true;
  }

  const body = await readJsonBody(request);
  if (!body) {
    fail(response, 400, "BAD_JSON", "expected a JSON body");
    return true;
  }
  const command = String(body.command ?? "");
  const input = body.input ?? {};
  // The registry is the source of truth for what a command needs; a token must carry
  // every capability the command declares (ADR-096).
  const definition = COMMANDS[command];
  if (acting.kind === "integration" && definition) {
    const missing = (definition.capabilities ?? []).filter((cap) => !acting.scopes.includes(cap));
    if (missing.length) {
      await audit({ action: "board.command.denied", subject: command, reason: "SCOPE_REQUIRED" });
      fail(response, 403, "SCOPE_REQUIRED", `this token does not carry ${missing.join(", ")}`);
      return true;
    }
  }
  const key = String(request.headers["idempotency-key"] ?? body.idempotencyKey ?? "")
    .trim()
    .slice(0, 100);
  if (!key) {
    fail(response, 400, "IDEMPOTENCY_KEY_REQUIRED", "send an Idempotency-Key header");
    return true;
  }

  const actorId = actor.id;
  const existing = await store.findCommandRun(boardId, actorId, key);
  if (existing) {
    json(response, 200, {
      result: existing.result,
      version: existing.version,
      replayed: true,
    });
    return true;
  }

  try {
    const outcome = await withBoardLock(boardId, async () => {
      // Re-check inside the lock: two identical requests may have arrived together.
      const raced = await store.findCommandRun(boardId, actor.id, key);
      if (raced) {
        return { result: raced.result, version: raced.version, replayed: true };
      }

      const ydoc = await getDocument(boardId);
      const ran = runCommand({
        ydoc,
        name: command,
        input,
        actor,
        capabilities: access.capabilities,
        ifVersion: body.ifVersion ? String(body.ifVersion) : undefined,
        idempotencyKey: key,
        boardId,
      });

      // A response is a promise that the change survives a restart.
      const persisted = await store.flushRoom(boardId);
      if (!persisted) {
        throw new CommandError(
          "NOT_PERSISTED",
          "the change is in memory but not durable; retry with the same key",
          503,
        );
      }

      const recorded = await store.recordCommandRun({
        boardId,
        orgId,
        actorId: actor.id,
        actorType: actor.type,
        command,
        idempotencyKey: key,
        result: ran.result,
        version: ran.version,
        // The outbox rows are written in the same transaction as the idempotency row:
        // an event exists if and only if the command was recorded (ADR-094).
        events: ran.events,
      });
      return { result: recorded.result, version: recorded.version, replayed: recorded.replayed };
    });

    await audit({
      action: "board.command",
      subject: command,
      after: {
        resultId: outcome.result?.id ?? null,
        version: outcome.version,
        replayed: outcome.replayed === true,
      },
    });
    // A lock toggle is a coordination fact, not just a command run (ADR-107).
    if (command === "board.item.update" && outcome.result?.changed?.includes("locked")) {
      await audit({
        action: input.patch?.locked ? "object.locked" : "object.unlocked",
        subject: String(outcome.result.id ?? input.id ?? ""),
      });
    }
    json(response, 200, outcome);
    return true;
  } catch (error) {
    if (error instanceof CommandError) {
      await audit({
        action: "board.command.denied",
        subject: command,
        reason: error.code,
        after: { status: error.status },
      });
      fail(response, error.status, error.code, error.message);
      return true;
    }
    log.error?.("[commands] failed:", error.message);
    await audit({
      action: "board.command.denied",
      subject: command,
      reason: "COMMAND_FAILED",
    });
    fail(response, 500, "COMMAND_FAILED", "the command failed; the board was not changed");
    return true;
  }
}
