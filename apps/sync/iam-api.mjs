/**
 * IAM HTTP surface (spec/IAM-v1.md §8).
 *
 * Plain node:http request/response objects, no framework, because the sync service is a
 * plain node server and adding Express here would be a second stack for one feature.
 *
 * Every handler enforces its own capability; nothing relies on the UI hiding a button.
 *
 * This file is the entry point: it identifies the request and hands it to one domain
 * module (`iam-api-auth`, `-org`, `-invitations`, `-admin`, `-boards`). The plumbing they
 * all use lives in `iam-http.mjs` and is re-exported here for existing callers.
 */
import { pathSegments } from "./http-boundary.mjs";
import { clientIp } from "./client-ip.mjs";
import { fail, sessionFromRequest } from "./iam-http.mjs";
import { iamContext } from "./iam-api-context.mjs";
import { handleAuthRoutes } from "./iam-api-auth.mjs";
import { handleOrgRoutes } from "./iam-api-org.mjs";
import { handleInvitations } from "./iam-api-invitations.mjs";
import { handleAdminRoutes } from "./iam-api-admin.mjs";
import { handleWebhookRoutes } from "./webhook-api.mjs";
import { handleIntegrationRoutes } from "./integration-api.mjs";
import { handleAppRoutes } from "./app-api.mjs";
import { handleBoardRoutes } from "./iam-api-boards.mjs";
import { handleComments } from "./comments-api.mjs";

export {
  accessForBoard,
  fail,
  json,
  linkUnlockCookie,
  linkUnlockToken,
  readBody,
  sessionFromRequest,
} from "./iam-http.mjs";

/**
 * @returns {Promise<boolean>} true when the request was an IAM route.
 */
export async function handleIam({
  request,
  response,
  url,
  store,
  log = console,
  onAclChanged = null,
  onUserSuspended = null,
  onCommentsChanged = null,
}) {
  if (
    !url.pathname.startsWith("/auth") &&
    !url.pathname.startsWith("/orgs") &&
    !url.pathname.startsWith("/boards/") &&
    !url.pathname.startsWith("/invitations/")
  ) {
    return false;
  }
  if (!store.createUser) {
    // The disk store has no IAM tables; say so instead of pretending.
    fail(response, 501, "IAM_UNAVAILABLE", "accounts need the postgres store");
    return true;
  }

  const secure = process.env.NODE_ENV === "production";
  const session = await sessionFromRequest(request, store);
  const user = session?.user ?? null;
  const ip = clientIp(request);

  const method = request.method ?? "GET";
  // Each segment is percent-decoded once (ADR-148): a board id may be non-ASCII,
  // and using the wire form as the id made one board two.
  const parts = pathSegments(url);

  const audit = (event) =>
    store
      .recordAudit({
        requestId: request.headers["x-request-id"] ?? null,
        sessionId: session?.sessionId ?? null,
        ...event,
      })
      .catch((error) => log.error("[iam] audit failed:", error.message));

  const base = {
    request,
    response,
    url,
    method,
    parts,
    store,
    log,
    secure,
    ip,
    audit,
    session,
    user,
    onCommentsChanged,
  };

  if (await handleAuthRoutes(base)) return true;

  const ctx = {
    ...base,
    ...iamContext({ request, response, store, log, session, user, audit, onAclChanged, onUserSuspended }),
  };

  // Each module answers only for its own routes and says whether it did.
  if (await handleOrgRoutes(ctx)) return true;
  if (await handleWebhookRoutes(ctx)) return true;
  if (await handleIntegrationRoutes(ctx)) return true;
  if (await handleAppRoutes(ctx)) return true;
  if (await handleInvitations(ctx)) return true;
  if (await handleAdminRoutes(ctx)) return true;
  if (await handleComments(ctx)) return true;
  if (await handleBoardRoutes(ctx)) return true;
  return false;
}
