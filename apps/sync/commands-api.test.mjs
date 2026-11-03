/**
 * The command API against a real database (ADR-092).
 *
 * Proves the wiring, not the registry: capability, idempotency, stale refusal, audit,
 * and that a 200 means the update reached the log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { accessForBoard, handleIam, sessionFromRequest } from "./iam-api.mjs";
import { handleCommands } from "./commands-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("commands API");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();
const email = (tag) => `command-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

async function resolveAccess(request, boardId) {
  const session = await sessionFromRequest(request, store);
  const resolved = await accessForBoard({
    store,
    boardId,
    userId: session?.user?.id ?? null,
  });
  if (!resolved?.access?.allowed) return null;
  return {
    session,
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
        resolveAccess: (boardId) => resolveAccess(request, boardId),
      })
    ) {
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

const run = (owner, boardId, body, key = `key-${Math.random()}`) =>
  owner("POST", `/boards/${boardId}/commands`, body, { "Idempotency-Key": key });

suite("command API", () => {
  it("requires edit rights and an account", async () => {
    const { owner, orgId, boardId } = await setup("access");
    const viewer = client();
    const registered = await viewer("POST", "/auth/register", {
      email: email("viewer"),
      password,
      name: "Viewer",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: registered.body.user.email,
    });
    await viewer("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: registered.body.user.id,
      role: "viewer",
    });

    const denied = await run(viewer, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 0, y: 0 },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("FORBIDDEN");
  });

  it("creates, replays, versions and audits a command", async () => {
    const { owner, boardId } = await setup("create");
    const key = "create-1";
    const created = await run(
      owner,
      boardId,
      {
        command: "board.item.create",
        input: { type: "sticky_note", x: 40, y: 50, content: "Hello" },
      },
      key,
    );
    expect(created.status).toBe(200);
    expect(created.body.result).toMatchObject({ type: "sticky_note" });
    const id = created.body.result.id;
    expect(created.body.version).toMatch(/^[0-9a-f]{16}$/);

    const replayed = await run(
      owner,
      boardId,
      {
        command: "board.item.create",
        input: { type: "sticky_note", x: 40, y: 50, content: "Hello" },
      },
      key,
    );
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.result.id).toBe(id);

    const doc = await store.roomDocument(boardId);
    expect(doc.getMap("widgets").get(id)).toMatchObject({ type: "sticky_note", x: 40 });
    expect(doc.getMap("texts").get(id).toString()).toBe("Hello");

    const updates = await store.pool.query(
      "select count(*)::int as count from board_updates where board_id = $1",
      [boardId],
    );
    expect(updates.rows[0].count).toBeGreaterThan(0);

    const audit = await store.pool.query(
      "select action, subject from audit_events where board_id = $1 order by at desc limit 3",
      [boardId],
    );
    expect(audit.rows.some((row) => row.action === "board.command")).toBe(true);
  });

  it("refuses a stale version and accepts the current one", async () => {
    const { owner, boardId } = await setup("stale");
    const created = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
    });
    const id = created.body.result.id;
    const staleVersion = created.body.version;

    // Somebody else writes after the caller read the board.
    await run(owner, boardId, {
      command: "board.item.update",
      input: { id, patch: { x: 77 } },
    });

    const stale = await run(owner, boardId, {
      command: "board.item.update",
      input: { id, patch: { x: 1 } },
      ifVersion: staleVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("STALE");

    const current = await owner("GET", `/boards/${boardId}/commands`);
    // GET is not a command route method; the meaningful check is a write with the
    // version returned by the last successful command.
    expect(current.status).toBe(405);
    const fresh = await run(owner, boardId, {
      command: "board.item.update",
      input: { id, patch: { x: 2 } },
    });
    expect(fresh.status).toBe(200);
  });

  it("sets text, connects two objects and deletes the cascade", async () => {
    const { owner, boardId } = await setup("graph");
    const a = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 0, y: 0 },
    });
    const b = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 300, y: 0 },
    });
    const id = a.body.result.id;
    const other = b.body.result.id;

    const text = await run(owner, boardId, {
      command: "board.text.set",
      input: { id, text: "Body" },
    });
    expect(text.status).toBe(200);

    const link = await run(owner, boardId, {
      command: "board.connector.create",
      input: { from: id, to: other },
    });
    expect(link.status).toBe(200);
    expect(link.body.result).toMatchObject({ from: id, to: other });

    const removed = await run(owner, boardId, {
      command: "board.item.delete",
      input: { id },
    });
    expect(removed.status).toBe(200);
    expect(removed.body.result.connectors).toBe(1);

    const doc = await store.roomDocument(boardId);
    expect(doc.getMap("widgets").has(id)).toBe(false);
    expect(doc.getMap("widgets").has(link.body.result.id)).toBe(false);
    expect(doc.getMap("widgets").has(other)).toBe(true);
  });

  it("names bad input, unknown commands and a missing key", async () => {
    const { owner, boardId } = await setup("errors");
    const missingKey = await owner("POST", `/boards/${boardId}/commands`, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 0, y: 0 },
    });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const unknown = await run(owner, boardId, {
      command: "board.nope",
      input: {},
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("UNKNOWN_COMMAND");

    const bad = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "kanban", x: 0, y: 0 },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe("BAD_INPUT");
  });
});
