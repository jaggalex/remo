/**
 * HTTP surface for agents (spec/AI-agents-v1.md §13).
 *
 * Two audiences that must not overlap: people use the session cookie, agents use a
 * bearer token. A cookie is never accepted on `/agent/**`, and a bearer token is never
 * accepted on the human routes — the only thing an agent token can do in v1 is read its
 * own identity and task history.
 *
 * Creating a task is the moment authority is handed over: the board toggles, the org
 * policy, the owner's current role and the skill's requirements are checked once here,
 * then again by the runner just before it writes.
 *
 * This file is the dispatcher: it decides whose request it is and which domain module
 * answers. The routes themselves live in `agent-api-*.mjs`, one file per audience or
 * domain, so a change to credentials never touches a change set.
 */
import { pathSegments } from "./http-boundary.mjs";
import { fail, sessionFromRequest } from "./iam-api.mjs";
import { humanContext } from "./agent-api-context.mjs";
import { handleBearer } from "./agent-api-bearer.mjs";
import { handleOrgRoutes } from "./agent-api-org.mjs";
import { handleAiCredentials } from "./agent-api-ai.mjs";
import { handleChangeSets } from "./agent-api-changes.mjs";
import { handleBoardRoutes } from "./agent-api-board.mjs";

export async function handleAgents({
  request,
  response,
  url,
  store,
  log = console,
  onTaskQueued = null,
}) {
  // Decoded exactly once, like every other route: an agent task names a board id.
  const parts = pathSegments(url);
  const method = request.method ?? "GET";

  // The disk fallback has no agent tables; do not pretend the routes exist there.
  if (typeof store.getAgent !== "function") return false;

  if (parts[0] !== "agent") {
    // Do not claim a board or organisation route we do not own: `handleIam` and the
    // read API share these prefixes, and a stray 401 here would break a legacy room.
    const orgSub = parts[0] === "orgs" && Boolean(parts[1]) && parts[2];
    const userSub = parts[0] === "users" && parts[1] === "me" && parts[2] === "ai";
    const known =
      userSub ||
      (orgSub && ["agents", "agent-policy", "skills", "ai"].includes(parts[2])) ||
      (parts[0] === "skills" && Boolean(parts[1]) && parts[2] === "publish") ||
      (parts[0] === "boards" &&
        Boolean(parts[1]) &&
        ["agents", "agent-tasks", "agent-schedules", "agent-change-sets"].includes(parts[2])) ||
      (parts[0] === "change-sets" && Boolean(parts[1])) ||
      ((parts[0] === "agents" ||
        parts[0] === "agent-tasks" ||
        parts[0] === "agent-schedules") &&
        Boolean(parts[1]));
    if (!known) return false;
  }

  const base = { request, response, url, parts, method, store, log, onTaskQueued };

  if (parts[0] === "agent") return handleBearer(base);

  /* -------------------------------------------------------------- human --- */

  const session = await sessionFromRequest(request, store);
  if (!session) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return true;
  }

  const ctx = { ...base, ...humanContext({
    request,
    store,
    log,
    onTaskQueued,
    me: session.user,
    sessionId: session.sessionId,
  }) };

  // Each module answers only for its own routes and says whether it did.
  if (await handleOrgRoutes(ctx)) return true;
  if (await handleAiCredentials(ctx)) return true;
  if (await handleChangeSets(ctx)) return true;
  if (await handleBoardRoutes(ctx)) return true;
  return false;
}
