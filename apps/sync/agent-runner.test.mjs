import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import { agentTick, runAgentTask } from "./agent-runner.mjs";

const skill = {
  id: "s1",
  slug: "diagram",
  version: 1,
  name: "Diagram",
  state: "published",
  handler: "builtin:diagram",
  required_capabilities: ["board.read", "board.edit"],
  risk: "write",
};

function makeTask(overrides = {}) {
  return {
    id: "t1",
    org_id: "o1",
    agent_id: "a1",
    board_id: "b1",
    mode: "write",
    capabilities: ["board.read", "board.edit"],
    intent: "Нарисуй процесс оплаты",
    input: { origin: { x: 10, y: 20 } },
    skill_id: null,
    skill_slug: "diagram",
    skill_version: 1,
    status: "queued",
    budget: {},
    usage: {},
    result: null,
    error: null,
    created_by: "u1",
    schedule_id: null,
    created_at: new Date("2026-10-25T10:00:00Z"),
    ...overrides,
  };
}

function fakeStore({
  task = makeTask(),
  boardAgents = true,
  orgAgents = true,
  ownerRole = "owner",
  due = [],
  skills = [skill],
} = {}) {
  const state = {
    task: { ...task },
    ydoc: new Y.Doc(),
    audits: [],
    actions: [],
    schedules: due,
    created: [],
    advanced: [],
  };
  const agent = { id: "a1", org_id: "o1", owner_id: "u1", name: "Scout", state: "active" };
  const board = {
    id: "b1",
    org_id: "o1",
    owner_id: ownerRole === "owner" ? "u1" : null,
    agents_enabled: boardAgents,
    visibility: "private",
    archived_at: null,
    acl_version: 1,
  };
  const facts = {
    board: {
      id: "b1",
      ownerId: board.owner_id,
      orgId: "o1",
      teamId: null,
      visibility: "private",
      archivedAt: null,
      aclVersion: 1,
    },
    viewer: { userId: "u1", org: { relation: "member", state: "active" }, teamRole: null },
    grants:
      ownerRole === "owner"
        ? []
        : [{ subjectType: "user", subjectId: "u1", role: ownerRole }],
    policy: { canShare: true, publicLinks: false },
  };

  return {
    state,
    claimAgentTask: async (id) => {
      if (state.task.id !== id || state.task.status !== "queued") return null;
      state.task = { ...state.task, status: "running", started_at: new Date() };
      return state.task;
    },
    getAgentTask: async () => ({
      ...state.task,
      agent_name: agent.name,
      owner_id: agent.owner_id,
      agent_state: agent.state,
      owner_name: "Owner",
      owner_email: "owner@example.com",
      board_title: "Board",
    }),
    getAgent: async () => agent,
    getIamBoard: async () => board,
    getOrgPolicy: async () => ({ agentsEnabled: orgAgents }),
    accessFacts: async () => facts,
    listAgentSkills: async () => skills,
    getAgentSkill: async () => skills[0],
    roomDocument: async () => state.ydoc,
    finishAgentTask: async ({ id, status, usage, result, error }) => {
      if (state.task.id !== id || state.task.status !== "running") return null;
      state.task = { ...state.task, status, usage, result, error };
      return state.task;
    },
    recordAudit: async (event) => state.audits.push(event),
    recordAgentAction: async (action) => state.actions.push(action),
    updateAgentTaskProgress: async (_id, progress) => {
      state.progress = progress;
      return { id: _id, progress };
    },
    dueAgentSchedules: async () => state.schedules,
    advanceAgentSchedule: async (id) => {
      state.advanced.push(id);
      return { id };
    },
    createAgentTask: async (input) => {
      state.created.push(input);
      return { id: "new-task" };
    },
    nextQueuedAgentTask: async () => null,
  };
}

const goodAi = {
  chatJson: async () => ({
    json: {
      title: "Payment",
      nodes: [
        { id: "n1", label: "Start", kind: "ellipse" },
        { id: "n2", label: "Pay", kind: "rectangle" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.001 },
    model: "fake/model",
  }),
};

describe("runAgentTask", () => {
  it("applies a diagram and records provenance, actions and audit", async () => {
    const store = fakeStore();
    const result = await runAgentTask({ store, taskId: "t1", ai: goodAi, log: { error() {} } });

    expect(result.status).toBe("applied");
    expect(store.state.task.status).toBe("applied");
    const widgets = [...store.state.ydoc.getMap("widgets").values()];
    expect(widgets).toHaveLength(3);
    expect(widgets.filter((widget) => widget.type === "shape")).toHaveLength(2);
    expect(widgets.find((widget) => widget.agent)).toMatchObject({ agent: { id: "a1", taskId: "t1" } });
    expect(store.state.actions).toHaveLength(3);
    expect(store.state.audits.map((event) => event.action)).toEqual([
      "agent.write",
      "agent.task.finish",
    ]);
    expect(store.state.task.usage.actions).toBe(3);
  });

  it("denies a task when the board has agents switched off", async () => {
    const store = fakeStore({ boardAgents: false });
    const result = await runAgentTask({ store, taskId: "t1", ai: goodAi, log: { error() {} } });
    expect(result).toMatchObject({ status: "failed", code: "AGENT_DENIED" });
    expect(store.state.ydoc.getMap("widgets").size).toBe(0);
    expect(store.state.audits[0].action).toBe("agent.denied");
  });

  it("is never stronger than the owner", async () => {
    const store = fakeStore({ ownerRole: "viewer" });
    const result = await runAgentTask({ store, taskId: "t1", ai: goodAi, log: { error() {} } });
    expect(result).toMatchObject({ status: "failed", code: "AGENT_DENIED" });
    expect(result.message).toBe("NO_CAPABILITY");
    expect(store.state.ydoc.getMap("widgets").size).toBe(0);
  });

  it("stops before writing when the diagram exceeds the action budget", async () => {
    const store = fakeStore({ task: makeTask({ budget: { maxActions: 1 } }) });
    const result = await runAgentTask({ store, taskId: "t1", ai: goodAi, log: { error() {} } });
    expect(result).toMatchObject({ status: "failed", code: "BUDGET_ACTIONS" });
    expect(store.state.ydoc.getMap("widgets").size).toBe(0);
    expect(store.state.actions).toHaveLength(0);
  });

  it("reports a provider that is not configured instead of writing", async () => {
    const store = fakeStore();
    const ai = {
      chatJson: async () => {
        const error = new Error("set REMO_AI_API_KEY");
        error.code = "AI_NOT_CONFIGURED";
        throw error;
      },
    };
    const result = await runAgentTask({ store, taskId: "t1", ai, log: { error() {} } });
    expect(result).toMatchObject({ status: "failed", code: "AI_NOT_CONFIGURED" });
    expect(store.state.ydoc.getMap("widgets").size).toBe(0);
  });

  it("does not touch the board when the task was cancelled while thinking", async () => {
    const store = fakeStore();
    const ai = {
      chatJson: async () => {
        store.state.task = { ...store.state.task, status: "cancelled" };
        return goodAi.chatJson();
      },
    };
    const result = await runAgentTask({ store, taskId: "t1", ai, log: { error() {} } });
    expect(result.status).toBe("cancelled");
    expect(store.state.ydoc.getMap("widgets").size).toBe(0);
  });
});

describe("runAgentTask: cards", () => {
  const cardSkill = {
    id: "s2",
    slug: "cards",
    version: 1,
    state: "published",
    handler: "builtin:cards",
    required_capabilities: ["board.read", "board.edit"],
    tools: ["read_selection", "write_cards"],
    risk: "write",
  };

  function storeWithNotes(task) {
    const store = fakeStore({ task, skills: [cardSkill] });
    const widgets = store.state.ydoc.getMap("widgets");
    const texts = store.state.ydoc.getMap("texts");
    for (const id of ["s1", "s2"]) {
      widgets.set(id, {
        id,
        type: "sticky_note",
        parentId: null,
        x: 0,
        y: 0,
        width: 160,
        height: 180,
      });
      const value = new Y.Text();
      value.insert(0, `${id} title\n${id} details`);
      texts.set(id, value);
    }
    return store;
  }

  it("converts the selection without calling a model", async () => {
    const task = makeTask({
      skill_slug: "cards",
      intent: "Сделай карточки",
      input: { selectionIds: ["s1", "s2"], target: { kind: "standalone" }, mode: "copy" },
      budget: { maxActions: 10 },
    });
    const store = storeWithNotes(task);
    let called = false;
    const ai = {
      chatJson: async () => {
        called = true;
        throw new Error("must not be called");
      },
    };
    const result = await runAgentTask({ store, taskId: "t1", ai, log: { error() {} } });
    expect(result.status).toBe("applied");
    expect(called).toBe(false);
    const cards = [...store.state.ydoc.getMap("widgets").values()].filter(
      (widget) => widget.type === "card",
    );
    expect(cards).toHaveLength(2);
    expect(store.state.actions.filter((action) => action.action === "create_card")).toHaveLength(2);
    expect(store.state.audits[0].action).toBe("agent.write");
  });

  it("processes a large selection in chunks with progress", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `bulk_${index}`);
    const task = makeTask({
      skill_slug: "cards",
      intent: "Сделай карточки",
      input: { selectionIds: ids, target: { kind: "standalone" } },
      budget: { maxActions: 200 },
    });
    const store = fakeStore({ task, skills: [cardSkill] });
    for (const id of ids) {
      store.state.ydoc.getMap("widgets").set(id, {
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
      store.state.ydoc.getMap("texts").set(id, text);
    }
    const result = await runAgentTask({
      store,
      taskId: "t1",
      ai: { chatJson: async () => ({}) },
      log: { error() {} },
    });
    expect(result.status).toBe("applied");
    expect(result.result.count).toBe(120);
    expect(result.result.chunks).toBe(3);
    expect(store.state.progress).toMatchObject({ done: 120, total: 120, chunks: 3 });
  });

  it("stops before writing when the card budget is too small", async () => {
    const task = makeTask({
      skill_slug: "cards",
      intent: "Сделай карточки",
      input: { selectionIds: ["s1", "s2"], target: { kind: "standalone" } },
      budget: { maxActions: 1 },
    });
    const store = storeWithNotes(task);
    const result = await runAgentTask({
      store,
      taskId: "t1",
      ai: { chatJson: async () => ({}) },
      log: { error() {} },
    });
    expect(result).toMatchObject({ status: "failed", code: "BUDGET_ACTIONS" });
    expect(
      [...store.state.ydoc.getMap("widgets").values()].filter((w) => w.type === "card"),
    ).toHaveLength(0);
  });
});

describe("agentTick", () => {
  it("turns a due schedule into one task and advances its clock", async () => {
    const store = fakeStore({
      due: [
        {
          id: "sched1",
          org_id: "o1",
          agent_id: "a1",
          board_id: "b1",
          skill_slug: "diagram",
          intent: "Обнови схему",
          input: {},
          budget: {},
          interval_seconds: 3600,
          created_by: "u1",
        },
      ],
    });
    const tick = await agentTick({ store, ai: goodAi, log: { error() {} } });
    expect(tick.created).toEqual(["new-task"]);
    expect(store.state.advanced).toEqual(["sched1"]);
    expect(store.state.created[0]).toMatchObject({
      boardId: "b1",
      agentId: "a1",
      scheduleId: "sched1",
      intent: "Обнови схему",
      mode: "write",
    });
    expect(store.state.audits[0].reason).toBe("schedule");
  });

  it("skips a schedule whose owner can no longer edit", async () => {
    const store = fakeStore({
      ownerRole: "viewer",
      due: [
        {
          id: "sched1",
          org_id: "o1",
          agent_id: "a1",
          board_id: "b1",
          skill_slug: "diagram",
          intent: "Обнови схему",
          input: {},
          budget: {},
          interval_seconds: 3600,
          created_by: "u1",
        },
      ],
    });
    const tick = await agentTick({ store, ai: goodAi, log: { error() {} } });
    expect(tick.created).toEqual([]);
    // The clock still moves, so it does not retry in a tight loop.
    expect(store.state.advanced).toEqual(["sched1"]);
  });
});

describe("agent scheduler without an environment provider", () => {
  it("still asks the runner, so a key stored for the org can run the task", async () => {
    let queued = 0;
    let claimed = 0;
    const result = await agentTick({
      store: {
        dueAgentSchedules: async () => [],
        nextQueuedAgentTask: async () => {
          queued += 1;
          return queued === 1 ? { id: "t1", skill_slug: "diagram" } : null;
        },
        // The runner resolved no key for this task: the task is not claimed.
        claimAgentTask: async () => {
          claimed += 1;
          return false;
        },
      },
      ai: { configured: false },
      log: { error: () => {} },
    });
    // No early `configured` gate: the runner is reached and decides per task.
    expect(claimed).toBe(1);
    expect(result.ran).toEqual([{ status: "skipped", reason: "not-queued" }]);
  });
});
