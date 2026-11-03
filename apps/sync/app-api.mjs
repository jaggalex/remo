/**
 * First-party apps in an organisation (ADR-098).
 *
 * Install takes an id and nothing else: the manifest written to the tenant is the one in
 * the server registry. The panel is listed to the board's readers; installing, disabling
 * and uninstalling are admin actions and audited.
 *
 * Invoking an action is not a board command: `app.hello` changes no document. The route
 * checks the caller's `board.read` on the board that opened the panel, checks the action's
 * declared capabilities, audits `app.invoked` and emits the same event to the outbox.
 */
import { accessForBoard, fail, json, readBody } from "./iam-http.mjs";
import { callerFromRequest, hasScope } from "./integrations.mjs";
import { getFirstPartyApp } from "./first-party-apps.mjs";

function publicView(row) {
  return {
    appId: row.app_id,
    version: row.version,
    state: row.state,
    panel: row.manifest?.panel ?? null,
    capabilities: row.manifest?.capabilities ?? [],
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

export async function handleAppRoutes(ctx) {
  const { request, response, url, store, method, parts, audit, requireUser, isOrgAdmin } = ctx;
  if (parts[0] !== "orgs" || parts[2] !== "apps") return false;

  const orgId = parts[1];

  // Invoke before the session gate: a person uses the cookie, an integration its token,
  // and `invoke` does that check itself (ADR-096, ADR-098).
  if (parts.length === 5 && parts[4] === "invoke" && method === "POST") {
    return invoke({ request, response, store, audit, orgId, appId: parts[3] });
  }

  const me = requireUser();
  if (!me) return true;

  if (parts.length === 3 && method === "GET") {
    const seat = await store.getOrgMembership(orgId, me.id);
    if (seat?.state !== "active") {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    }
    const rows = await store.listOrgApps(orgId);
    const apps = rows
      .filter((row) => row.state === "enabled")
      .map(publicView);
    json(response, 200, { apps });
    return true;
  }

  if (!(await isOrgAdmin(orgId, me.id))) {
    return fail(response, 403, "FORBIDDEN", "only an organisation admin can manage apps"), true;
  }

  if (parts.length === 3 && method === "POST") {
    const body = await readBody(request);
    const app = getFirstPartyApp(String(body?.appId ?? ""));
    if (!app) {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this app is not available"), true;
    }
    const row = await store.installOrgApp({
      orgId,
      appId: app.id,
      version: app.version,
      // The registry's manifest, never the request's.
      manifest: {
        id: app.id,
        version: app.version,
        nameKey: app.nameKey,
        descriptionKey: app.descriptionKey,
        capabilities: app.capabilities ?? [],
        panel: app.panel,
      },
      installedBy: me.id,
    });
    await audit({ actorId: me.id, orgId, action: "app.installed", subject: app.id });
    json(response, 201, { app: publicView(row) });
    return true;
  }

  const appId = parts[3] ?? null;
  if (!appId) return false;

  if (parts.length === 4 && method === "PATCH") {
    const body = await readBody(request);
    const row = await store.setOrgAppState({ orgId, appId, enabled: body?.enabled !== false });
    if (!row) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this app is not installed"), true;
    await audit({
      actorId: me.id,
      orgId,
      action: row.state === "enabled" ? "app.enabled" : "app.disabled",
      subject: appId,
    });
    json(response, 200, { app: publicView(row) });
    return true;
  }

  if (parts.length === 4 && method === "DELETE") {
    const removed = await store.removeOrgApp({ orgId, appId });
    if (!removed) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this app is not installed"), true;
    await audit({ actorId: me.id, orgId, action: "app.removed", subject: appId });
    json(response, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * Run one app action for the caller. A person uses the session, an integration its token;
 * either way the board's `board.read` is required, and the token additionally needs the
 * scope. The greeting names the caller, never anyone else.
 */
async function invoke({ request, response, store, audit, orgId, appId }) {
  const installed = await store.getOrgApp(orgId, appId);
  if (!installed || installed.state !== "enabled") {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this app is not installed");
    return true;
  }
  const app = getFirstPartyApp(appId);
  if (!app) {
    // The manifest is in the tenant but no longer in the build: refuse rather than guess.
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this app is not available");
    return true;
  }

  const body = (await readBody(request)) ?? {};
  const boardId = String(body.boardId ?? "");
  const actionId = String(body.action ?? "");
  const action = app.actions[actionId];
  if (!action) {
    fail(response, 422, "UNKNOWN_ACTION", `this app has no action ${actionId || "(empty)"}`);
    return true;
  }
  if (!boardId) {
    fail(response, 422, "BOARD_REQUIRED", "send the board the panel is open on");
    return true;
  }

  const caller = await callerFromRequest(request, store);
  if (caller?.kind === "refused") {
    fail(response, 401, caller.reason, "this integration token cannot be used");
    return true;
  }
  if (!caller) {
    fail(response, 403, "ACCOUNT_REQUIRED", "app actions need an account or an integration token");
    return true;
  }
  if (caller.kind === "integration" && !hasScope(caller, "board.read")) {
    fail(response, 403, "SCOPE_REQUIRED", "this token does not carry board.read");
    return true;
  }

  // The board must be the one this organisation owns and the caller must see it; a board
  // from another tenant is a 404, the same answer the read API gives.
  const resolved = await accessForBoard({ store, boardId, userId: caller.user.id });
  if (!resolved?.access?.allowed || resolved?.facts?.board?.orgId !== orgId) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "board not found");
    return true;
  }
  const missing = (action.capabilities ?? []).filter(
    (capability) => !resolved.access.capabilities.includes(capability),
  );
  if (missing.length) {
    fail(response, 403, "FORBIDDEN", `the board does not grant ${missing.join(", ")}`);
    return true;
  }

  const result = action.run({ user: caller.user, boardId });
  await audit({
    actorType: caller.kind,
    actorId: caller.kind === "integration" ? caller.token.id : caller.user.id,
    orgId,
    boardId,
    action: "app.invoked",
    subject: appId,
    after: { action: actionId },
  });
  if (typeof store.recordEvents === "function") {
    await store
      .recordEvents({
        boardId,
        orgId,
        actorId: caller.kind === "integration" ? caller.token.id : caller.user.id,
        actorType: caller.kind,
        events: [
          {
            type: "app.invoked",
            subject: appId,
            payload: { action: actionId },
          },
        ],
      })
      .catch(() => {
        /* an app action is not worth failing because the outbox is unhappy */
      });
  }
  json(response, 200, { appId, action: actionId, result });
  return true;
}
