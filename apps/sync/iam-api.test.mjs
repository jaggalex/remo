/**
 * IAM API against a real database (spec/IAM-v1.md §8, §11).
 *
 * The rules are unit-tested in iam.test.mjs; this file proves the wiring: cookies,
 * status codes, tenant isolation, claim and the share/grant path, all through HTTP.
 * Skips when no database is reachable, like the store tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { handleIam } from "./iam-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";
import { discoverableBoards } from "./discovery.mjs";

const database = await testDatabaseStore("IAM API");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();

beforeAll(async () => {
  if (!reachable) return;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (await handleIam({ request, response, url, store })) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled in this test" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) await store.close();
});

/** A cookie jar per "browser", so sessions do not leak between cases. */
function client() {
  let cookie = "";
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

const email = (tag) => `iam-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

suite("IAM API", () => {
  it("registers, opens a session and gives the account an organisation", async () => {
    const api = client();
    const res = await api("POST", "/auth/register", {
      email: email("owner"),
      password,
      name: "Owner",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email("owner"));
    expect(res.body.org).toBeTruthy();
    expect(res.body.team.name).toBe("General");

    const me = await api("GET", "/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe("Owner");
    expect(me.body.orgs).toHaveLength(1);
  });

  it("keeps theme and language on the account, not the browser", async () => {
    const api = client();
    const registered = await api("POST", "/auth/register", {
      email: email("prefs"),
      password,
      name: "Prefs",
    });
    expect(registered.body.user.preferences).toEqual({ theme: null, lang: null });

    const saved = await api("PATCH", "/auth/preferences", { theme: "dark", lang: "ru" });
    expect(saved.status).toBe(200);
    expect(saved.body.preferences).toEqual({ theme: "dark", lang: "ru" });
    expect((await api("GET", "/auth/me")).body.user.preferences).toEqual({
      theme: "dark",
      lang: "ru",
    });

    // A second browser is the same account, so it reads the same values on login.
    const second = client();
    const login = await second("POST", "/auth/login", {
      email: email("prefs"),
      password,
    });
    expect(login.body.user.preferences).toEqual({ theme: "dark", lang: "ru" });

    const bad = await api("PATCH", "/auth/preferences", { theme: "neon", lang: "ru" });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe("BAD_THEME");
  });

  it("lists sessions and revokes one without touching the other", async () => {
    const first = client();
    const registered = await first("POST", "/auth/register", {
      email: email("sessions"),
      password,
      name: "Sessions",
    });
    expect(registered.status).toBe(201);

    const second = client();
    expect(
      (
        await second("POST", "/auth/login", {
          email: email("sessions"),
          password,
        })
      ).status,
    ).toBe(200);

    const list = await first("GET", "/auth/sessions");
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((row) => row.current)).toHaveLength(1);

    const other = list.body.sessions.find((row) => !row.current);
    const revoked = await first("DELETE", `/auth/sessions/${other.id}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.current).toBe(false);
    expect((await second("GET", "/auth/me")).status).toBe(401);
    expect((await first("GET", "/auth/me")).status).toBe(200);
    expect((await first("GET", "/auth/sessions")).body.sessions).toHaveLength(1);

    const current = list.body.sessions.find((row) => row.current);
    const selfRevoked = await first("DELETE", `/auth/sessions/${current.id}`);
    expect(selfRevoked.status).toBe(200);
    expect(selfRevoked.body.current).toBe(true);
    expect((await first("GET", "/auth/me")).status).toBe(401);
  });

  it("records which session performed an audited action", async () => {
    const api = client();
    const registered = await api("POST", "/auth/register", {
      email: email("audit-session"),
      password,
      name: "Audit session",
    });
    const list = await api("GET", "/auth/sessions");
    const current = list.body.sessions.find((row) => row.current);

    expect((await api("DELETE", `/auth/sessions/${current.id}`)).status).toBe(200);
    // An account-level event has no organisation, so it is not in the per-org journal;
    // the row itself still carries the session that performed it.
    const { rows } = await store.pool.query(
      `select session_id from audit_events
        where action = 'auth.session_revoked' and actor_id = $1
        order by at desc limit 1`,
      [registered.body.user.id],
    );
    expect(rows[0]?.session_id).toBe(current.id);
  });

  it("refuses a duplicate email and a wrong password", async () => {
    const api = client();
    await api("POST", "/auth/register", { email: email("dup"), password, name: "Dup" });

    const duplicate = await client()("POST", "/auth/register", {
      email: email("dup"),
      password,
      name: "Dup",
    });
    expect(duplicate.status).toBe(409);

    const wrong = await client()("POST", "/auth/login", {
      email: email("dup"),
      password: "not the password",
    });
    expect(wrong.status).toBe(401);

    const right = await client()("POST", "/auth/login", { email: email("dup"), password });
    expect(right.status).toBe(200);
  });

  it("rejects a short password", async () => {
    const res = await client()("POST", "/auth/register", {
      email: email("weak"),
      password: "short",
      name: "Weak",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("WEAK_PASSWORD");
  });

  it("creates a board owned by its creator and lists it for them", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("board"),
      password,
      name: "Board Owner",
    });
    const orgId = registered.body.org.id;

    const created = await owner("POST", `/orgs/${orgId}/boards`, { title: "IAM board" });
    expect(created.status).toBe(201);
    expect(created.body.board.owner_id).toBe(registered.body.user.id);

    const list = await owner("GET", `/orgs/${orgId}/boards`);
    expect(list.body.boards.map((board) => board.id)).toContain(created.body.board.id);

    const access = await owner("GET", `/boards/${created.body.board.id}/access`);
    expect(access.body.access).toMatchObject({ allowed: true, role: "owner" });
  });

  it("lets a member create a board and refuses a guest", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("create-owner"),
      password,
      name: "Create Owner",
    });
    const orgId = registered.body.org.id;

    const me = await owner("GET", "/auth/me");
    expect(me.body.orgs[0].capabilities).toContain("board.create");

    const host = await owner("POST", `/orgs/${orgId}/boards`, { title: "Guest host" });
    const guestEmail = email("create-guest");
    const invite = await owner("POST", `/boards/${host.body.board.id}/invitations`, {
      email: guestEmail,
      role: "viewer",
    });
    expect(invite.status).toBe(201);

    const guest = client();
    await guest("POST", "/auth/register", {
      email: guestEmail,
      password,
      name: "Create Guest",
    });
    await guest("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    const guestMe = await guest("GET", "/auth/me");
    const guestOrg = guestMe.body.orgs.find((org) => org.id === orgId);
    expect(guestOrg.capabilities).toEqual([]);

    const denied = await guest("POST", `/orgs/${orgId}/boards`, { title: "No" });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("BOARD_CREATE_FORBIDDEN");
  });

  it("lists the people a card can be assigned to", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("people-owner"),
      password,
      name: "People Owner",
    });
    const board = await owner("POST", `/orgs/${registered.body.org.id}/boards`, {
      title: "People board",
    });

    const list = await owner("GET", `/boards/${board.body.board.id}/people`);
    expect(list.status).toBe(200);
    expect(list.body.people).toEqual([
      { id: registered.body.user.id, name: "People Owner" },
    ]);

    const second = client();
    const secondReg = await second("POST", "/auth/register", {
      email: email("people-second"),
      password,
      name: "Second Person",
    });
    const invite = await owner("POST", `/orgs/${registered.body.org.id}/invitations`, {
      email: secondReg.body.user.email,
    });
    await second("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${board.body.board.id}/grants`, {
      subjectType: "user",
      subjectId: secondReg.body.user.id,
      role: "editor",
    });

    const after = await owner("GET", `/boards/${board.body.board.id}/people`);
    expect(after.body.people.map((person) => person.name)).toEqual([
      "People Owner",
      "Second Person",
    ]);

    const anonymous = await client()("GET", `/boards/${board.body.board.id}/people`);
    expect(anonymous.status).toBe(401);
  });

  it("lets a commenter write, a viewer read, and reopens a resolved thread", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("comments-owner"),
      password,
      name: "Comments Owner",
    });
    const orgId = registered.body.org.id;
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Comments board" });
    const boardId = board.body.board.id;

    const commenter = client();
    const commenterReg = await commenter("POST", "/auth/register", {
      email: email("comments-commenter"),
      password,
      name: "Commenter",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: commenterReg.body.user.email,
    });
    await commenter("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: commenterReg.body.user.id,
      role: "commenter",
    });

    const created = await commenter("POST", `/boards/${boardId}/comments`, {
      anchor: { kind: "point", x: 10, y: 20 },
      body: "First thought",
    });
    expect(created.status).toBe(201);
    expect(created.body.thread.comments[0].authorName).toBe("Commenter");

    const viewer = client();
    const viewerReg = await viewer("POST", "/auth/register", {
      email: email("comments-viewer"),
      password,
      name: "Viewer",
    });
    const invite2 = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: viewerReg.body.user.email,
    });
    await viewer("POST", "/invitations/accept", {
      token: new URL(invite2.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: viewerReg.body.user.id,
      role: "viewer",
    });

    const list = await viewer("GET", `/boards/${boardId}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.threads).toHaveLength(1);

    const denied = await viewer("POST", `/boards/${boardId}/comments`, {
      anchor: { kind: "point", x: 0, y: 0 },
      body: "nope",
    });
    expect(denied.status).toBe(403);

    const threadId = created.body.thread.id;
    const resolved = await commenter("PATCH", `/boards/${boardId}/comments/${threadId}`, {
      resolved: true,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.thread.resolvedAt).toBeTruthy();

    const reply = await commenter("POST", `/boards/${boardId}/comments/${threadId}/replies`, {
      body: "Reopened",
    });
    expect(reply.status).toBe(201);
    const after = await viewer("GET", `/boards/${boardId}/comments`);
    expect(after.body.threads[0].resolvedAt).toBeNull();
    expect(after.body.threads[0].comments).toHaveLength(2);

    // Restore belongs to the backup grant: a viewer cannot replace the discussion.
    const viewerRestore = await viewer("POST", `/boards/${boardId}/comments/restore`, {
      threads: [],
    });
    expect(viewerRestore.status).toBe(403);

    const restored = await owner("POST", `/boards/${boardId}/comments/restore`, {
      threads: [
        {
          anchor: { kind: "point", x: 5, y: 6 },
          resolvedAt: null,
          createdByName: "Restored Author",
          createdAt: "2026-10-01T10:00:00.000Z",
          comments: [
            {
              authorName: "Restored Author",
              body: "From the backup",
              createdAt: "2026-10-01T10:00:00.000Z",
            },
            {
              authorName: "Restored Author",
              body: "And a reply",
              createdAt: "2026-10-01T10:05:00.000Z",
            },
          ],
        },
      ],
    });
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(1);

    const afterRestore = await owner("GET", `/boards/${boardId}/comments`);
    expect(afterRestore.body.threads).toHaveLength(1);
    expect(afterRestore.body.threads[0].comments).toHaveLength(2);
    expect(afterRestore.body.threads[0].comments[1].body).toBe("And a reply");
    expect(afterRestore.body.threads[0].createdByName).toBe("Restored Author");

    const cleared = await owner("POST", `/boards/${boardId}/comments/restore`, { threads: [] });
    expect(cleared.status).toBe(200);
    const afterClear = await owner("GET", `/boards/${boardId}/comments`);
    expect(afterClear.body.threads).toHaveLength(0);

    const anonymous = await client()("GET", `/boards/${boardId}/comments`);
    expect(anonymous.status).toBe(401);
  });

  it("hides a private board from a stranger and from a signed-out visitor", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("private"),
      password,
      name: "Private",
    });
    const board = await owner("POST", `/orgs/${registered.body.org.id}/boards`, {
      title: "Private board",
    });
    const id = board.body.board.id;

    const anonymous = await client()("GET", `/boards/${id}`);
    expect(anonymous.status).toBe(401);

    const stranger = client();
    await stranger("POST", "/auth/register", {
      email: email("stranger"),
      password,
      name: "Stranger",
    });
    const denied = await stranger("GET", `/boards/${id}`);
    // 404, not 403: a stranger must not learn that the board exists.
    expect(denied.status).toBe(404);

    // The access endpoint is the other way to ask: it must not leak metadata either.
    const access = await stranger("GET", `/boards/${id}/access`);
    expect(access.status).toBe(404);
    expect(access.body).toEqual({ error: "RESOURCE_NOT_AVAILABLE", message: "not found" });
    expect(JSON.stringify(access.body)).not.toContain("Private board");
    expect(JSON.stringify(access.body)).not.toContain(registered.body.org.id);
    expect(JSON.stringify(access.body)).not.toContain("visibility");
  });

  it("shares with a user, and the grant survives a re-read", async () => {
    const owner = client();
    const ownerReg = await owner("POST", "/auth/register", {
      email: email("share-owner"),
      password,
      name: "Share Owner",
    });
    const board = await owner("POST", `/orgs/${ownerReg.body.org.id}/boards`, {
      title: "Shared board",
    });
    const boardId = board.body.board.id;

    const guest = client();
    const guestReg = await guest("POST", "/auth/register", {
      email: email("share-guest"),
      password,
      name: "Share Guest",
    });
    // A grant applies to somebody who has a seat in the board's organisation; the
    // invitation is how that seat appears (a stranger from another workspace cannot be
    // granted in, which is the point of the org gate).
    const invite = await owner("POST", `/orgs/${ownerReg.body.org.id}/invitations`, {
      email: guestReg.body.user.email,
    });
    await guest("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    const before = await guest("GET", `/boards/${boardId}`);
    expect(before.status).toBe(404);

    const granted = await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: guestReg.body.user.id,
      role: "viewer",
    });
    expect(granted.status).toBe(200);

    const after = await guest("GET", `/boards/${boardId}/access`);
    expect(after.body.access).toMatchObject({ allowed: true, role: "viewer" });
    expect(after.body.access.sources).toContain("grant:user");

    // The sharing dialog shows people, so the grant carries their name and address.
    const listed = await owner("GET", `/boards/${boardId}/grants`);
    expect(listed.body.grants[0]).toMatchObject({
      subject_name: "Share Guest",
      subject_email: email("share-guest"),
    });

    // A viewer cannot share: the capability check is on the route, not in the UI.
    const cannotShare = await guest("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: guestReg.body.user.id,
      role: "editor",
    });
    expect(cannotShare.status).toBe(403);

    const revoked = await owner("DELETE", `/boards/${boardId}/grants/user/${guestReg.body.user.id}`);
    expect(revoked.status).toBe(200);
    const gone = await guest("GET", `/boards/${boardId}/access`);
    // Revoked means the board is no longer visible at all, metadata included.
    expect(gone.status).toBe(404);
    expect(gone.body.board).toBeUndefined();
  });

  it("claims an unclaimed room once, and only while signed in", async () => {
    const room = `claim-${stamp}`;
    await store.createIamBoard({ id: room, orgId: null, teamId: null, ownerId: null, title: "Old room" });

    const anonymous = await client()("POST", `/boards/${room}/claim`, {});
    expect(anonymous.status).toBe(401);

    const first = client();
    await first("POST", "/auth/register", { email: email("claim-1"), password, name: "First" });
    const claimed = await first("POST", `/boards/${room}/claim`, {});
    expect(claimed.status).toBe(200);
    expect(claimed.body.board.owner_id).toBeTruthy();

    const second = client();
    await second("POST", "/auth/register", { email: email("claim-2"), password, name: "Second" });
    const again = await second("POST", `/boards/${room}/claim`, {});
    expect(again.status).toBe(409);
  });

  it("lets an unclaimed room stay readable without an account", async () => {
    const room = `legacy-${stamp}`;
    await store.createIamBoard({ id: room, orgId: null, teamId: null, ownerId: null, title: "Legacy" });
    const res = await client()("GET", `/boards/${room}/access`);
    expect(res.status).toBe(200);
    expect(res.body.access).toMatchObject({ allowed: true, reason: "UNCLAIMED" });
  });

  it("treats a malformed session cookie as anonymous instead of crashing", async () => {
    const broken = await fetch(`${base}/auth/me`, {
      headers: { Cookie: "remo_session=%E0%A4%A" },
    });
    expect(broken.status).toBe(401);

    // The service is still answering: one bad cookie did not take it down.
    const next = await fetch(`${base}/auth/me`);
    expect(next.status).toBe(401);
  });

  it("refuses an editor who promotes anyone, including themselves, to co-owner", async () => {
    const owner = client();
    const ownerReg = await owner("POST", "/auth/register", {
      email: email("coowner-owner"),
      password,
      name: "Owner",
    });
    const orgId = ownerReg.body.org.id;
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Managed" });
    const boardId = board.body.board.id;

    const editor = client();
    const editorReg = await editor("POST", "/auth/register", {
      email: email("coowner-editor"),
      password,
      name: "Editor",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: editorReg.body.user.email,
    });
    await editor("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: editorReg.body.user.id,
      role: "editor",
    });

    // Self-promotion is the reported hole: sharing must not become management.
    const self = await editor("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: editorReg.body.user.id,
      role: "coowner",
    });
    expect(self.status).toBe(403);

    const third = client();
    const thirdReg = await third("POST", "/auth/register", {
      email: email("coowner-third"),
      password,
      name: "Third",
    });
    const invite2 = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: thirdReg.body.user.email,
    });
    await third("POST", "/invitations/accept", {
      token: new URL(invite2.body.url).searchParams.get("invite"),
    });

    // Promoting somebody else to co-owner is equally a management decision.
    const promote = await editor("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: thirdReg.body.user.id,
      role: "coowner",
    });
    expect(promote.status).toBe(403);

    // The owner may; once the third person is a co-owner, an editor may not demote them.
    expect(
      (
        await owner("POST", `/boards/${boardId}/grants`, {
          subjectType: "user",
          subjectId: thirdReg.body.user.id,
          role: "coowner",
        })
      ).status,
    ).toBe(200);
    const demote = await editor("DELETE", `/boards/${boardId}/grants/user/${thirdReg.body.user.id}`);
    expect(demote.status).toBe(403);
    const grants = await owner("GET", `/boards/${boardId}/grants`);
    expect(
      grants.body.grants.find((grant) => grant.subject_id === thirdReg.body.user.id)?.role,
    ).toBe("coowner");
  });
});

suite("invitations and administration", () => {
  /** Owner of a fresh organisation plus the ids the tests need. */
  async function setup(tag) {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email(tag),
      password,
      name: tag,
    });
    return { owner, orgId: registered.body.org.id, userId: registered.body.user.id, email: email(tag) };
  }

  it("invites by email, and the invited account accepts into the organisation", async () => {
    const { owner, orgId } = await setup("inv-owner");
    const guestEmail = email("inv-guest");

    const created = await owner("POST", `/orgs/${orgId}/invitations`, { email: guestEmail });
    expect(created.status).toBe(201);
    expect(created.body.url).toContain("invite=");
    expect(JSON.stringify(created.body)).not.toContain("token=");

    const pending = await owner("GET", `/orgs/${orgId}/invitations`);
    expect(pending.body.invitations.map((invite) => invite.email)).toContain(guestEmail);

    const invited = client();
    await invited("POST", "/auth/register", { email: guestEmail, password, name: "Guest" });
    const token = new URL(created.body.url).searchParams.get("invite");
    const accepted = await invited("POST", "/invitations/accept", { token });
    expect(accepted.status).toBe(200);

    const me = await invited("GET", "/auth/me");
    expect(me.body.orgs.map((org) => org.id)).toContain(orgId);

    // The same token cannot be used twice.
    const again = await invited("POST", "/invitations/accept", { token });
    expect(again.status).toBe(410);
  });

  it("refuses an invitation opened by the wrong account without consuming it", async () => {
    const { owner, orgId } = await setup("inv-wrong");
    const targetEmail = email("inv-target");
    const created = await owner("POST", `/orgs/${orgId}/invitations`, { email: targetEmail });
    const token = new URL(created.body.url).searchParams.get("invite");

    const stranger = client();
    await stranger("POST", "/auth/register", { email: email("inv-stranger"), password, name: "S" });
    const refused = await stranger("POST", "/invitations/accept", { token });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("EMAIL_MISMATCH");

    // No membership leaked and the invitation is still pending for its recipient.
    expect((await stranger("GET", `/orgs/${orgId}/boards`)).status).toBe(404);
    const pending = await owner("GET", `/orgs/${orgId}/invitations`);
    expect(pending.body.invitations.map((invite) => invite.email)).toContain(targetEmail);

    // The intended account can still use the same token.
    const target = client();
    await target("POST", "/auth/register", { email: targetEmail, password, name: "Target" });
    expect((await target("POST", "/invitations/accept", { token })).status).toBe(200);
  });

  it("invites a guest to one board and gives them only that board", async () => {
    const { owner, orgId, userId } = await setup("guest-owner");
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Guest board" });
    const other = await owner("POST", `/orgs/${orgId}/boards`, { title: "Other board" });
    const boardId = board.body.board.id;

    const guestEmail = email("guest-person");
    const created = await owner("POST", `/boards/${boardId}/invitations`, {
      email: guestEmail,
      role: "viewer",
    });
    expect(created.status).toBe(201);

    const guest = client();
    await guest("POST", "/auth/register", { email: guestEmail, password, name: "Guest" });
    const token = new URL(created.body.url).searchParams.get("invite");
    expect((await guest("POST", "/invitations/accept", { token })).status).toBe(200);

    expect((await guest("GET", `/boards/${boardId}/access`)).body.access.allowed).toBe(true);
    // A guest does not see the rest of the organisation, and has no team access.
    expect((await guest("GET", `/boards/${other.body.board.id}`)).status).toBe(404);
    expect((await guest("GET", `/orgs/${orgId}/boards`)).status).toBe(404);
    expect(userId).toBeTruthy();
  });

  it("suspends a member: their session ends and their boards stop answering", async () => {
    const { owner, orgId } = await setup("susp-owner");
    const member = client();
    const memberReg = await member("POST", "/auth/register", {
      email: email("susp-member"),
      password,
      name: "Member",
    });
    const invitation = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: memberReg.body.user.email,
    });
    // The account exists but is not in the org yet: add through an invitation.
    expect(invitation.status).toBe(201);

    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Shared" });

    // The account is not a member yet, so a grant does nothing; accepting the invitation
    // gives it a seat, and only then does the grant apply.
    expect((await member("GET", `/boards/${board.body.board.id}`)).status).toBe(404);
    const token = new URL(invitation.body.url).searchParams.get("invite");
    await member("POST", "/invitations/accept", { token });
    await owner("POST", `/boards/${board.body.board.id}/grants`, {
      subjectType: "user",
      subjectId: memberReg.body.user.id,
      role: "editor",
    });
    expect((await member("GET", `/boards/${board.body.board.id}`)).status).toBe(200);

    const suspended = await owner("POST", `/orgs/${orgId}/members/${memberReg.body.user.id}/suspend`);
    expect(suspended.status).toBe(200);
    // The session is gone, so the next call is anonymous.
    expect((await member("GET", "/auth/me")).status).toBe(401);
    expect((await member("GET", `/boards/${board.body.board.id}`)).status).toBe(401);
  });

  it("refuses to remove a member who still owns boards", async () => {
    const { owner, orgId, userId } = await setup("own-owner");
    await owner("POST", `/orgs/${orgId}/boards`, { title: "Belongs to owner" });

    const refused = await owner("DELETE", `/orgs/${orgId}/members/${userId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("OWNER_TRANSFER_REQUIRED");
    expect(refused.body.boards).toHaveLength(1);
  });

  it("transfers ownership to another member and keeps the old owner as editor", async () => {
    const { owner, orgId, userId } = await setup("transfer-owner");
    const other = client();
    const otherReg = await other("POST", "/auth/register", {
      email: email("transfer-target"),
      password,
      name: "New owner",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: otherReg.body.user.email,
    });
    const token = new URL(invite.body.url).searchParams.get("invite");
    await other("POST", "/invitations/accept", { token });

    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Handover" });
    const boardId = board.body.board.id;
    const transferred = await owner("POST", `/boards/${boardId}/transfer`, {
      userId: otherReg.body.user.id,
    });
    expect(transferred.status).toBe(200);

    const ownerAccess = await owner("GET", `/boards/${boardId}/access`);
    expect(ownerAccess.body.access.role).toBe("editor");
    const newAccess = await other("GET", `/boards/${boardId}/access`);
    expect(newAccess.body.access.role).toBe("owner");
    expect(userId).toBeTruthy();
  });

  it("refuses to remove the last organisation admin", async () => {
    const { owner, orgId, userId } = await setup("last-admin");
    const refused = await owner("DELETE", `/orgs/${orgId}/admin-roles/${userId}/org_admin`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("LAST_ADMIN");
  });

  it("shows the audit to an administrator", async () => {
    const { owner, orgId } = await setup("audit-owner");
    const res = await owner("GET", `/orgs/${orgId}/audit`);
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
  });
});

suite("organisation screens", () => {
  async function setup(tag) {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email(tag),
      password,
      name: tag,
    });
    return { owner, orgId: registered.body.org.id, userId: registered.body.user.id };
  }

  async function addMember(owner, orgId, tag) {
    const person = client();
    const registered = await person("POST", "/auth/register", {
      email: email(tag),
      password,
      name: tag,
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: registered.body.user.email,
    });
    await person("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    return { person, id: registered.body.user.id, email: registered.body.user.email };
  }

  it("tells the caller their own organisation roles", async () => {
    const { owner, orgId } = await setup("roles-owner");
    const org = await owner("GET", `/orgs/${orgId}`);
    expect(org.status).toBe(200);
    expect(org.body.roles).toEqual(["org_admin"]);
  });

  it("lists members with their administrator roles", async () => {
    const { owner, orgId, userId } = await setup("members-owner");
    const member = await addMember(owner, orgId, "members-person");
    expect((await owner("PUT", `/orgs/${orgId}/admin-roles/${member.id}/user_admin`)).status).toBe(
      200,
    );

    const list = await member.person("GET", `/orgs/${orgId}/members`);
    expect(list.status).toBe(200);
    const ownerRow = list.body.members.find((row) => row.id === userId);
    expect(ownerRow.roles).toEqual(["org_admin"]);
    expect(ownerRow.relation).toBe("member");
    const personRow = list.body.members.find((row) => row.id === member.id);
    expect(personRow.roles).toEqual(["user_admin"]);
  });

  it("hides guests from an ordinary member but shows them to an administrator", async () => {
    const { owner, orgId } = await setup("guestlist-owner");
    const member = await addMember(owner, orgId, "guestlist-member");
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Guest list" });
    const guestEmail = email("guestlist-guest");
    const invite = await owner("POST", `/boards/${board.body.board.id}/invitations`, {
      email: guestEmail,
      role: "viewer",
    });
    const guest = client();
    await guest("POST", "/auth/register", { email: guestEmail, password, name: "Guest" });
    await guest("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    const asMember = await member.person("GET", `/orgs/${orgId}/members`);
    expect(asMember.body.members.every((row) => row.relation === "member")).toBe(true);
    expect(JSON.stringify(asMember.body)).not.toContain(guestEmail);

    const asAdmin = await owner("GET", `/orgs/${orgId}/members`);
    expect(asAdmin.body.members.some((row) => row.email === guestEmail)).toBe(true);
  });

  it("restores a suspended member without restoring their session", async () => {
    const { owner, orgId } = await setup("restore-owner");
    const person = await addMember(owner, orgId, "restore-person");

    expect((await owner("POST", `/orgs/${orgId}/members/${person.id}/suspend`)).status).toBe(200);
    expect((await person.person("GET", "/auth/me")).status).toBe(401);

    expect((await owner("POST", `/orgs/${orgId}/members/${person.id}/restore`)).status).toBe(200);
    // The seat is back, but the old cookie was revoked by the suspension.
    expect((await person.person("GET", "/auth/me")).status).toBe(401);
    const again = await person.person("POST", "/auth/login", {
      email: person.email,
      password,
    });
    expect(again.status).toBe(200);
    const list = await owner("GET", `/orgs/${orgId}/members`);
    expect(list.body.members.find((row) => row.id === person.id).state).toBe("active");
  });

  it("keeps a guest out of ownership", async () => {
    const { owner, orgId } = await setup("guestown-owner");
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Guest ownership" });
    const guestEmail = email("guestown-guest");
    const invite = await owner("POST", `/boards/${board.body.board.id}/invitations`, {
      email: guestEmail,
      role: "editor",
    });
    const guest = client();
    const registered = await guest("POST", "/auth/register", {
      email: guestEmail,
      password,
      name: "Guest owner",
    });
    await guest("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    const refused = await owner("POST", `/boards/${board.body.board.id}/transfer`, {
      userId: registered.body.user.id,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("TARGET_NOT_MEMBER");
  });

  it("shows the audit with actor and board names", async () => {
    const { owner, orgId, userId } = await setup("auditnames-owner");
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Named board" });
    expect(board.status).toBe(201);

    const events = await owner("GET", `/orgs/${orgId}/audit`);
    expect(events.status).toBe(200);
    const created = events.body.events.find((event) => event.action === "board.create");
    expect(created.actor_name).toBe("auditnames-owner");
    expect(created.board_title).toBe("Named board");
    expect(created.actor_id).toBe(userId);
  });
});

suite("organisation roles are independent", () => {
  it("lets a member read the directory but not change it, and a people-admin not hand out roles", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("independent-owner"),
      password,
      name: "Independent",
    });
    const orgId = registered.body.org.id;

    async function member(tag) {
      const person = client();
      const account = await person("POST", "/auth/register", {
        email: email(tag),
        password,
        name: tag,
      });
      const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
        email: account.body.user.email,
      });
      await person("POST", "/invitations/accept", {
        token: new URL(invite.body.url).searchParams.get("invite"),
      });
      return { person, id: account.body.user.id };
    }

    const plain = await member("independent-plain");
    expect((await plain.person("GET", `/orgs/${orgId}/members`)).status).toBe(200);
    expect(
      (
        await plain.person("POST", `/orgs/${orgId}/invitations`, {
          email: email("independent-nope"),
        })
      ).status,
    ).toBe(403);
    expect((await plain.person("GET", `/orgs/${orgId}/audit`)).status).toBe(403);

    const peopleAdmin = await member("independent-people");
    expect(
      (await owner("PUT", `/orgs/${orgId}/admin-roles/${peopleAdmin.id}/user_admin`)).status,
    ).toBe(200);
    expect(
      (
        await peopleAdmin.person("POST", `/orgs/${orgId}/invitations`, {
          email: email("independent-invitee"),
        })
      ).status,
    ).toBe(201);
    // `user_admin` manages people; handing out administrator roles stays with `org_admin`.
    expect(
      (
        await peopleAdmin.person(
          "PUT",
          `/orgs/${orgId}/admin-roles/${peopleAdmin.id}/security_admin`,
        )
      ).status,
    ).toBe(403);
    // …and so does the journal (IAM-38: org_admin or security_admin).
    expect((await peopleAdmin.person("GET", `/orgs/${orgId}/audit`)).status).toBe(403);
  });
});

suite("board discovery", () => {
  it("lists only boards the person may open, and follows the seat", async () => {
    const owner = client();
    const ownerReg = await owner("POST", "/auth/register", {
      email: email("discover-owner"),
      password,
      name: "Discover Owner",
    });
    const orgId = ownerReg.body.org.id;
    const board = await owner("POST", `/orgs/${orgId}/boards`, { title: "Discoverable" });
    const boardId = board.body.board.id;
    const other = await owner("POST", `/orgs/${orgId}/boards`, { title: "Not shared" });

    const member = client();
    const memberReg = await member("POST", "/auth/register", {
      email: email("discover-member"),
      password,
      name: "Discover Member",
    });
    const memberId = memberReg.body.user.id;
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: memberReg.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    // A seat alone is not access: the board has no grant, so it is not discoverable.
    let mine = await store.listReadableBoards(memberId);
    expect(mine.map((row) => row.id)).not.toContain(boardId);

    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: memberId,
      role: "viewer",
    });
    mine = await store.listReadableBoards(memberId);
    expect(mine.map((row) => row.id)).toContain(boardId);
    expect(mine.map((row) => row.id)).not.toContain(other.body.board.id);

    // Suspension is deny-overrides everywhere, including the directory.
    await owner("POST", `/orgs/${orgId}/members/${memberId}/suspend`);
    mine = await store.listReadableBoards(memberId);
    expect(mine).toHaveLength(0);
  });

  it("shows a legacy room to its visitor and hides a claimed board from everyone else", async () => {
    const owner = client();
    const ownerReg = await owner("POST", "/auth/register", {
      email: email("discover-legacy"),
      password,
      name: "Legacy",
    });
    const orgId = ownerReg.body.org.id;
    const claimed = await owner("POST", `/orgs/${orgId}/boards`, { title: "Claimed" });
    const claimedId = claimed.body.board.id;

    // No session, but the address names the claimed board: still not discoverable.
    expect(await discoverableBoards(store, { room: claimedId })).toEqual([]);
    // The owner reaches it through the ordinary rule.
    const owned = await store.listReadableBoards(ownerReg.body.user.id);
    expect(owned.map((row) => row.id)).toContain(claimedId);

    // A room with no owner is the legacy mode: visible only when named.
    const room = `test-legacy-${Date.now()}`;
    await store.pool.query("insert into boards (id, title) values ($1, $2)", [room, "Old room"]);
    try {
      expect(await discoverableBoards(store, {})).toEqual([]);
      const legacy = await discoverableBoards(store, { room });
      expect(legacy.map((row) => row.id)).toEqual([room]);
      expect(await store.listReadableBoards(ownerReg.body.user.id).then((rows) => rows.map((row) => row.id))).not.toContain(room);
    } finally {
      await store.pool.query("delete from boards where id = $1", [room]);
    }
  });
});
