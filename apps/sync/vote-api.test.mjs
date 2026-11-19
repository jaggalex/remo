/**
 * Voting sessions against a real database (ADR-074).
 *
 * The rule is tested where it is enforced: the quota lives in the insert transaction,
 * the tally never names a voter, and a link visitor votes under a signed token.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { accessForBoard, handleIam, sessionFromRequest } from "./iam-api.mjs";
import { handleVotes } from "./vote-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("vote API");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();
const email = (tag) => `vote-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

/** Production resolves the session from the cookie; the test does the same lookup. */
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
      await handleVotes({
        request,
        response,
        url,
        store,
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

async function startSession(owner, boardId, over = {}) {
  return owner("POST", `/boards/${boardId}/vote-sessions`, {
    objectIds: ["n1", "n2", "n3"],
    votesPerSubject: 2,
    minutes: 10,
    ...over,
  });
}

/** A second account with a viewer grant: the smallest "someone else voted" setup. */
async function addViewer(owner, orgId, boardId, tag, name) {
  const person = client();
  const registered = await person("POST", "/auth/register", {
    email: email(tag),
    password,
    name,
  });
  const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
    email: registered.body.user.email,
  });
  await person("POST", "/invitations/accept", {
    token: new URL(invite.body.url).searchParams.get("invite"),
  });
  await owner("POST", `/boards/${boardId}/grants`, {
    subjectType: "user",
    subjectId: registered.body.user.id,
    role: "viewer",
  });
  return { person, userId: registered.body.user.id };
}

function objectRow(breakdown, objectId) {
  return breakdown.objects.find((row) => row.object_id === objectId);
}

suite("vote API", () => {
  it("lets only a facilitator start a session, and refuses a second open one", async () => {
    const { owner, orgId, boardId } = await setup("start");
    const viewer = client();
    const viewerReg = await viewer("POST", "/auth/register", {
      email: email("viewer"),
      password,
      name: "Viewer",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: viewerReg.body.user.email,
    });
    await viewer("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: viewerReg.body.user.id,
      role: "viewer",
    });

    const refused = await startSession(viewer, boardId);
    expect(refused.status).toBe(403);

    const started = await startSession(owner, boardId, { objectIds: ["n1", "n2"], votesPerSubject: 3 });
    expect(started.status).toBe(201);
    expect(started.body.session).toMatchObject({ state: "open", votesPerSubject: 3 });
    expect(started.body.session.objectIds).toEqual(["n1", "n2"]);

    const second = await startSession(owner, boardId);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("VOTE_SESSION_OPEN");
  });

  it("enforces the quota in the server and returns an aggregate tally only", async () => {
    const { owner, boardId } = await setup("quota");
    const started = await startSession(owner, boardId, {
      objectIds: ["n1", "n2", "n3"],
      votesPerSubject: 2,
    });
    const id = started.body.session.id;

    const first = await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    expect(first.status).toBe(200);
    expect(first.body.session).toMatchObject({ myVotes: 1, remaining: 1 });

    const second = await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    expect(second.status).toBe(200);
    expect(second.body.session.remaining).toBe(0);

    const third = await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n3" });
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("vote_budget_exhausted");

    const read = await owner("GET", `/vote-sessions/${id}`);
    expect(read.body.session.votes).toEqual([
      { object_id: "n1", votes: 1 },
      { object_id: "n2", votes: 1 },
    ]);
    // Anonymity: the payload has no subject ids at all.
    expect(JSON.stringify(read.body)).not.toContain("user:");
  });

  it("shares one quota between two sessions of the same account", async () => {
    const tag = "two-sessions";
    const { owner, boardId } = await setup(tag);
    const started = await startSession(owner, boardId, {
      objectIds: ["n1", "n2"],
      votesPerSubject: 1,
    });
    const id = started.body.session.id;
    expect((await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" })).status).toBe(
      200,
    );

    // A second browser signs into the same account. It is a separate presence session,
    // not a second voter: the subject is `user:<id>` (ADR-074, ADR-151).
    const second = client();
    const login = await second("POST", "/auth/login", {
      email: email(tag),
      password,
    });
    expect(login.status).toBe(200);
    const over = await second("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("vote_budget_exhausted");

    const read = await second("GET", `/vote-sessions/${id}`);
    expect(read.body.session).toMatchObject({ myVotes: 1, remaining: 0 });
    expect(read.body.session.votes).toEqual([{ object_id: "n1", votes: 1 }]);
  });

  it("withdraws a vote and gives the quota back", async () => {
    const { owner, boardId } = await setup("withdraw");
    const started = await startSession(owner, boardId, { votesPerSubject: 1, objectIds: ["n1", "n2"] });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    const withdrawn = await owner("DELETE", `/vote-sessions/${id}/votes/n1`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.session.remaining).toBe(1);
    expect(withdrawn.body.session.votes).toEqual([]);
  });

  it("extends and ends a session; a vote after the end is refused", async () => {
    const { owner, boardId } = await setup("lifecycle");
    const started = await startSession(owner, boardId, { minutes: 5 });
    const id = started.body.session.id;
    const before = new Date(started.body.session.endsAt).getTime();

    const extended = await owner("POST", `/vote-sessions/${id}/extend`, { minutes: 5 });
    expect(extended.status).toBe(200);
    expect(new Date(extended.body.session.endsAt).getTime()).toBeGreaterThan(before);

    const ended = await owner("POST", `/vote-sessions/${id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.session.state).toBe("ended");

    const late = await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("VOTE_SESSION_CLOSED");
  });

  it("publishes results only after the end", async () => {
    const { owner, boardId } = await setup("publish");
    const started = await startSession(owner, boardId, { votesPerSubject: 1 });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });

    const early = await owner("POST", `/vote-sessions/${id}/publish`);
    expect(early.status).toBe(409);

    await owner("POST", `/vote-sessions/${id}/end`);
    const published = await owner("POST", `/vote-sessions/${id}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.session.publishedAt).toBeTruthy();
    expect(published.body.results.objects[0]).toMatchObject({ object_id: "n2", votes: 1 });
  });

  it("gives a late joiner their own full quota", async () => {
    const { owner, orgId, boardId } = await setup("late");
    const member = client();
    const registered = await member("POST", "/auth/register", {
      email: email("late-member"),
      password,
      name: "Late",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: registered.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: registered.body.user.id,
      role: "viewer",
    });

    const started = await startSession(owner, boardId, { votesPerSubject: 2 });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });

    const late = await member("GET", `/vote-sessions/${id}`);
    expect(late.status).toBe(200);
    expect(late.body.session).toMatchObject({ myVotes: 0, remaining: 2 });
    // The other person's vote is visible in the tally but not as a person.
    expect(late.body.session.votes).toEqual([{ object_id: "n1", votes: 1 }]);
    expect(late.body.session.voters).toBe(1);

    const voted = await member("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    expect(voted.status).toBe(200);
    expect(voted.body.session.remaining).toBe(1);
  });

  it("lets a link visitor vote under a signed token, with a quota per visitor", async () => {
    const { owner, boardId } = await setup("visitor");
    await owner("PUT", `/boards/${boardId}/link`, { enabled: true });
    const started = await startSession(owner, boardId, { votesPerSubject: 1, objectIds: ["n1", "n2"] });
    const id = started.body.session.id;

    const visitor = client();
    const first = await visitor("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    expect(first.status).toBe(200);
    expect(first.cookie).toMatch(/^remo_visitor=/);
    expect(first.body.session.myVotes).toBe(1);

    const over = await visitor("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("vote_budget_exhausted");

    // A different browser is a different visitor with its own quota.
    const other = client();
    const second = await other("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    expect(second.status).toBe(200);
    expect(second.body.session.votes).toEqual(
      expect.arrayContaining([
        { object_id: "n1", votes: 1 },
        { object_id: "n2", votes: 1 },
      ]),
    );
  });

  it("pins the end to the board timer when asked", async () => {
    const { owner, boardId } = await setup("pinned");
    const endsAt = new Date(Date.now() + 7 * 60_000).toISOString();
    const started = await startSession(owner, boardId, { minutes: 1, endsAt });
    expect(started.status).toBe(201);
    expect(Math.abs(new Date(started.body.session.endsAt).getTime() - new Date(endsAt).getTime())).toBeLessThan(2_000);

    // A deadline in the past is not a session.
    const refused = await startSession(owner, boardId, {
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(refused.status).toBe(422);
  });

  it("reads an expired open session as ended and refuses to change it", async () => {
    const { owner, boardId } = await setup("expired");
    const started = await startSession(owner, boardId, { votesPerSubject: 2, objectIds: ["n1", "n2"] });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    await store.pool.query(
      "update vote_sessions set ends_at = now() - interval '1 minute' where id = $1",
      [id],
    );

    const read = await owner("GET", `/vote-sessions/${id}`);
    expect(read.body.session.state).toBe("ended");
    expect(read.body.session.endedAt).toBe(read.body.session.endsAt);

    // The clock closed the session even though nobody wrote `state`.
    const late = await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("VOTE_SESSION_CLOSED");

    const withdrawn = await owner("DELETE", `/vote-sessions/${id}/votes/n1`);
    expect(withdrawn.status).toBe(409);

    const extended = await owner("POST", `/vote-sessions/${id}/extend`, { minutes: 1 });
    expect(extended.status).toBe(409);

    // An expired session is over, so its results can be published.
    const published = await owner("POST", `/vote-sessions/${id}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.session.publishedAt).toBeTruthy();
  });

  it("names voters only in an ended open session, and never by subject id", async () => {
    const { owner, orgId, boardId, userId } = await setup("open");
    const { person: bob } = await addViewer(owner, orgId, boardId, "open-bob", "Bob");
    await owner("PUT", `/boards/${boardId}/link`, { enabled: true });

    const started = await startSession(owner, boardId, { votesPerSubject: 2, anonymous: false });
    const id = started.body.session.id;

    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    await bob("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    await bob("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    const guestOne = client();
    await guestOne("POST", `/vote-sessions/${id}/votes`, { objectId: "n2" });
    const guestTwo = client();
    await guestTwo("POST", `/vote-sessions/${id}/votes`, { objectId: "n3" });

    // While the session runs, open or not, the payload is the aggregate and nothing else:
    // a live count must not become a way to pressure an individual voter.
    const during = await owner("GET", `/vote-sessions/${id}`);
    expect(during.body.session.state).toBe("open");
    expect(during.body.session.breakdown).toBeUndefined();
    expect(JSON.stringify(during.body)).not.toMatch(/user:|visitor:/);

    await owner("POST", `/vote-sessions/${id}/end`);
    const after = await owner("GET", `/vote-sessions/${id}`);
    const breakdown = after.body.session.breakdown;
    expect(breakdown).toBeTruthy();

    // Per object: accounts with their own count, guests as one number.
    expect(objectRow(breakdown, "n1").voters).toEqual([
      { name: "Bob", votes: 1 },
      { name: "open", votes: 1 },
    ]);
    expect(objectRow(breakdown, "n1").guests).toEqual({ voters: 0, votes: 0 });
    expect(objectRow(breakdown, "n2")).toMatchObject({
      voters: [{ name: "Bob", votes: 1 }],
      guests: { voters: 1, votes: 1 },
    });
    // A guest's vote alone still makes a row: the object was voted for.
    expect(objectRow(breakdown, "n3")).toMatchObject({
      voters: [],
      guests: { voters: 1, votes: 1 },
    });
    // Per person: one row each, the total spread over the session and how many objects.
    expect(breakdown.summary).toEqual([
      { name: "Bob", total: 2, objects: 2 },
      { name: "open", total: 1, objects: 1 },
    ]);
    // Guests are counted, never listed, and no id of any kind leaves the server.
    expect(breakdown.guests).toEqual({ voters: 2, votes: 2 });
    expect(JSON.stringify(breakdown)).not.toMatch(/user:|visitor:/);
    expect(JSON.stringify(breakdown)).not.toContain(userId);

    // The published card is built from the aggregate: publishing adds no names.
    const published = await owner("POST", `/vote-sessions/${id}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.results).toEqual({
      objects: [
        { object_id: "n1", votes: 2 },
        { object_id: "n2", votes: 2 },
        { object_id: "n3", votes: 1 },
      ],
      voters: 4,
    });
    expect(JSON.stringify(published.body.results)).not.toMatch(/Bob|user:|visitor:/);
  });

  it("keeps an ended anonymous session a pure aggregate", async () => {
    const { owner, orgId, boardId } = await setup("anon");
    const { person } = await addViewer(owner, orgId, boardId, "anon-viewer", "Ann");

    const started = await startSession(owner, boardId, { anonymous: true });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    await person("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    await owner("POST", `/vote-sessions/${id}/end`);

    const after = await owner("GET", `/vote-sessions/${id}`);
    expect(after.body.session.state).toBe("ended");
    expect(after.body.session.voters).toBe(2);
    expect(after.body.session.votes).toEqual([{ object_id: "n1", votes: 2 }]);
    // ADR-088 stays absolute here: no field joins a vote to a person.
    expect(after.body.session.breakdown).toBeUndefined();
    expect(JSON.stringify(after.body)).not.toMatch(/user:|visitor:|Ann/);
  });

  it("shows voters of a session the clock ended", async () => {
    const { owner, boardId } = await setup("open-expired");
    const started = await startSession(owner, boardId, {
      votesPerSubject: 1,
      objectIds: ["n1"],
      anonymous: false,
    });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    await store.pool.query(
      "update vote_sessions set ends_at = now() - interval '1 minute' where id = $1",
      [id],
    );

    const read = await owner("GET", `/vote-sessions/${id}`);
    expect(read.body.session.state).toBe("ended");
    expect(read.body.session.breakdown.summary).toEqual([
      { name: "open-expired", total: 1, objects: 1 },
    ]);
  });

  it("reports an account that no longer exists without inventing a name", async () => {
    const { owner, boardId } = await setup("deleted");

    const started = await startSession(owner, boardId, { anonymous: false, objectIds: ["n1", "n2"] });
    const id = started.body.session.id;
    await owner("POST", `/vote-sessions/${id}/votes`, { objectId: "n1" });
    // A vote outlives its account: `votes` stores the subject, `users` may lose the row.
    // A real deletion is refused here only because the test's organisation points at its
    // creator, so the orphan subject is planted directly — the read path is the same.
    const gone = randomUUID();
    await store.pool.query(
      "insert into votes (session_id, subject_id, object_id, weight) values ($1, $2, 'n2', 1)",
      [id, `user:${gone}`],
    );
    await owner("POST", `/vote-sessions/${id}/end`);

    const read = await owner("GET", `/vote-sessions/${id}`);
    const { summary, objects } = read.body.session.breakdown;
    expect(summary).toEqual([
      { name: "deleted", total: 1, objects: 1 },
      { name: null, total: 1, objects: 1 },
    ]);
    expect(objectRow({ objects }, "n2").voters).toEqual([{ name: null, votes: 1 }]);
    expect(JSON.stringify(read.body.session.breakdown)).not.toContain(gone);
  });
});
