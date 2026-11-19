/**
 * The event pipeline against a real database and a real HTTP receiver (ADR-094, ADR-095).
 *
 * One file on purpose: the outbox drain is a single global consumer, so two suites that
 * drain the same queue in parallel would fight over each other's rows. Everything that
 * exercises the pipeline — produce, drain, deliver, retry, dead-letter, replay — runs
 * here, in order.
 *
 * Proves the guarantees, not the SQL: an event exists if and only if the command was
 * recorded, a retry writes it once, the payload carries no board text, the signature
 * verifies over the bytes an integrator received, and a failing endpoint becomes a retry
 * and then a replayable dead letter.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { accessForBoard, handleIam, sessionFromRequest } from "./iam-api.mjs";
import { handleCommands } from "./commands-api.mjs";
import { createEventDrain, createWebhookConsumer } from "./sync-events.mjs";
import { sealWebhookSecret, signWebhook } from "./webhooks.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("events");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";
let receiver = null;
let receiverUrl = "";
let receiverStatus = 200;
const received = [];

const previousKek = process.env.REMO_KEK;
const previousAllowPrivate = process.env.REMO_WEBHOOK_ALLOW_PRIVATE;
const kek = { key: randomBytes(32), id: "test" };

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();
const email = (tag) => `events-${tag}-${stamp}@example.com`;
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
  process.env.REMO_KEK = kek.key.toString("base64");
  process.env.REMO_WEBHOOK_ALLOW_PRIVATE = "1";

  receiver = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
    response.writeHead(receiverStatus);
    response.end("ok");
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

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
  if (receiver) await new Promise((resolve) => receiver.close(resolve));
  if (store) await store.close();
  if (previousKek === undefined) delete process.env.REMO_KEK;
  else process.env.REMO_KEK = previousKek;
  if (previousAllowPrivate === undefined) delete process.env.REMO_WEBHOOK_ALLOW_PRIVATE;
  else process.env.REMO_WEBHOOK_ALLOW_PRIVATE = previousAllowPrivate;
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

const createNote = (owner, boardId, text = "Hello") =>
  run(owner, boardId, {
    command: "board.item.create",
    input: { type: "sticky_note", x: 1, y: 2, content: text },
  });

/** A drain whose consumer is the webhook; a no-op handler proves the queue alone. */
function drainWith(handle) {
  return createEventDrain({ store, log: { log() {}, error() {} }, handle });
}

function webhookDrain() {
  // This file proves the event/signature pipeline over a plain local receiver. The real
  // safe transport and its IP pinning are covered by outbound.test.mjs.
  return drainWith(
    createWebhookConsumer({
      store,
      kek,
      fetchImpl: (url, options) => fetch(url, options),
      log: { log() {}, error() {} },
    }),
  );
}

async function drainUntilQuiet(drain) {
  let guard = 0;
  while ((await drain.drain()) > 0 && guard < 50) guard += 1;
}

suite("event outbox", () => {
  it("writes one event for a create, and no board content in it", async () => {
    const { owner, boardId } = await setup("create");
    const created = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 10, y: 20, content: "Secret text" },
    });
    expect(created.status).toBe(200);
    const id = created.body.result.id;

    const events = await store.listBoardEvents(boardId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "board.item.created",
      subject: id,
      payload: { objectType: "sticky_note" },
    });
    expect(events[0].published_at).toBeNull();
    // The default event must be safe to hand to a third party (ADR-094).
    expect(JSON.stringify(events[0].payload)).not.toContain("Secret text");
  });

  it("writes it once when the same idempotency key is replayed", async () => {
    const { owner, boardId } = await setup("replay");
    const body = { command: "board.item.create", input: { type: "text", x: 0, y: 0 } };
    await run(owner, boardId, body, "same-key");
    await run(owner, boardId, body, "same-key");

    const events = await store.listBoardEvents(boardId);
    expect(events).toHaveLength(1);
  });

  it("drains in order, exactly once", async () => {
    const { owner, boardId } = await setup("drain");
    const seen = [];
    const drain = drainWith((row) => {
      seen.push(row.subject);
    });

    for (let index = 0; index < 3; index += 1) {
      await run(owner, boardId, {
        command: "board.item.create",
        input: { type: "sticky_note", x: index * 10, y: 0 },
      });
    }
    const before = await store.listBoardEvents(boardId);
    expect(before).toHaveLength(3);
    expect(before.every((event) => event.published_at === null)).toBe(true);

    // The outbox is global; earlier tests in this file left rows behind. Drain until the
    // queue is quiet, then assert this board's events: each delivered exactly once, in
    // insertion order.
    await drainUntilQuiet(drain);

    const after = await store.listBoardEvents(boardId);
    expect(after.every((event) => event.published_at)).toBe(true);
    const mine = seen.filter((subject) => after.some((event) => event.subject === subject));
    expect(mine).toEqual(after.map((event) => event.subject));
  });

  it("does not invent events for commands that declare none", async () => {
    const { owner, boardId } = await setup("update");
    const created = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 0, y: 0 },
    });
    const id = created.body.result.id;
    await run(owner, boardId, {
      command: "board.item.update",
      input: { id, patch: { x: 100 } },
    });

    const events = await store.listBoardEvents(boardId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("board.item.created");
  });

  it("writes no event when the command is refused", async () => {
    const { owner, orgId, boardId } = await setup("refused");
    const viewer = client();
    const registered = await viewer("POST", "/auth/register", {
      email: email("refused-viewer"),
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

    const events = await store.listBoardEvents(boardId);
    expect(events).toHaveLength(0);
  });

  it("writes one event when a connector is created by a command", async () => {
    const { owner, boardId } = await setup("connector-event");
    const first = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 0, y: 0 },
    });
    const second = await run(owner, boardId, {
      command: "board.item.create",
      input: { type: "sticky_note", x: 200, y: 0 },
    });

    const created = await run(owner, boardId, {
      command: "board.connector.create",
      input: { from: first.body.result.id, to: second.body.result.id, routing: "elbow" },
    });
    expect(created.status).toBe(200);

    const events = await store.listBoardEvents(boardId);
    const connectorEvent = events.find((event) => event.type === "board.connector.created");
    expect(connectorEvent).toMatchObject({
      subject: created.body.result.id,
      payload: {
        from: first.body.result.id,
        to: second.body.result.id,
      },
    });
  });

  it("takes an agent's batch once, even when a resumed chunk repeats it", async () => {
    const { orgId, userId, boardId } = await setup("agent-events");
    const batch = [
      {
        type: "board.item.created",
        subject: "card_1",
        payload: { objectType: "card" },
        dedupeKey: "change-set:cs-1:0:card:card_1",
      },
      {
        type: "board.item.created",
        subject: "card_2",
        payload: { objectType: "card" },
        dedupeKey: "change-set:cs-1:0:card:card_2",
      },
    ];
    const record = () =>
      store.recordEvents({
        boardId,
        orgId,
        actorId: userId,
        actorType: "agent",
        events: batch,
      });

    expect(await record()).toBe(2);
    // The same chunk applied again (a resume after a crash) writes nothing new.
    expect(await record()).toBe(0);

    const events = await store.listBoardEvents(boardId);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.subject)).toEqual(["card_1", "card_2"]);
    expect(events.every((event) => event.actor_type === "agent")).toBe(true);

    // And the same rows go out through the drain like any other event.
    const delivered = [];
    await drainUntilQuiet(
      drainWith((row) => {
        delivered.push(row.subject);
      }),
    );
    expect(delivered).toContain("card_1");
    expect(delivered).toContain("card_2");
  });
});

suite("organisation webhook", () => {
  it("refuses a plain-HTTP endpoint", async () => {
    const { owner, orgId } = await setup("http");
    const refused = await owner("PUT", `/orgs/${orgId}/webhook`, { url: "http://example.com/hook" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("BAD_BASE_URL");
  });

  it("shows the secret once and keeps a fingerprint", async () => {
    const { owner, orgId } = await setup("secret");
    const created = await owner("PUT", `/orgs/${orgId}/webhook`, {
      url: "https://hooks.example.test/remo",
    });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    expect(created.body.webhook).toMatchObject({
      configured: true,
      url: "https://hooks.example.test/remo",
      enabled: true,
    });
    expect(created.body.webhook.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const read = await owner("GET", `/orgs/${orgId}/webhook`);
    expect(read.status).toBe(200);
    expect(read.body.webhook.secret).toBeUndefined();
    expect(read.body.webhook.url).toBe("https://hooks.example.test/remo");
    expect(read.body.webhook.fingerprint).toBe(created.body.webhook.fingerprint);

    const rotated = await owner("POST", `/orgs/${orgId}/webhook/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.secret).toMatch(/^whsec_/);
    expect(rotated.body.secret).not.toBe(created.body.secret);
    expect(rotated.body.webhook.fingerprint).not.toBe(created.body.webhook.fingerprint);
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

    const denied = await member("PUT", `/orgs/${orgId}/webhook`, {
      url: "https://hooks.example.test/remo",
    });
    expect(denied.status).toBe(403);
  });

  it("delivers the same bytes it signed, and marks the event published", async () => {
    const { owner, orgId, boardId, userId } = await setup("deliver");
    const secret = "whsec_delivery_test";
    await store.saveOrgWebhook({
      orgId,
      url: receiverUrl,
      secret: sealWebhookSecret({ orgId, secret, kek }),
      createdBy: userId,
    });

    const drain = webhookDrain();
    // Anything earlier in this file belongs to a previous test; start from a quiet queue.
    await drainUntilQuiet(drain);

    const created = await createNote(owner, boardId);
    expect(created.status).toBe(200);
    received.length = 0;
    receiverStatus = 200;
    await drainUntilQuiet(drain);

    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery.headers["x-remo-event-type"]).toBe("board.item.created");
    const event = JSON.parse(delivery.body);
    expect(event).toMatchObject({
      type: "board.item.created",
      boardId,
      subject: created.body.result.id,
      payload: { objectType: "sticky_note" },
    });
    expect(delivery.body).not.toContain("Hello");

    const [timestamp, signature] = delivery.headers["x-remo-signature"].split(",");
    expect(signature).toBe(`v1=${signWebhook(secret, Number(timestamp.slice(2)), delivery.body)}`);

    const events = await store.listBoardEvents(boardId);
    expect(events[0].published_at).toBeTruthy();
    const hook = await store.getOrgWebhook(orgId);
    expect(hook.last_delivery_at).toBeTruthy();
  });

  it("turns a failing endpoint into a retry, and a dead letter after the last attempt", async () => {
    const { owner, orgId, boardId, userId } = await setup("dead");
    const secret = "whsec_dead_test";
    await store.saveOrgWebhook({
      orgId,
      url: receiverUrl,
      secret: sealWebhookSecret({ orgId, secret, kek }),
      createdBy: userId,
    });

    const drain = webhookDrain();
    await drainUntilQuiet(drain);

    await createNote(owner, boardId);
    received.length = 0;
    receiverStatus = 500;
    // One attempt with an hour-long retry: this test is about the schedule, not about
    // waiting out the production 10-second backoff. The shared pipeline's real backoff
    // is covered above; a loaded parallel suite must not turn it into a race.
    await store.drainEvents({
      limit: 10,
      maxAttempts: 8,
      delayMs: () => 3_600_000,
      handle: createWebhookConsumer({
        store,
        kek,
        fetchImpl: (url, options) => fetch(url, options),
        log: { log() {}, error() {} },
      }),
    });

    const [boardEvent] = await store.listBoardEvents(boardId);
    const [pending] = await store.listOrgEvents(orgId);
    expect(boardEvent.published_at).toBeNull();
    expect(pending.attempts).toBeGreaterThanOrEqual(1);
    expect(pending.next_attempt_at).toBeTruthy();
    expect(pending.last_error).toContain("500");
    const hook = await store.getOrgWebhook(orgId);
    expect(hook.last_error).toContain("500");

    // The next attempt is an hour away. Ask the queue about *this* row: the outbox is
    // shared with other test files in the run, so "the whole queue is quiet" is not a
    // promise this file can make.
    const due = await store.pool.query(
      `select id
         from event_outbox
        where id = $1 and published_at is null and dead_at is null
          and (next_attempt_at is null or next_attempt_at <= now())`,
      [pending.id],
    );
    expect(due.rows).toHaveLength(0);

    // Force the dead letter with one allowed attempt, then prove replay requeues it.
    await store.resetOrgEvents({ orgId, eventIds: [pending.id] });
    await store.drainEvents({
      limit: 10,
      maxAttempts: 1,
      handle: createWebhookConsumer({ store, kek, log: { log() {}, error() {} } }),
    });
    const [dead] = await store.listOrgEvents(orgId, { dead: true });
    expect(dead.id).toBe(pending.id);
    expect(dead.dead_at).toBeTruthy();

    receiverStatus = 200;
    const replayed = await owner("POST", `/orgs/${orgId}/webhook/replay`);
    expect(replayed.status).toBe(200);
    expect(replayed.body.requeued).toBeGreaterThanOrEqual(1);
    await drainUntilQuiet(drain);

    const [published] = await store.listBoardEvents(boardId);
    expect(published.published_at).toBeTruthy();
  });
});
