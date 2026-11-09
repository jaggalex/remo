/**
 * The human half of the agent surface, built once per request.
 *
 * Every human route needs the same things: who is asking, whether they belong to the
 * organisation, and the single preflight that decides whether a task may exist at all.
 * Building them here keeps that decision in one place instead of repeating it in each
 * route module.
 */
import { agentLimitsFromEnv, roomAgentCanRequest, withRoomAgentLock } from "./agent-context.mjs";
import { agentEffective, aiEntryRefusal, budgetMissing, normalizeBudget, resolveSkill } from "./agents.mjs";
import { accessForBoard } from "./iam-api.mjs";
import { effective } from "./iam.mjs";
import { MAX_QUEUED, SKILL_HANDLERS, originOf, selectionIds } from "./agent-api-shared.mjs";
import { ROOM_DRAFT_SKILL } from "./agent-room-draft.mjs";
import { prepareTaskInputs } from "./task-file.mjs";
import { buildSelectionSource, selectionInput } from "./selection-source.mjs";

export function humanContext({ request, store, log, onTaskQueued, me, sessionId = null }) {

  const audit = (event) =>
    store.recordAudit({ actorId: me.id, sessionId, ...event }).catch((error) => {
      log.error?.("[agents] audit failed:", error.message);
    });

  const membership = (orgId) => store.getOrgMembership(orgId, me.id);
  const isMember = async (orgId) => {
    const seat = await membership(orgId);
    return Boolean(seat && seat.state === "active" && seat.relation === "member");
  };
  const isOrgAdmin = (orgId) => store.hasOrgRole(orgId, me.id, "org_admin");

  async function boardAndAccess(boardId) {
    const board = await store.getIamBoard(boardId);
    if (!board || !board.owner_id) return { board: null, access: null };
    const resolved = await accessForBoard({ store, boardId, userId: me.id });
    return { board, access: resolved?.access ?? null };
  }

  /** Everything a task needs, checked once, with one reason on refusal. */
  async function preflight({ boardId, agentId, skillSlug, roomAssignment = null }) {
    const { board, access } = await boardAndAccess(boardId);
    if (!board) return { status: 404, code: "RESOURCE_NOT_AVAILABLE", message: "board not found" };
    if (!access?.allowed) {
      return { status: 404, code: "RESOURCE_NOT_AVAILABLE", message: "board not found" };
    }
    // The reason matters: a link visitor must sign in, a reader must ask for edit
    // rights. Both are refused before anything else is looked at (ADR-066, AG-12).
    const entry = aiEntryRefusal(access);
    if (entry === "ACCOUNT_REQUIRED") {
      return {
        status: 403,
        code: "ACCOUNT_REQUIRED",
        message: "AI works for an account: a public link is view-only",
      };
    }
    if (entry) {
      return { status: 403, code: "FORBIDDEN", message: "you cannot edit this board" };
    }
    const agent = await store.getAgent(agentId);
    if (!agent || agent.org_id !== board.org_id) {
      return { status: 404, code: "RESOURCE_NOT_AVAILABLE", message: "agent not found" };
    }
    if (agent.owner_id !== me.id && !roomAssignment) {
      return { status: 403, code: "FORBIDDEN", message: "you can only run your own agent" };
    }
    if (roomAssignment && !await roomAgentCanRequest(store, board, roomAssignment, me.id)) {
      return { status: 403, code: "FORBIDDEN", message: "you cannot ask the room agent" };
    }
    const skill = await store.getAgentSkillBySlug(board.org_id, skillSlug);
    if (!skill) {
      return { status: 422, code: "SKILL_UNAVAILABLE", message: "no published skill with this slug" };
    }
    if (!roomAssignment && skill.handler === ROOM_DRAFT_SKILL.handler) {
      return { status: 422, code: "SKILL_NOT_SUPPORTED", message: "use the room agent panel" };
    }
    if (!SKILL_HANDLERS.has(skill.handler)) {
      return { status: 422, code: "SKILL_NOT_SUPPORTED", message: "this runtime cannot execute the skill" };
    }
    const policy = await store.getOrgPolicy(board.org_id);
    const facts = await store.accessFacts(boardId, agent.owner_id);
    const ownerAccess = facts
      ? effective({
          board: facts.board,
          viewer: facts.viewer,
          grants: facts.grants,
          policy: facts.policy,
        })
      : access;
    const decision = agentEffective({
      agent,
      ownerAccess,
      board: { ...board, agentsEnabled: board.agents_enabled === true },
      policy,
      task: {
        id: "preflight",
        status: "queued",
        mode: "write",
        capabilities: skill.required_capabilities ?? [],
      },
    });
    if (!decision.allowed) {
      return { status: 403, code: "AGENT_DENIED", message: decision.reason };
    }
    // This runtime only executes writing skills; a skill that asks for less than
    // board.edit would create a task that can never run.
    if (!decision.capabilities.includes("board.edit")) {
      return { status: 403, code: "AGENT_DENIED", message: "NO_CAPABILITY" };
    }
    return { board, agent, skill, decision };
  }

  async function createTask({ boardId, body }) {
    const agentId = String(body?.agentId ?? "");
    const intent = String(body?.intent ?? "").trim();
    if (!agentId) return { status: 422, code: "AGENT_REQUIRED", message: "choose an agent" };
    if (intent.length < 3 || intent.length > 2000) {
      return { status: 422, code: "BAD_INTENT", message: "describe the task in 3–2000 characters" };
    }
    // "Auto" is an empty slug: the server resolves it from the intent and the tenant's
    // catalog. An explicit slug still wins over every hint (ADR-143).
    let skillSlug = String(body?.skillSlug ?? "").trim();
    if (!skillSlug) {
      const { board } = await boardAndAccess(boardId);
      const catalog = board ? (await store.listAgentSkills(board.org_id))
        .filter((skill) => skill.handler !== ROOM_DRAFT_SKILL.handler) : [];
      skillSlug = resolveSkill(catalog, { intent })?.slug ?? "diagram";
    }
    const ready = await preflight({ boardId, agentId, skillSlug });
    if (ready.status) return ready;

    // A replay must not be turned into a refusal: the same key returns the task that
    // was created, even if this copy of the request omitted a field (AG-11).
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "")
      .trim()
      .slice(0, 100);
    if (idempotencyKey) {
      const existing = await store.findAgentTaskByIdempotency(boardId, me.id, idempotencyKey);
      if (existing) {
        return { status: 200, task: await store.getAgentTask(existing.id), replayed: true };
      }
    }

    // The brief and the attached file are data for the model (ADR-142 "Untrusted
    // content"). Validate both here, so a task is never created around a file the
    // runner would refuse after the model call.
    let prepared;
    try {
      prepared = prepareTaskInputs({ text: body?.text, file: body?.file });
    } catch (error) {
      return {
        status: 422,
        code: error?.code ?? "BAD_FILE",
        message: error?.message ?? "the attached text cannot be read",
      };
    }

    // The selection is source too (ADR-143): groups expand, a frame brings its
    // contents, and the model sees texts, kinds, boxes and the lines between selected
    // objects. It is read once here and stored beside the task, so the preview and the
    // prompt cannot disagree about what was sent.
    const chosen = selectionIds(body?.selectionIds);
    let selection = null;
    if (chosen.length) {
      try {
        const ydoc = await store.roomDocument(boardId);
        selection = buildSelectionSource(ydoc, chosen);
      } catch (error) {
        return {
          status: 503,
          code: "SELECTION_UNAVAILABLE",
          message: `the selection could not be read: ${error?.message ?? "the board is not open"}`,
        };
      }
    }
    const strategy = ["auto", "grid", "prefix", "type", "meaning"].includes(body?.strategy)
      ? body.strategy
      : "auto";

    if (budgetMissing(body?.budget)) {
      return {
        status: 422,
        code: "BUDGET_REQUIRED",
        message: "set a budget: a task without one is not created",
      };
    }

    if ((await store.countQueuedAgentTasks(boardId)) >= MAX_QUEUED) {
      return { status: 429, code: "TOO_MANY_TASKS", message: "too many tasks on this board" };
    }

    const credentialId = body?.credentialId ? String(body.credentialId) : null;
    if (credentialId) {
      const row = await store.getAiCredential(credentialId);
      const allowed =
        row &&
        ((row.scope === "user" && row.scope_id === me.id) ||
          (row.scope === "org" && row.scope_id === ready.board.org_id));
      if (!allowed) {
        return { status: 422, code: "BAD_CREDENTIAL", message: "choose a key that belongs to you or this organisation" };
      }
    }
    let task;
    try {
      task = await store.createAgentTask({
        orgId: ready.board.org_id,
        agentId: ready.agent.id,
        boardId,
        mode: "write",
        capabilities: ready.decision.capabilities,
        intent,
        input: {
          origin: originOf(body?.origin),
          selectionIds: chosen,
          target: body?.target ?? { kind: "standalone" },
          mode: body?.mode === "move" ? "move" : "copy",
          strategy,
          ...(prepared.meta.text ? { text: prepared.meta.text } : {}),
          ...(prepared.meta.file ? { file: prepared.meta.file } : {}),
        },
        skillId: ready.skill.id,
        skillSlug: ready.skill.slug,
        skillVersion: ready.skill.version,
        budget: normalizeBudget(body?.budget ?? {}, agentLimitsFromEnv()),
        createdBy: me.id,
        credentialId,
        model: body?.model ? String(body.model).trim().slice(0, 120) : null,
        idempotencyKey: idempotencyKey || null,
      });
    } catch (error) {
      if (idempotencyKey && error?.code === "23505") {
        const existing = await store.findAgentTaskByIdempotency(
          boardId,
          me.id,
          idempotencyKey,
        );
        if (existing) {
          return { status: 200, task: await store.getAgentTask(existing.id), replayed: true };
        }
      }
      throw error;
    }
    if (prepared.inputs.length || selection) {
      try {
        await store.createAgentTaskInputs({
          taskId: task.id,
          boardId,
          inputs: [
            ...prepared.inputs,
            ...(selection ? [selectionInput(selection)] : []),
          ],
        });
      } catch (error) {
        // A task without its brief must not run: cancel it and say why instead of
        // queuing a model call that sees nothing.
        await store.cancelAgentTask(task.id).catch(() => {});
        return {
          status: 503,
          code: "TASK_INPUT_FAILED",
          message: `the task was not queued: ${error?.message ?? "the attached text could not be stored"}`,
        };
      }
    }
    await audit({
      orgId: ready.board.org_id,
      boardId,
      action: "agent.task.create",
      subject: intent.slice(0, 200),
      agentId: ready.agent.id,
      taskId: task.id,
      skill: `${ready.skill.slug}@${ready.skill.version}`,
      actorType: "user",
    });
    try {
      onTaskQueued?.();
    } catch (error) {
      log.error?.("[agents] could not wake the runner:", error.message);
    }
    return { status: 202, task };
  }

  async function createSchedule({ boardId, body }) {
    const agentId = String(body?.agentId ?? "");
    const intent = String(body?.intent ?? "").trim();
    if (!agentId) return { status: 422, code: "AGENT_REQUIRED", message: "choose an agent" };
    if (intent.length < 3 || intent.length > 2000) {
      return { status: 422, code: "BAD_INTENT", message: "describe the task in 3–2000 characters" };
    }
    const requestedInterval = Number(body?.intervalSeconds);
    if (
      !Number.isFinite(requestedInterval) ||
      requestedInterval < 60 ||
      requestedInterval > 2_592_000
    ) {
      return { status: 422, code: "BAD_INTERVAL", message: "interval must be between 60 seconds and 30 days" };
    }
    const intervalSeconds = Math.round(requestedInterval);
    let skillSlug = String(body?.skillSlug ?? "").trim();
    if (!skillSlug) {
      const { board } = await boardAndAccess(boardId);
      const catalog = board ? (await store.listAgentSkills(board.org_id))
        .filter((skill) => skill.handler !== ROOM_DRAFT_SKILL.handler) : [];
      skillSlug = resolveSkill(catalog, { intent })?.slug ?? "diagram";
    }
    const ready = await preflight({ boardId, agentId, skillSlug });
    if (ready.status) return ready;

    if (budgetMissing(body?.budget)) {
      return {
        status: 422,
        code: "BUDGET_REQUIRED",
        message: "set a budget: a schedule without one is not created",
      };
    }

    const schedule = await store.createAgentSchedule({
      orgId: ready.board.org_id,
      agentId: ready.agent.id,
      boardId,
      skillSlug: ready.skill.slug,
      intent,
      input: { origin: originOf(body?.origin), selectionIds: selectionIds(body?.selectionIds) },
      budget: normalizeBudget(body?.budget ?? {}, agentLimitsFromEnv()),
      intervalSeconds,
      createdBy: me.id,
    });
    await audit({
      orgId: ready.board.org_id,
      boardId,
      action: "agent.schedule.create",
      subject: intent.slice(0, 200),
      agentId: ready.agent.id,
      skill: ready.skill.slug,
      after: { intervalSeconds },
      actorType: "user",
    });
    return { status: 201, schedule };
  }


  /**
   * A room task (ADR-189): one assigned agent, one thread, one immediate draft.
   *
   * The room owner or a selected editor can ask. The ordinary agent preflight still
   * bounds the task by the rights of the agent's owner.
   */
  async function createRoomTask({ boardId, body }) {
    return withRoomAgentLock(store, boardId, () => enqueueRoomTask(boardId, body));
  }

  async function enqueueRoomTask(boardId, body) {
    const intent = String(body?.intent ?? "").trim();
    if (intent.length < 3 || intent.length > 2000) {
      return { status: 422, code: "BAD_INTENT", message: "describe the task in 3–2000 characters" };
    }
    const kind = ["process", "delivery-plan", "problem-map"].includes(body?.kind)
      ? body.kind
      : "process";
    const lang = body?.lang === "en" ? "en" : "ru";
    const sourceIds = selectionIds(body?.sourceIds).slice(0, 24);
    const origin = originOf(body?.origin);

    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      return { status: 404, code: "RESOURCE_NOT_AVAILABLE", message: "board not found" };
    }
    if (board.visibility === "link") {
      return {
        status: 409,
        code: "PUBLIC_LINK_ON",
        message: "turn off the public link before asking the agent",
      };
    }
    const assignment = typeof store.getBoardAgent === "function"
      ? await store.getBoardAgent(boardId)
      : null;
    if (!assignment || !assignment.enabled) {
      return { status: 409, code: "AGENT_NOT_ASSIGNED", message: "assign an agent to this room first" };
    }

    const ready = await preflight({
      boardId,
      agentId: assignment.agent_id,
      skillSlug: "room-draft",
      roomAssignment: assignment,
    });
    if (ready.status) return ready;

    let thread = null;
    if (body?.threadId) {
      thread = typeof store.getAgentThread === "function"
        ? await store.getAgentThread(String(body.threadId))
        : null;
      if (!thread || thread.board_id !== boardId || thread.agent_id !== assignment.agent_id) {
        return { status: 404, code: "THREAD_NOT_FOUND", message: "no such task thread" };
      }
      if (thread.created_by !== me.id && board.owner_id !== me.id) {
        return { status: 403, code: "FORBIDDEN", message: "this thread belongs to somebody else" };
      }
    }

    const key = String(request.headers["idempotency-key"] ?? "").trim().slice(0, 95);
    const idempotencyKey = key ? `room:${key}` : null;
    if (idempotencyKey) {
      const existing = await store.findAgentTaskByIdempotency(boardId, me.id, idempotencyKey);
      if (existing) {
        const task = await store.getAgentTask(existing.id);
        const saved = task?.thread_id ? await store.getAgentThread(task.thread_id) : null;
        if (!saved || (thread && saved.id !== thread.id)) {
          return { status: 409, code: "REQUEST_CONFLICT", message: "request already used" };
        }
        return { status: 200, thread: saved, task };
      }
    }
    if ((await store.countQueuedAgentTasks(boardId)) >= MAX_QUEUED) {
      return { status: 429, code: "TOO_MANY_TASKS", message: "too many tasks in this room" };
    }

    const result = await store.enqueueRoomAgentTask({
      thread,
      agentName: ready.agent.name,
      authorName: me.name,
      task: {
        orgId: board.org_id,
        agentId: ready.agent.id,
        boardId,
        mode: "write",
        capabilities: ready.decision.capabilities,
        intent,
        input: { kind, sourceIds, origin, lang },
        skillId: ready.skill.id,
        skillSlug: ready.skill.slug,
        skillVersion: ready.skill.version,
        budget: normalizeBudget({}, agentLimitsFromEnv()),
        createdBy: me.id,
        idempotencyKey,
      },
    });
    ({ thread } = result);
    const { task } = result;

    await audit({
      orgId: board.org_id,
      boardId,
      action: "agent.thread.task",
      subject: thread.id,
      agentId: ready.agent.id,
      taskId: task.id,
      skill: `${ready.skill.slug}@${ready.skill.version}`,
      actorType: "user",
      after: { threadId: thread.id, kind, sources: sourceIds.length },
    });
    try {
      onTaskQueued?.();
    } catch (error) {
      log.error?.("[agents] could not wake the runner:", error.message);
    }
    return { status: 202, thread, task };
  }

  return {
    me,
    audit,
    membership,
    isMember,
    isOrgAdmin,
    boardAndAccess,
    preflight,
    createTask,
    createRoomTask,
    createSchedule,
    onTaskQueued,
  };
}
