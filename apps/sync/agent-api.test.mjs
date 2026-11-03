/**
 * Agent API against a real database: policy, ownership, task creation and the runner.
 *
 * The rules are unit-tested in agents.test.mjs; this file proves the wiring — cookies
 * for people, bearer tokens for agents, and a task that ends as shapes in the document.
 * Skips when no database is reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { handleIam } from "./iam-api.mjs";
import { handleAgents } from "./agent-api.mjs";
import { runAgentTask } from "./agent-runner.mjs";
import { testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

// A deterministic KEK for this test process; the real one comes from the environment.
process.env.REMO_KEK = Buffer.alloc(32, 9).toString("base64");

const database = await testDatabaseStore("agent API");
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
    if (await handleAgents({ request, response, url, store, log: { error() {} } })) return;
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
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

const email = (tag) => `agent-${tag}-${stamp}@example.com`;
const password = "correct horse battery";

const fakeAi = {
  chatJson: async () => ({
    json: {
      title: "Generated",
      nodes: [
        { id: "n1", label: "Start", kind: "ellipse" },
        { id: "n2", label: "Step", kind: "rectangle" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    usage: { promptTokens: 20, completionTokens: 10, costUsd: 0.0001 },
    model: "fake/diagram",
  }),
};

async function setup(tag) {
  const owner = client();
  const registered = await owner("POST", "/auth/register", {
    email: email(tag),
    password,
    name: tag,
  });
  const orgId = registered.body.org.id;
  const board = await owner("POST", `/orgs/${orgId}/boards`, { title: `${tag} board` });
  const boardId = board.body.board.id;
  const agent = await owner("POST", `/orgs/${orgId}/agents`, { name: "Scout" }).then(async (res) => {
    if (res.status === 201) return res.body.agent;
    // Agents are off until the organisation allows them.
    await owner("PUT", `/orgs/${orgId}/agent-policy`, { agentsEnabled: true });
    return (await owner("POST", `/orgs/${orgId}/agents`, { name: "Scout" })).body.agent;
  });
  return { owner, orgId, boardId, agent, userId: registered.body.user.id };
}

suite("agent API", () => {
  it("is off by default and only an org admin can turn it on", async () => {
    const owner = client();
    const registered = await owner("POST", "/auth/register", {
      email: email("policy-owner"),
      password,
      name: "Policy",
    });
    const orgId = registered.body.org.id;
    expect((await owner("GET", `/orgs/${orgId}/agent-policy`)).body.agentsEnabled).toBe(false);

    const member = client();
    const memberReg = await member("POST", "/auth/register", {
      email: email("policy-member"),
      password,
      name: "Member",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: memberReg.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });

    expect(
      (await member("PUT", `/orgs/${orgId}/agent-policy`, { agentsEnabled: true })).status,
    ).toBe(403);
    expect(
      (await owner("PUT", `/orgs/${orgId}/agent-policy`, { agentsEnabled: true })).body,
    ).toEqual({ agentsEnabled: true });

    // With the switch on, a member can create an agent for themselves.
    const created = await member("POST", `/orgs/${orgId}/agents`, { name: "Mine" });
    expect(created.status).toBe(201);
    expect(created.body.agent.owner_id).toBe(memberReg.body.user.id);
  });

  it("issues a token that identifies exactly one agent", async () => {
    const { owner, agent } = await setup("token");
    const created = await owner("POST", `/agents/${agent.id}/tokens`, {
      label: "CI",
      expiresInDays: 7,
    });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^remo_agent_/);

    const anonymous = client();
    const me = await anonymous("GET", "/agent/me", undefined, {
      Authorization: `Bearer ${created.body.secret}`,
    });
    expect(me.status).toBe(200);
    expect(me.body.agent).toMatchObject({ id: agent.id, name: "Scout" });
    expect(me.body.agent.owner.email).toBe(email("token"));

    expect((await anonymous("GET", "/agent/me")).status).toBe(401);
    await owner("DELETE", `/agents/${agent.id}/tokens/${created.body.token.id}`);
    expect(
      (
        await anonymous("GET", "/agent/me", undefined, {
          Authorization: `Bearer ${created.body.secret}`,
        })
      ).status,
    ).toBe(401);
  });

  it("does not replay another agent's change set through a shared key", async () => {
    const { owner, orgId, boardId, agent } = await setup("idem-agent");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const other = await owner("POST", `/orgs/${orgId}/agents`, { name: "Other" });
    expect(other.status).toBe(201);

    const ydoc = await store.roomDocument(boardId);
    const noteId = "shared-note";
    ydoc.getMap("widgets").set(noteId, {
      id: noteId,
      type: "sticky_note",
      parentId: null,
      x: 0,
      y: 0,
      width: 160,
      height: 180,
    });
    const text = new Y.Text();
    text.insert(0, "shared note");
    ydoc.getMap("texts").set(noteId, text);
    const operations = [
      {
        op: "create_cards",
        selectionIds: [noteId],
        target: { kind: "standalone" },
        mode: "copy",
      },
    ];

    const first = await owner(
      "POST",
      `/boards/${boardId}/agent-change-sets`,
      { agentId: agent.id, intent: "Одна и та же задача", operations, preview: true, budget: { maxActions: 10 } },
      { "Idempotency-Key": "shared-key" },
    );
    expect(first.status).toBe(201);

    const token = await owner("POST", `/agents/${other.body.agent.id}/tokens`, {
      label: "other",
      expiresInDays: 7,
    });
    const anonymous = client();
    const replay = await anonymous(
      "POST",
      "/agent/change-sets",
      { boardId, intent: "Одна и та же задача", operations, preview: true, budget: { maxActions: 10 } },
      {
        Authorization: `Bearer ${token.body.secret}`,
        "Idempotency-Key": "shared-key",
      },
    );
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("IDEMPOTENCY_KEY_IN_USE");
  });

  it("queues a diagram task, runs it, and stamps the objects", async () => {
    const { owner, orgId, boardId, agent } = await setup("run");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });

    const created = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "Нарисуй процесс проверки заказа",
      origin: { x: 100, y: 100 },
      budget: { maxActions: 10 },
    });
    expect(created.status).toBe(202);
    const taskId = created.body.task.id;
    expect(created.body.task).toMatchObject({
      status: "queued",
      skill_slug: "diagram",
      mode: "write",
    });
    expect(created.body.task.capabilities.sort()).toEqual(["board.edit", "board.read"]);

    const result = await runAgentTask({
      store,
      taskId,
      ai: fakeAi,
      log: { error() {} },
    });
    expect(result.status).toBe("applied");

    const ydoc = await store.roomDocument(boardId);
    const widgets = [...ydoc.getMap("widgets").values()];
    const shapes = widgets.filter((widget) => widget.type === "shape");
    expect(shapes).toHaveLength(2);
    expect(shapes[0].agent).toMatchObject({ id: agent.id, taskId, skill: "diagram" });
    expect(widgets.filter((widget) => widget.type === "connector")).toHaveLength(1);

    const finished = await owner("GET", `/agent-tasks/${taskId}`);
    expect(finished.body.task.status).toBe("applied");
    expect(finished.body.task.usage.actions).toBe(3);

    const audit = await owner("GET", `/orgs/${orgId}/audit`);
    const write = audit.body.events.find((event) => event.action === "agent.write");
    expect(write).toMatchObject({ agent_name: "Scout", skill: "diagram@1" });
  });

  it("replays a task with the same idempotency key", async () => {
    const { owner, boardId, agent } = await setup("idem");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const body = { agentId: agent.id, intent: "Одна и та же задача", budget: { maxActions: 5 } };
    const first = await owner("POST", `/boards/${boardId}/agent-tasks`, body, {
      "Idempotency-Key": "idem-1",
    });
    expect(first.status).toBe(202);
    const second = await owner("POST", `/boards/${boardId}/agent-tasks`, body, {
      "Idempotency-Key": "idem-1",
    });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.task.id).toBe(first.body.task.id);

    // A retry that lost the budget still returns the task that exists instead of a
    // BUDGET_REQUIRED: the key is the identity of the request (AG-11).
    const retry = await owner(
      "POST",
      `/boards/${boardId}/agent-tasks`,
      { agentId: agent.id, intent: "Одна и та же задача" },
      { "Idempotency-Key": "idem-1" },
    );
    expect(retry.status).toBe(200);
    expect(retry.body.task.id).toBe(first.body.task.id);
  });

  it("scopes an idempotency key to the board, not the organisation", async () => {
    const { owner, orgId, boardId, agent } = await setup("idem-scope");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const other = await owner("POST", `/orgs/${orgId}/boards`, { title: "other board" });
    const otherId = other.body.board.id;
    await owner("PUT", `/boards/${otherId}/agents`, { enabled: true });

    const body = { agentId: agent.id, intent: "Одна и та же задача", budget: { maxActions: 5 } };
    const first = await owner("POST", `/boards/${boardId}/agent-tasks`, body, {
      "Idempotency-Key": "same-key",
    });
    const second = await owner("POST", `/boards/${otherId}/agent-tasks`, body, {
      "Idempotency-Key": "same-key",
    });
    // The same key on another board is a different request, not a replay of the first.
    expect(second.status).toBe(202);
    expect(second.body.replayed).toBeFalsy();
    expect(second.body.task.id).not.toBe(first.body.task.id);
  });

  it("refuses a task from somebody else's agent or a disabled board", async () => {
    const { owner, orgId, boardId, agent } = await setup("deny");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });

    const member = client();
    const memberReg = await member("POST", "/auth/register", {
      email: email("deny-member"),
      password,
      name: "Deny",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: memberReg.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: memberReg.body.user.id,
      role: "editor",
    });

    const foreign = await member("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "нарисуй схему",
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.message).toMatch(/your own agent/);

    await owner("PUT", `/boards/${boardId}/agents`, { enabled: false });
    const disabled = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "нарисуй схему",
    });
    expect(disabled.status).toBe(403);
    expect(disabled.body.message).toBe("AGENTS_DISABLED_BOARD");
  });

  it("does not create a task or a schedule without a budget", async () => {
    const { owner, boardId, agent } = await setup("budget");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });

    const task = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "Нарисуй схему",
    });
    expect(task.status).toBe(422);
    expect(task.body).toMatchObject({ error: "BUDGET_REQUIRED" });

    const schedule = await owner("POST", `/boards/${boardId}/agent-schedules`, {
      agentId: agent.id,
      intent: "Обнови схему",
      intervalSeconds: 3600,
    });
    expect(schedule.status).toBe(422);
    expect(schedule.body).toMatchObject({ error: "BUDGET_REQUIRED" });

    // Nothing was queued behind the refusal.
    const listed = await owner("GET", `/boards/${boardId}/agent-tasks`);
    expect(listed.body.tasks).toHaveLength(0);
  });

  it("validates a schedule and exposes it on the board", async () => {
    const { owner, boardId, agent } = await setup("schedule");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });

    const bad = await owner("POST", `/boards/${boardId}/agent-schedules`, {
      agentId: agent.id,
      intent: "Обнови схему",
      intervalSeconds: 30,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe("BAD_INTERVAL");

    const good = await owner("POST", `/boards/${boardId}/agent-schedules`, {
      agentId: agent.id,
      intent: "Обнови схему",
      intervalSeconds: 3600,
      budget: { maxActions: 10 },
    });
    expect(good.status).toBe(201);
    const list = await owner("GET", `/boards/${boardId}/agent-schedules`);
    expect(list.body.schedules.map((schedule) => schedule.id)).toContain(good.body.schedule.id);
    expect((await owner("DELETE", `/agent-schedules/${good.body.schedule.id}`)).status).toBe(200);
  });

  it("closes a task and a change set when their author loses the board", async () => {
    const { owner, orgId, boardId } = await setup("lost");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const author = client();
    const registered = await author("POST", "/auth/register", {
      email: email("lost-author"),
      password,
      name: "Author",
    });
    const authorId = registered.body.user.id;
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, { email: email("lost-author") });
    await author("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await owner("POST", `/boards/${boardId}/grants`, {
      subjectType: "user",
      subjectId: authorId,
      role: "editor",
    });
    const agent = (await author("POST", `/orgs/${orgId}/agents`, { name: "Mine" })).body.agent;
    const created = await author("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "секретный план",
      budget: { maxActions: 5 },
    });
    const taskId = created.body.task.id;
    const changeSet = await store.createChangeSet({
      boardId,
      orgId,
      agentId: agent.id,
      createdBy: authorId,
      intent: "секретный план",
      operations: [],
      estimate: {},
      budget: { maxActions: 5 },
      origin: {},
      idempotencyKey: null,
    });
    const changeSetId = (changeSet.changeSet ?? changeSet).id;

    expect((await author("GET", `/agent-tasks/${taskId}`)).body.task.intent).toBe("секретный план");

    await owner("DELETE", `/boards/${boardId}/grants/user/${authorId}`);

    expect((await author("GET", `/agent-tasks/${taskId}`)).status).toBe(404);
    expect((await author("POST", `/agent-tasks/${taskId}/cancel`)).status).toBe(404);
    expect((await author("GET", `/change-sets/${changeSetId}`)).status).toBe(404);
    expect((await author("POST", `/change-sets/${changeSetId}/cancel`)).status).toBe(404);
  });

  it("shows an organisation admin without a board role only that a task exists", async () => {
    const { owner, orgId, boardId, agent, userId } = await setup("operator");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const created = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "секретный план",
      budget: { maxActions: 5 },
    });
    const taskId = created.body.task.id;
    const admin = client();
    const registered = await admin("POST", "/auth/register", {
      email: email("operator-admin"),
      password,
      name: "Admin",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, { email: email("operator-admin") });
    await admin("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    await store.setOrgAdmin({ orgId, userId: registered.body.user.id, role: "org_admin", grantedBy: userId });

    const seen = await admin("GET", `/agent-tasks/${taskId}`);
    expect(seen.status).toBe(200);
    expect(seen.body.task.status).toBe("queued");
    expect(JSON.stringify(seen.body)).not.toContain("секретный план");
    expect((await admin("POST", `/agent-tasks/${taskId}/cancel`)).status).toBe(200);
  });

  it("cancels a queued task without touching the board", async () => {
    const { owner, boardId, agent } = await setup("cancel");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const created = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "нарисуй схему",
      budget: { maxActions: 5 },
    });
    const taskId = created.body.task.id;
    expect((await owner("POST", `/agent-tasks/${taskId}/cancel`)).status).toBe(200);
    const result = await runAgentTask({ store, taskId, ai: fakeAi, log: { error() {} } });
    expect(result.status).toBe("skipped");
    expect((await owner("GET", `/agent-tasks/${taskId}`)).body.task.status).toBe("cancelled");
  });
});


suite("AI credentials and journal", () => {
  it("stores a provider key write-only and revokes it", async () => {
    const owner = client();
    await owner("POST", "/auth/register", {
      email: email("key-owner"),
      password,
      name: "Key Owner",
    });

    const created = await owner("POST", "/users/me/ai/credentials", {
      provider: "openrouter",
      secret: "sk-or-very-secret-value",
      model: "openai/gpt-4o-mini",
      label: "test",
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("very-secret");
    expect(created.body.credential.fingerprint).toHaveLength(16);

    const id = created.body.credential.id;
    const stored = await store.pool.query(
      `select encode(ciphertext, 'escape') as ciphertext, encode(dek_wrapped, 'escape') as wrapped
         from ai_credentials where id = $1`,
      [id],
    );
    expect(stored.rows[0].ciphertext).not.toContain("very-secret");
    expect(stored.rows[0].wrapped).not.toContain("very-secret");

    const list = await owner("GET", "/users/me/ai/credentials");
    expect(list.body.credentials).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("very-secret");

    expect((await owner("DELETE", `/users/me/ai/credentials/${id}`)).status).toBe(200);
    expect((await owner("GET", "/users/me/ai/credentials")).body.credentials).toHaveLength(0);
  });

  it("pins named providers and refuses a mapped loopback endpoint", async () => {
    const owner = client();
    await owner("POST", "/auth/register", {
      email: email("key-ssrf"),
      password,
      name: "Key SSRF",
    });

    const override = await owner("POST", "/users/me/ai/credentials", {
      provider: "openrouter",
      baseUrl: "https://example.com/v1",
      secret: "sk-or-very-secret-value",
      model: "openai/gpt-4o-mini",
    });
    expect(override.status).toBe(422);
    expect(override.body.error).toBe("BAD_BASE_URL");

    const mapped = await owner("POST", "/users/me/ai/credentials", {
      provider: "custom",
      baseUrl: "https://[::ffff:127.0.0.1]:9443/v1",
      secret: "sk-or-very-secret-value",
      model: "openai/gpt-4o-mini",
    });
    expect(mapped.status).toBe(422);
    expect(mapped.body.error).toBe("BAD_BASE_URL");
  });

  it("keeps a chain of model calls verifiable", async () => {
    const { owner, orgId, boardId, agent } = await setup("log");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const created = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "Нарисуй схему",
      budget: { maxActions: 5 },
    });
    const result = await runAgentTask({
      store,
      taskId: created.body.task.id,
      ai: fakeAi,
      log: { error() {} },
    });
    expect(result.status).toBe("applied");

    const runs = await owner("GET", `/orgs/${orgId}/ai/runs`);
    expect(runs.status).toBe(200);
    expect(runs.body.runs.length).toBeGreaterThan(0);
    const verify = await owner("GET", `/orgs/${orgId}/ai/runs/verify`);
    expect(verify.body).toMatchObject({ ok: true, brokenAt: null });
    expect(verify.body.checked).toBe(runs.body.runs.length);
    expect(JSON.stringify(runs.body)).not.toContain("sk-");
  });

  it("converts a selection into cards through the API and the runner", async () => {
    const { owner, boardId, agent } = await setup("cards-api");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });

    const ydoc = await store.roomDocument(boardId);
    for (const id of ["note-a", "note-b"]) {
      ydoc.getMap("widgets").set(id, {
        id,
        type: "sticky_note",
        parentId: null,
        x: 0,
        y: 0,
        width: 160,
        height: 180,
      });
      const text = new Y.Text();
      text.insert(0, `${id} title\n${id} body`);
      ydoc.getMap("texts").set(id, text);
    }

    const created = await owner("POST", `/boards/${boardId}/agent-tasks`, {
      agentId: agent.id,
      intent: "Сделай карточки",
      skillSlug: "cards",
      selectionIds: ["note-a", "note-b"],
      target: { kind: "standalone" },
      mode: "copy",
      budget: { maxActions: 10 },
    });
    expect(created.status).toBe(202);
    expect(created.body.task.skill_slug).toBe("cards");

    const result = await runAgentTask({
      store,
      taskId: created.body.task.id,
      ai: fakeAi,
      log: { error() {} },
    });
    expect(result.status).toBe("applied");
    expect(result.result.count).toBe(2);
    const cards = [...ydoc.getMap("widgets").values()].filter(
      (widget) => widget.type === "card",
    );
    expect(cards).toHaveLength(2);
    expect(ydoc.getMap("widgets").has("note-a")).toBe(true);
    expect(cards[0].agent).toMatchObject({ id: agent.id, skill: "cards" });
  });

  it("previews and executes a change set as one job", async () => {
    const { owner, boardId, agent } = await setup("change-set");
    await owner("PUT", `/boards/${boardId}/agents`, { enabled: true });
    const ydoc = await store.roomDocument(boardId);
    for (const id of ["cs-note-a", "cs-note-b", "cs-note-c"]) {
      ydoc.getMap("widgets").set(id, {
        id,
        type: "sticky_note",
        parentId: null,
        x: 0,
        y: 0,
        width: 160,
        height: 180,
      });
      const text = new Y.Text();
      text.insert(0, `${id} title\nbody`);
      ydoc.getMap("texts").set(id, text);
    }
    const operations = [
      {
        op: "create_cards",
        selectionIds: ["cs-note-a", "cs-note-b", "cs-note-c"],
        target: { kind: "standalone" },
        mode: "copy",
      },
    ];

    const preview = await owner("POST", `/boards/${boardId}/agent-change-sets`, {
      agentId: agent.id,
      intent: "Карточки пакетом",
      operations,
      preview: true,
      budget: { maxActions: 10 },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.changeSet.status).toBe("draft");
    expect(preview.body.changeSet.estimate.cards).toBe(3);
    expect(preview.body.task).toBeNull();

    const executed = await owner(
      "POST",
      `/change-sets/${preview.body.changeSet.id}/execute`,
    );
    expect(executed.status).toBe(202);
    expect(executed.body.task.skill_slug).toBe("change-set");

    const result = await runAgentTask({
      store,
      taskId: executed.body.task.id,
      ai: fakeAi,
      log: { error() {} },
    });
    expect(result.status).toBe("applied");

    const changeSet = await owner("GET", `/change-sets/${preview.body.changeSet.id}`);
    expect(changeSet.body.changeSet.status).toBe("applied");
    expect(changeSet.body.changeSet.result.count).toBe(3);
    const cards = [...ydoc.getMap("widgets").values()].filter((w) => w.type === "card");
    expect(cards).toHaveLength(3);
  });

  it("does not expose the journal to an ordinary member", async () => {
    const { owner, orgId } = await setup("journal-member");
    const member = client();
    const memberReg = await member("POST", "/auth/register", {
      email: email("journal-person"),
      password,
      name: "Person",
    });
    const invite = await owner("POST", `/orgs/${orgId}/invitations`, {
      email: memberReg.body.user.email,
    });
    await member("POST", "/invitations/accept", {
      token: new URL(invite.body.url).searchParams.get("invite"),
    });
    expect((await member("GET", `/orgs/${orgId}/ai/runs`)).status).toBe(403);
    expect((await member("GET", `/orgs/${orgId}/ai/runs/verify`)).status).toBe(403);
  });
});
