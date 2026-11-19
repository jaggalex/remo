/**
 * Tidy against a real database and HTTP surface (ADR-143).
 *
 * The layout rules live in `packages/agent-plan/src/tidy.test.mjs`; this file proves
 * the wiring: a task created from a selection, a stored plan with placements, a
 * strategy switch that rewrites only geometry, and the same approve/applied/undo
 * lifecycle as any other agent plan. Skips without a test database (ADR-136).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { handleIam } from "./iam-api.mjs";
import { handleAgents } from "./agent-api.mjs";
import { runAgentTask } from "./agent-runner.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("tidy");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";

const suite = reachable ? describe : describe.skip;
const stamp = Date.now();
const password = "correct horse battery";

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

const email = (tag) => `tidy-${tag}-${stamp}@example.com`;

async function setup(tag) {
  const person = client();
  const registered = await person("POST", "/auth/register", {
    email: email(tag),
    password,
    name: tag,
  });
  expect(registered.status).toBe(201);
  const orgId = registered.body.org.id;
  const board = await person("POST", `/orgs/${orgId}/boards`, { title: `${tag} board` });
  const boardId = board.body.board.id;
  await person("PUT", `/orgs/${orgId}/agent-policy`, { agentsEnabled: true });
  const agent = await person("POST", `/orgs/${orgId}/agents`, { name: "Tidy" });
  await person("PUT", `/boards/${boardId}/agents`, { enabled: true });
  return { person, orgId, boardId, agent: agent.body.agent };
}

function note(id, x, y, text, extra = {}) {
  return {
    id,
    type: "sticky_note",
    parentId: null,
    x,
    y,
    width: 160,
    height: 180,
    content: text,
    ...extra,
  };
}

async function seed(boardId, widgets) {
  const ydoc = await store.roomDocument(boardId);
  for (const widget of widgets) ydoc.getMap("widgets").set(widget.id, widget);
  return ydoc;
}

async function createTidyTask(facts, selectionIds, extra = {}) {
  const response = await facts.person("POST", `/boards/${facts.boardId}/agent-tasks`, {
    agentId: facts.agent.id,
    intent: "Упорядочить выделение",
    skillSlug: "tidy-selection",
    selectionIds,
    budget: { maxTokens: 4_000, maxActions: 60, maxCostUsd: 1 },
    ...extra,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return response.body.task;
}

suite("tidy plans", () => {
  it("stores a deterministic plan without a model and applies its counts", async () => {
    const facts = await setup("plan");
    const widgets = [
      note("s5", 900, 700, "US-5: ship"),
      note("s2", 40, 500, "US-2: cart"),
      note("s10", 300, 100, "US-10: refund"),
      note("s1", 700, -200, "US-1: browse"),
      note("s3", -400, 300, "US-3: pay"),
    ];
    await seed(facts.boardId, widgets);
    const task = await createTidyTask(facts, widgets.map((widget) => widget.id));

    // No provider at all: tidy is still a real layout (ADR-143).
    const result = await runAgentTask({ store, taskId: task.id, ai: null, log: { error() {} } });
    expect(result.status, JSON.stringify(result)).toBe("awaiting_approval");

    const plan = await facts.person("GET", `/agent-tasks/${task.id}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.body.task.skillSlug).toBe("tidy-selection");
    expect(plan.body.plan.counts).toMatchObject({ objects: 1, placements: 5 });
    expect(plan.body.plan.placements).toHaveLength(5);
    expect(plan.body.plan.objects[0]).toMatchObject({ type: "frame", title: "US" });
    expect(plan.body.strategy).toBe("prefix");
    expect(plan.body.selection.ids).toHaveLength(5);
    expect(plan.body.selection.counts.chars).toBeGreaterThan(0);
    // The plan is stored, the board is untouched.
    const ydoc = await store.roomDocument(facts.boardId);
    expect(ydoc.getMap("widgets").get("s1").x).toBe(700);

    // Switch to a plain grid: only geometry changes, the classification is kept.
    const grid = await facts.person("POST", `/agent-tasks/${task.id}/plan/relayout`, {
      strategy: "grid",
    });
    expect(grid.status).toBe(200);
    expect(grid.body.strategy).toBe("grid");
    expect(grid.body.plan.counts).toMatchObject({ objects: 0, placements: 5 });

    const approved = await facts.person("POST", `/agent-tasks/${task.id}/plan/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.plan.counts.placements).toBe(5);

    const audit = await facts.person("GET", `/orgs/${facts.orgId}/audit`);
    const actions = audit.body.events.map((event) => event.action);
    expect(actions.filter((action) => action === "agent.plan.relayout")).toHaveLength(1);
    expect(actions.filter((action) => action === "agent.plan.approved")).toHaveLength(1);

    // An approved plan cannot be shuffled underneath the person who approved it.
    const late = await facts.person("POST", `/agent-tasks/${task.id}/plan/relayout`, {
      strategy: "prefix",
    });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("PLAN_ALREADY_APPROVED");
  });

  it("ignores a model that names an object outside the selection", async () => {
    const facts = await setup("foreign");
    const widgets = [
      note("a", 0, 0, "alpha"),
      note("b", 300, 0, "beta"),
      note("foreign", 600, 0, "do not touch"),
    ];
    await seed(facts.boardId, widgets);
    const task = await createTidyTask(facts, ["a", "b"]);

    const ai = {
      configured: true,
      chatJson: async () => ({
        json: {
          strategy: "meaning",
          blocks: [{ label: "Mine", ids: ["a", "foreign"] }],
        },
        usage: { promptTokens: 10, completionTokens: 10, costUsd: 0 },
        model: "fake/tidy",
      }),
    };
    const result = await runAgentTask({ store, taskId: task.id, ai, log: { error() {} } });
    expect(result.status, JSON.stringify(result)).toBe("awaiting_approval");

    const plan = await facts.person("GET", `/agent-tasks/${task.id}/plan`);
    expect(plan.body.plan.placements.map((item) => item.id).sort()).toEqual(["a", "b"]);
    expect(plan.body.plan.placements.some((item) => item.id === "foreign")).toBe(false);
    expect(plan.body.plan.warnings.some((warning) => warning.code === "TIDY_CLASSIFICATION_IGNORED")).toBe(
      true,
    );
  });

  it("uses the model's labels when they are valid", async () => {
    const facts = await setup("labels");
    const widgets = [note("a", 0, 0, "alpha"), note("b", 300, 0, "beta")];
    await seed(facts.boardId, widgets);
    const task = await createTidyTask(facts, ["a", "b"], { strategy: "meaning" });

    const ai = {
      configured: true,
      chatJson: async () => ({
        json: { strategy: "meaning", blocks: [{ label: "Flow", ids: ["a", "b"] }] },
        usage: { promptTokens: 10, completionTokens: 10, costUsd: 0 },
        model: "fake/tidy",
      }),
    };
    await runAgentTask({ store, taskId: task.id, ai, log: { error() {} } });

    const plan = await facts.person("GET", `/agent-tasks/${task.id}/plan`);
    expect(plan.body.strategy).toBe("meaning");
    expect(plan.body.plan.objects[0].title).toBe("Flow");
  });

  it("stores a truncated selection and reports it in the preview", async () => {
    const facts = await setup("truncated");
    await seed(facts.boardId, [note("long", 0, 0, "word ".repeat(6_000))]);
    const task = await createTidyTask(facts, ["long"]);
    await runAgentTask({ store, taskId: task.id, ai: null, log: { error() {} } });

    const plan = await facts.person("GET", `/agent-tasks/${task.id}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.body.selection.truncated).toBe(true);
    expect(plan.body.selection.counts.chars).toBeLessThanOrEqual(20_000);
    const inputs = await store.listAgentTaskInputs(task.id);
    const row = inputs.find((input) => input.source === "selection");
    expect(row).toMatchObject({ truncated: true, truncation_code: "SELECTION_TRUNCATED" });
  });

  it("refuses a selection over the tidy ceiling", async () => {
    const facts = await setup("large");
    const widgets = Array.from({ length: 201 }, (_, index) =>
      note(`s${index}`, index * 10, 0, `Object ${index}`),
    );
    await seed(facts.boardId, widgets);
    const task = await createTidyTask(facts, widgets.map((widget) => widget.id));

    const result = await runAgentTask({ store, taskId: task.id, ai: null, log: { error() {} } });
    expect(result.status, JSON.stringify(result)).toBe("failed");
    expect(result.code).toBe("PLAN_TOO_LARGE");
    const plan = await facts.person("GET", `/agent-tasks/${task.id}/plan`);
    expect(plan.status).toBe(404);
    expect(plan.body.error).toBe("PLAN_NOT_READY");
  });
});
