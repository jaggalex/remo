/**
 * The runner half of `room-draft` (ADR-189).
 *
 * The model produces a plan-shaped draft; the server validates it, finds free space and
 * writes the frame, its objects and its connectors in one transaction. The result is a
 * normal piece of content from that moment on: the team edits it, comments on it and
 * undoes it with the ordinary tools.
 */
import { withinBudget } from "./agents.mjs";
import { callAgentModel } from "./agent-call.mjs";
import { decide } from "./agent-context.mjs";
import { emitMetric } from "./metrics-events.mjs";
import {
  ROOM_DRAFT_SKILL,
  applyRoomDraft,
  draftOrigin,
  findDraftFrame,
  parseRoomDraftReply,
  roomDraftPlan,
  roomDraftPrompt,
  sourceExcerpts,
} from "./agent-room-draft.mjs";

function draftTitle(lang, agentName, title) {
  const prefix = lang === "en" ? `Draft · ${agentName}` : `Черновик · ${agentName}`;
  return `${prefix} — ${title}`.slice(0, 160);
}

export async function runRoomDraft({
  store,
  task,
  agent,
  skill,
  budget,
  decision,
  ai,
  env,
  log,
  now,
  started,
  fail,
  audit,
}) {
  const threadId = task.thread_id ?? task.input?.threadId ?? null;
  if (!threadId) {
    return fail("THREAD_REQUIRED", "a room draft is always part of a task thread");
  }

  const finishMessage = async (status, text, frameIds = []) => {
    if (!threadId || typeof store.updateAgentThreadMessageByTask !== "function") return;
    await store
      .updateAgentThreadMessageByTask({ taskId: task.id, status, text, frameIds })
      .catch((error) => log.error?.("[agents] thread message failed:", error.message));
  };
  const failDraft = async (code, message, extra = {}, result = null) => {
    await finishMessage("error", message);
    return fail(code, message, extra, result);
  };

  await finishMessage("running", "");
  const ydoc = await store.roomDocument(task.board_id);

  // A retry after a lost flush must find the frame the first attempt wrote instead of
  // duplicating the draft (ADR-189).
  const already = findDraftFrame(ydoc, task.id);
  if (already) {
    const result = {
      frameId: already,
      createdIds: [],
      recovered: true,
      skill: skill.slug,
      skillVersion: skill.version,
    };
    const updated = await store.finishAgentTask({
      id: task.id,
      status: "applied",
      usage: { seconds: Math.max(0, (now() - started) / 1000) },
      result,
    });
    await finishMessage("ready", "", [already]);
    return updated ? { status: "applied", task: updated, result } : { status: "cancelled" };
  }

  const sourceIds = Array.isArray(task.input?.sourceIds)
    ? task.input.sourceIds.map(String)
    : [];
  const sources = sourceExcerpts(ydoc, sourceIds);
  const messages =
    threadId && typeof store.listAgentThreadMessages === "function"
      ? await store.listAgentThreadMessages(threadId)
      : [];
  const thread = messages
    .filter((message) => message.task_id !== task.id)
    .map((message) => ({
      role: message.role,
      text: message.text,
    }));

  const prompt = roomDraftPrompt({
    kind: task.input?.kind,
    lang: task.input?.lang,
    intent: task.intent,
    sources,
    thread: thread
      .map((message) => `${message.role === "agent" ? "agent" : "person"}: ${message.text}`)
      .join("\n"),
  });

  let called;
  try {
    called = await callAgentModel({
      store,
      task,
      agent,
      skill,
      prompt,
      budget,
      capabilities: decision.capabilities,
      aclVersion: decision.board?.acl_version,
      inputObjectIds: sourceIds,
      ai,
      env,
      now,
    });
  } catch (error) {
    return failDraft(error?.code ?? "AI_FAILED", error?.message ?? String(error));
  }

  const { completion, providerInfo } = called;
  let usage = {
    promptTokens: completion.usage?.promptTokens ?? 0,
    completionTokens: completion.usage?.completionTokens ?? 0,
    costUsd: completion.usage?.costUsd ?? 0,
    actions: 0,
    seconds: Math.max(0, (now() - started) / 1000),
  };
  if (!withinBudget(budget, usage)) {
    return failDraft("BUDGET_EXCEEDED", "the model call used more than the task allows", usage);
  }

  // A model call takes seconds. Revoking the assignment, disabling the agent or
  // stopping the task during that time must leave the canvas untouched (ADR-189).
  const fresh = await store.getAgentTask(task.id);
  if (!fresh || fresh.status !== "running") {
    await finishMessage("stopped", "");
    return { status: "cancelled" };
  }
  const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
  if (!recheck.decision.allowed) {
    return failDraft("AGENT_DENIED", recheck.decision.reason);
  }
  const assignment = typeof store.getBoardAgent === "function"
    ? await store.getBoardAgent(task.board_id)
    : null;
  if (!assignment || !assignment.enabled || assignment.agent_id !== task.agent_id) {
    return failDraft("AGENT_UNASSIGNED", "the agent is no longer assigned to this room");
  }
  const board = await store.getIamBoard(task.board_id);
  if (!board || board.visibility === "link") {
    return failDraft("PUBLIC_LINK_ON", "the public link is on; ask the owner to turn it off");
  }

  let reply;
  try {
    reply = parseRoomDraftReply(completion.json);
  } catch (error) {
    return failDraft(error?.code ?? "DRAFT_SCHEMA", error?.message ?? String(error));
  }

  let plan;
  try {
    plan = roomDraftPlan(reply, {
      origin: {
        x: Number(task.input?.origin?.x) || 0,
        y: Number(task.input?.origin?.y) || 0,
      },
      existingWidgets: [...ydoc.getMap("widgets").values()].map((widget) => ({
        id: widget.id,
        type: widget.type,
        locked: widget.locked === true,
        parentId: widget.parentId ?? null,
        x: widget.x,
        y: widget.y,
        width: widget.width,
        height: widget.height,
      })),
      existingConnectors: [...ydoc.getMap("widgets").values()]
        .filter((widget) => widget.type === "connector" && widget.start?.item && widget.end?.item)
        .map((widget) => ({ from: widget.start.item, to: widget.end.item })),
    });
  } catch (error) {
    return failDraft(error?.code ?? "DRAFT_INVALID", error?.message ?? String(error));
  }

  if (plan.plan.counts.objects > budget.maxActions) {
    return failDraft("BUDGET_ACTIONS", `the task allows ${budget.maxActions} changes`);
  }

  const current = await store.roomDocument(task.board_id);
  if (current !== ydoc) {
    return failDraft("APPLY_FAILED", "the room was replaced before the write");
  }

  const placed = draftOrigin(ydoc, plan.plan, {
    x: Number(task.input?.origin?.x) || 0,
    y: Number(task.input?.origin?.y) || 0,
  });
  const title = draftTitle(task.input?.lang, agent.name, reply.title);
  let applied;
  try {
    applied = applyRoomDraft(ydoc, plan.plan, {
      placed,
      title,
      agent,
      taskId: task.id,
      citations: reply.citations,
      labels: reply.labels ?? [],
      sourceIds,
      now: now(),
    });
  } catch (error) {
    return failDraft(error?.code ?? "DRAFT_WRITE_FAILED", error?.message ?? String(error));
  }

  usage = {
    ...usage,
    actions: applied.createdIds.length,
    seconds: Math.max(0, (now() - started) / 1000),
  };
  const result = {
    frameId: applied.frameId,
    createdIds: applied.createdIds,
    title: applied.title,
    questions: reply.questions ?? [],
    counts: plan.plan.counts,
    placedAt: placed,
    skill: skill.slug,
    skillVersion: skill.version,
    model: completion.model ?? null,
    keySource: providerInfo.source,
  };
  if (!withinBudget(budget, usage)) {
    return failDraft("BUDGET_EXCEEDED", "the draft used more than the task allows", usage, result);
  }

  const flushed = await store.flushRoom?.(task.board_id);
  if (flushed === false) {
    return failDraft("APPLY_FAILED", "the room was replaced before the write was stored");
  }
  const updated = await store.finishAgentTask({
    id: task.id,
    status: "applied",
    usage,
    result,
  });
  if (!updated) {
    await finishMessage("stopped", "");
    return { status: "cancelled" };
  }

  await finishMessage("ready", applied.title, [applied.frameId]);

  await audit(store, log, {
    actorId: task.created_by,
    orgId: task.org_id,
    boardId: task.board_id,
    action: "agent.draft.write",
    subject: applied.title.slice(0, 200),
    agentId: task.agent_id,
    taskId: task.id,
    skill: `${skill.slug}@${skill.version}`,
    actorType: "agent",
    after: {
      frameId: applied.frameId,
      objects: applied.createdIds.length,
      questions: (reply.questions ?? []).length,
    },
  });
  await audit(store, log, {
    actorId: task.created_by,
    orgId: task.org_id,
    boardId: task.board_id,
    action: "agent.task.finish",
    subject: "applied",
    agentId: task.agent_id,
    taskId: task.id,
    skill: skill.slug,
    actorType: "agent",
  });
  emitMetric({
    name: "agent.task.finished",
    orgId: task.org_id,
    actorId: task.agent_id,
    actorType: "agent",
    boardId: task.board_id,
    props: {
      status: "applied",
      skill: task.skill_slug,
      actions: applied.createdIds.length,
      costUsd: usage.costUsd,
      seconds: usage.seconds,
    },
  });

  return { status: "applied", task: updated, result };
}
