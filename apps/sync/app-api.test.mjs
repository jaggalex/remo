/**
 * First-party apps against a real database (ADR-098).
 *
 * The promise of this stage: an organisation installs an app by id, the server writes its
 * own manifest, the panel is declared rather than coded, disabling removes the whole
 * surface, and invoking an action is audited and observable — while never widening the
 * caller's access.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { handleIam, sessionFromRequest } from "./iam-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("apps API");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();
const email = (tag) => `apps-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

beforeAll(async () => {
  if (!reachable) return;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (await handleIam({ request, response, url, store })) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) await store.close();
});

function client() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie };
  };
}

async function withToken(method, path, secret, body = null) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function setup(tag) {
  const owner = client();
  const registered = await owner("POST", "/auth/register", {
    email: email(tag),
    password,
    name: tag,
  });
  const orgId = registered.body.org.id;
  const board = await owner("POST", `/orgs/${orgId}/boards`, { title: `${tag} board` });
  return { owner, orgId, boardId: board.body.board.id, userId: registered.body.user.id };
}

const install = (owner, orgId, appId = "app.hello") =>
  owner("POST", `/orgs/${orgId}/apps`, { appId });

const invoke = (owner, orgId, boardId, action = "app.hello") =>
  owner("POST", `/orgs/${orgId}/apps/app.hello/invoke`, { boardId, action });

suite("first-party apps", () => {
  it("installs by id and lists the declared panel", async () => {
    const { owner, orgId } = await setup("install");
    const created = await install(owner, orgId);
    expect(created.status).toBe(201);
    expect(created.body.app).toMatchObject({
      appId: "app.hello",
      version: 1,
      state: "enabled",
      capabilities: ["board.read"],
    });
    expect(created.body.app.panel.children).toHaveLength(2);

    const list = await owner("GET", `/orgs/${orgId}/apps`);
    expect(list.status).toBe(200);
    expect(list.body.apps.map((app) => app.appId)).toEqual(["app.hello"]);
  });

  it("refuses an app that is not in the registry", async () => {
    const { owner, orgId } = await setup("unknown");
    const refused = await owner("POST", `/orgs/${orgId}/apps`, { appId: "app.evil" });
    expect(refused.status).toBe(404);
  });

  it("is admin-only", async () => {
    const { owner, orgId } = await setup("admin");
    const member = client();
    const registered = await member("POST", "/auth/register", {
      email: email("member"),
      password,
      name: "Member",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: registered.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    expect((await install(member, orgId)).status).toBe(403);
    // A reader sees what is installed (the panel is on the board); changing it is admin.
    const list = await member("GET", `/orgs/${orgId}/apps`);
    expect(list.status).toBe(200);
    expect(list.body.apps).toEqual([]);
  });

  it("does not list another organisation's apps", async () => {
    const { owner, orgId } = await setup("list-owner");
    await install(owner, orgId);
    const { owner: stranger } = await setup("list-stranger");
    expect((await stranger("GET", `/orgs/${orgId}/apps`)).status).toBe(404);
  });

  it("runs app.hello with the caller's own name, audited and observable", async () => {
    const { owner, orgId, boardId, userId } = await setup("invoke");
    await install(owner, orgId);

    const ran = await invoke(owner, orgId, boardId);
    expect(ran.status).toBe(200);
    expect(ran.body.result).toEqual({
      message: { key: "apps.hello.greeting", params: { username: "invoke" } },
    });

    const { rows } = await store.pool.query(
      `select actor_id, action, subject from audit_events
        where org_id = $1 and action = 'app.invoked' order by at desc limit 1`,
      [orgId],
    );
    expect(rows[0]).toMatchObject({ actor_id: userId, action: "app.invoked", subject: "app.hello" });

    const events = await store.listBoardEvents(boardId);
    const invoked = events.find((event) => event.type === "app.invoked");
    expect(invoked).toMatchObject({ subject: "app.hello", payload: { action: "app.hello" } });

    const unknown = await invoke(owner, orgId, boardId, "app.nope");
    expect(unknown.status).toBe(422);
  });

  it("removes the whole surface when the app is disabled, and restores it", async () => {
    const { owner, orgId, boardId } = await setup("disable");
    await install(owner, orgId);

    const disabled = await owner("PATCH", `/orgs/${orgId}/apps/app.hello`, { enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.app.state).toBe("disabled");
    expect((await owner("GET", `/orgs/${orgId}/apps`)).body.apps).toEqual([]);
    expect((await invoke(owner, orgId, boardId)).status).toBe(404);

    const enabled = await owner("PATCH", `/orgs/${orgId}/apps/app.hello`, { enabled: true });
    expect(enabled.status).toBe(200);
    expect((await invoke(owner, orgId, boardId)).status).toBe(200);

    const removed = await owner("DELETE", `/orgs/${orgId}/apps/app.hello`);
    expect(removed.status).toBe(200);
    expect((await invoke(owner, orgId, boardId)).status).toBe(404);
  });

  it("never widens the caller's access: another board or a weaker scope is refused", async () => {
    const { owner, orgId, boardId } = await setup("access");
    await install(owner, orgId);

    // A board from another organisation is not visible through this organisation's app.
    const stranger = await setup("stranger");
    const foreign = await invoke(owner, orgId, stranger.boardId);
    expect(foreign.status).toBe(404);

    // A token without board.read cannot invoke.
    const readOnly = await owner("POST", `/orgs/${orgId}/integration-tokens`, {
      label: "reader",
      scopes: ["board.edit"],
    });
    const denied = await withToken(
      "POST",
      `/orgs/${orgId}/apps/app.hello/invoke`,
      readOnly.body.secret,
      { boardId, action: "app.hello" },
    );
    expect(denied.body.error).toBe("SCOPE_REQUIRED");
    expect(denied.status).toBe(403);

    const reader = await owner("POST", `/orgs/${orgId}/integration-tokens`, {
      label: "reader",
      scopes: ["board.read"],
    });
    const allowed = await withToken(
      "POST",
      `/orgs/${orgId}/apps/app.hello/invoke`,
      reader.body.secret,
      { boardId, action: "app.hello" },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.result.message.params.username).toBe("reader");
  });
});
