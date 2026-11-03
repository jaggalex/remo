/**
 * Integration tokens against a real database (ADR-096).
 *
 * The point of the suite is the sentence in the roadmap: a token may do no more than its
 * scope, and no more than the person who created it. Both halves are checked against the
 * real command route and the real read route.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { accessForBoard, handleIam, sessionFromRequest } from "./iam-api.mjs";
import { handleCommands } from "./commands-api.mjs";
import { readBoard } from "./sync-read-api.mjs";
import { hashIntegrationToken, newIntegrationToken } from "./integrations.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("integration tokens");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();
const email = (tag) => `token-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

async function resolveAccess(request, boardId, caller = null) {
  const session = caller ? null : await sessionFromRequest(request, store);
  const resolved = await accessForBoard({
    store,
    boardId,
    userId: caller?.user?.id ?? session?.user?.id ?? null,
  });
  if (!resolved?.access?.allowed) return null;
  return {
    session,
    caller,
    resolved,
    board: resolved.facts.board,
    iam: await store.getIamBoard(boardId),
  };
}

beforeAll(async () => {
  if (!reachable) return;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (await handleIam({ request, response, url, store })) return;
    if (
      await handleCommands({
        request,
        response,
        url,
        store,
        getDocument: (boardId) => store.roomDocument(boardId),
        resolveAccess: (boardId, caller) => resolveAccess(request, boardId, caller),
      })
    ) {
      return;
    }
    const boardMatch = url.pathname.match(/^\/boards\/(.+)$/);
    if (boardMatch && request.method === "GET") {
      const boardId = decodeURIComponent(boardMatch[1]).replace(/\/widgets$/, "");
      await readBoard({ store, request, response, url, boardId });
      return;
    }
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

/** A raw HTTP call with a bearer token, no cookie. */
async function withToken(method, path, secret, body = null, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
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

async function createToken(owner, orgId, scopes, extra = {}) {
  return owner("POST", `/orgs/${orgId}/integration-tokens`, {
    label: "integration",
    scopes,
    ...extra,
  });
}

const createNote = (secret, boardId, key = `key-${Math.random()}`) =>
  withToken(
    "POST",
    `/boards/${boardId}/commands`,
    secret,
    { command: "board.item.create", input: { type: "sticky_note", x: 1, y: 2 } },
    { "Idempotency-Key": key },
  );

suite("integration tokens", () => {
  it("shows the secret once and lists tokens without it", async () => {
    const { owner, orgId } = await setup("create");
    const created = await createToken(owner, orgId, ["board.read", "board.edit"]);
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^remo_it_/);
    expect(created.body.token).toMatchObject({
      label: "integration",
      scopes: ["board.read", "board.edit"],
    });
    expect(created.body.token.expiresAt).toBeTruthy();

    const list = await owner("GET", `/orgs/${orgId}/integration-tokens`);
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0].secret).toBeUndefined();
    expect(list.body.tokens[0].id).toBe(created.body.token.id);
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

    const denied = await member("POST", `/orgs/${orgId}/integration-tokens`, {
      label: "mine",
      scopes: ["board.read"],
    });
    expect(denied.status).toBe(403);
  });

  it("refuses unknown scopes and open-ended lifetimes", async () => {
    const { owner, orgId } = await setup("validate");
    const badScope = await createToken(owner, orgId, ["board.delete"]);
    expect(badScope.status).toBe(422);
    expect(badScope.body.error).toBe("BAD_SCOPES");

    const noScopes = await createToken(owner, orgId, []);
    expect(noScopes.status).toBe(422);
    expect(noScopes.body.error).toBe("SCOPES_REQUIRED");

    const forever = await createToken(owner, orgId, ["board.read"], { expiresInDays: 4000 });
    expect(forever.status).toBe(422);
    expect(forever.body.error).toBe("BAD_EXPIRY");
  });

  it("runs a command when the token carries board.edit, and audits the token", async () => {
    const { owner, orgId, boardId } = await setup("write");
    const created = await createToken(owner, orgId, ["board.edit"]);
    const secret = created.body.secret;

    const ran = await createNote(secret, boardId);
    expect(ran.status).toBe(200);
    expect(ran.body.result.type).toBe("sticky_note");

    const events = await store.listBoardEvents(boardId);
    expect(events).toHaveLength(1);

    const { rows } = await store.pool.query(
      `select actor_type, actor_id from audit_events
        where board_id = $1 and action = 'board.command'
        order by at desc limit 1`,
      [boardId],
    );
    expect(rows[0]).toMatchObject({
      actor_type: "integration",
      actor_id: created.body.token.id,
    });
  });

  it("does not reach a board of another organisation, even one its owner can edit", async () => {
    const { owner: colleague, orgId: otherOrg, boardId } = await setup("other-org");
    const member = client();
    const registered = await member("POST", "/auth/register", {
      email: email("other-member"),
      password,
      name: "Member",
    });
    const invite = await colleague("POST", `/orgs/${otherOrg}/invitations`, {
      email: registered.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await colleague("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: registered.body.user.id,
      role: "editor",
    });
    // A token minted in the member's personal workspace, where they are an admin.
    const created = await createToken(member, registered.body.org.id, ["board.read", "board.edit"]);
    const secret = created.body.secret;

    expect((await createNote(secret, boardId)).status).toBe(404);
    expect((await withToken("GET", `/boards/${boardId}/objects`, secret)).status).toBe(404);
  });

  it("refuses a command when the token does not carry board.edit", async () => {
    const { owner, orgId, boardId } = await setup("readonly");
    const created = await createToken(owner, orgId, ["board.read"]);

    const denied = await createNote(created.body.secret, boardId);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("SCOPE_REQUIRED");
    expect(await store.listBoardEvents(boardId)).toHaveLength(0);
  });

  it("reads board content with board.read, and refuses a token without it", async () => {
    const { owner, orgId, boardId } = await setup("read");
    const reader = await createToken(owner, orgId, ["board.read"]);
    const writer = await createToken(owner, orgId, ["board.edit"]);

    // One board's projection is the integration's read surface; the UI's board metadata
    // stays session-only.
    const read = await withToken("GET", `/boards/${boardId}/widgets`, reader.body.secret);
    expect(read.status).toBe(200);
    expect(read.body.board.id).toBe(boardId);
    expect(Array.isArray(read.body.widgets)).toBe(true);

    const refused = await withToken("GET", `/boards/${boardId}/widgets`, writer.body.secret);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("SCOPE_REQUIRED");
  });

  it("never widens its owner's access", async () => {
    const { owner, orgId } = await setup("owner");
    const created = await createToken(owner, orgId, ["board.read", "board.edit"]);

    // Somebody else's board: the token's owner has no grant there.
    const stranger = await setup("stranger");
    const read = await withToken(
      "GET",
      `/boards/${stranger.boardId}/widgets`,
      created.body.secret,
    );
    expect(read.status).toBe(404);

    const write = await createNote(created.body.secret, stranger.boardId);
    expect(write.status).toBe(404);
  });

  it("refuses a revoked token", async () => {
    const { owner, orgId, boardId } = await setup("revoked");
    const created = await createToken(owner, orgId, ["board.edit"]);
    const revoked = await owner(
      "DELETE",
      `/orgs/${orgId}/integration-tokens/${created.body.token.id}`,
    );
    expect(revoked.status).toBe(200);

    const denied = await createNote(created.body.secret, boardId);
    expect(denied.status).toBe(401);
    expect(denied.body.error).toBe("INTEGRATION_TOKEN_REVOKED");
  });

  it("refuses an expired token and an unknown one", async () => {
    const { orgId, userId, boardId } = await setup("expired");
    const secret = newIntegrationToken();
    await store.createIntegrationToken({
      orgId,
      ownerId: userId,
      label: "expired",
      scopes: ["board.edit"],
      expiresAt: new Date(Date.now() - 1000),
      tokenHash: hashIntegrationToken(secret),
      createdBy: userId,
    });

    const expired = await createNote(secret, boardId);
    expect(expired.status).toBe(401);
    expect(expired.body.error).toBe("INTEGRATION_TOKEN_EXPIRED");

    const unknown = await createNote("remo_it_not-a-real-token", boardId);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe("INTEGRATION_TOKEN_UNKNOWN");
  });
});
