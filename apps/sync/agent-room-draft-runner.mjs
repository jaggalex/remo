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
import { decide, roomAgentCanRequest, withRoomAgentLock } from "./agent-context.mjs";
import { emitMetric } from "./metrics-events.mjs";
import {
  ROOM_DRAFT_SKILL,
  applyRoomDraft,
  draftOrigin,
  fitDraftFrame,
  findDraftFrame,
  parseRoomDraftReply,
  roomDraftPlan,
  roomDraftPrompt,
  sourceExcerpts,
  threadExcerpt,
} from "./agent-room-draft.mjs";
import { deliveryPlan, parseDeliveryReply } from "./agent-delivery-layout.mjs";
import { actionsPlan, decisionPlan, requirementsPlan, retrospectivePlan } from "./agent-zones-layout.mjs";
import { matrixPlan, mvpPlan } from "./agent-mvp-layout.mjs";

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
  const threadId = task.thread_id;
  if (!threadId) {
    return fail("THREAD_REQUIRED", "a room draft is always part of a task thread");
  }

  const finishMessage = async (status, text, frameIds = []) => {
    if (!threadId || typeof store.updateAgentThreadMessageByTask !== "function") return;
    await store
      .updateAgentThreadMessageByTask({ taskId: task.id, status, text, frameIds })
      .catch((error) => log.error?.("[agents] thread message failed:", error.message));
  };
  const checkPermission = async () => {
    const fresh = await store.getAgentTask(task.id);
    if (fresh?.status !== "running" || fresh.thread_id !== threadId) return "STOPPED";
    const assignment = await store.getBoardAgent(task.board_id);
    const board = await store.getIamBoard(task.board_id);
    if (assignment?.agent_id !== task.agent_id
        || !await roomAgentCanRequest(store, board, assignment, task.created_by)) {
      return "AGENT_DENIED";
    }
    const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
    return recheck.decision.allowed ? null : "AGENT_DENIED";
  };
  const refuse = async (reason) => {
    if (reason === "STOPPED") {
      await finishMessage("stopped", "");
      return { status: "cancelled" };
    }
    return fail(reason, "the room agent is no longer allowed to act");
  };

  const initialRefusal = await checkPermission();
  if (initialRefusal) return refuse(initialRefusal);
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
  // A selected frame expands to its children: a citation may name any of them, and the
  // model was given their text, so the citation filter must know the same set.
  const expandedSourceIds = sources.map((source) => source.id);
  const messages =
    threadId && typeof store.listAgentThreadMessages === "function"
      ? await store.listAgentThreadMessages(threadId)
      : [];
  const requestIndex = messages.findIndex((message) => message.task_id === task.id);
  const earlier = requestIndex < 0 ? [] : messages.slice(0, requestIndex);


  const prompt = roomDraftPrompt({
    kind: task.input?.kind,
    lang: task.input?.lang,
    intent: task.intent,
    sources,
    thread: threadExcerpt(earlier.filter((message) => message.role === "user" || message.status === "ready")),
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
      inputObjectIds: expandedSourceIds,
      ai,
      env,
      now,
    });
  } catch (error) {
    return fail(error?.code ?? "AI_FAILED", "the provider could not prepare a draft");
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
    return fail("BUDGET_EXCEEDED", "the model call used more than the task allows", usage);
  }

  const existingWidgets = [...ydoc.getMap("widgets").values()].map((widget) => ({
    id: widget.id,
    type: widget.type,
    locked: widget.locked === true,
    parentId: widget.parentId ?? null,
    x: widget.x,
    y: widget.y,
    width: widget.width,
    height: widget.height,
  }));
  const existingConnectors = [...ydoc.getMap("widgets").values()]
    .filter((widget) => widget.type === "connector" && widget.start?.item && widget.end?.item)
    .map((widget) => ({ from: widget.start.item, to: widget.end.item }));
  const widgets = ydoc.getMap("widgets");
  const previous = earlier.flatMap((message) => message.frame_ids ?? [])
    .reverse().map((id) => widgets.get(id)).find((widget) => widget?.type === "frame");
  const origin = previous ? { x: previous.x + previous.width / 2 + 80, y: previous.y - previous.height / 2 } : {
    x: Number(task.input?.origin?.x) || 0,
    y: Number(task.input?.origin?.y) || 0,
  };

  // Two result shapes, one writer: a process or problem map is a plan the model laid
  // out; a delivery plan is zones and items, laid out deterministically here.
  let draft;
  try {
    if (task.input?.kind === "delivery-plan") {
      const structured = parseDeliveryReply(completion.json);
      const built = deliveryPlan(structured, {
        lang: task.input?.lang,
        sourceIds: expandedSourceIds,
        existingWidgets,
        existingConnectors,
      });
      draft = {
        plan: built.plan,
        title: built.title,
        labels: built.labels,
        citations: built.citations,
        questions: built.questions,
      };
    } else if (task.input?.kind === "requirements") {
      const built = requirementsPlan(completion.json, {
        lang: task.input?.lang,
        sourceIds: expandedSourceIds,
        existingWidgets,
        existingConnectors,
      });
      draft = {
        plan: built.plan,
        title: built.title,
        labels: [],
        citations: built.citations,
        questions: built.questions,
      };
    } else if (task.input?.kind === "mvp-scoping") {
      const built = mvpPlan(completion.json, {
        lang: task.input?.lang,
        sourceIds: expandedSourceIds,
        existingWidgets,
        existingConnectors,
      });
      draft = {
        plan: built.plan,
        title: built.title,
        labels: [],
        citations: built.citations,
        questions: built.questions,
      };
    } else if (["prioritization", "competitors", "architecture-decision", "idea-generation"].includes(task.input?.kind)) {
      const built = matrixPlan(completion.json, {
        lang: task.input?.lang,
        sourceIds: expandedSourceIds,
        existingWidgets,
        existingConnectors,
        cellType: "text",
        cellHeight: 76,
      });
      draft = {
        plan: built.plan,
        title: built.title,
        labels: [],
        citations: built.citations,
        questions: built.questions,
      };
    } else if (["retrospective", "decision", "meeting-actions"].includes(task.input?.kind)) {
      const planFor = {
        retrospective: retrospectivePlan,
        decision: decisionPlan,
        "meeting-actions": actionsPlan,
      }[task.input.kind];
      const built = planFor(completion.json, {
        lang: task.input?.lang,
        sourceIds: expandedSourceIds,
        existingWidgets,
        existingConnectors,
      });
      draft = {
        plan: built.plan,
        title: built.title,
        labels: [],
        citations: built.citations,
        questions: built.questions,
      };
    } else {
      const reply = parseRoomDraftReply(completion.json);
      const { plan } = roomDraftPlan(reply, { origin, existingWidgets, existingConnectors });
      draft = {
        plan,
        title: reply.title,
        labels: reply.labels ?? [],
        citations: reply.citations,
        questions: reply.questions ?? [],
      };
    }
  } catch (error) {
    return failDraft(error?.code ?? "DRAFT_INVALID", error?.message ?? "the model returned an invalid draft");
  }

  fitDraftFrame(draft.plan);

  const committed = await withRoomAgentLock(store, task.board_id, async () => {
    const current = await store.roomDocument(task.board_id);
    if (current !== ydoc) {
      return { outcome: await fail("APPLY_FAILED", "the room was replaced before the write") };
    }

    const refusal = await checkPermission();
    if (refusal) return { outcome: await refuse(refusal) };
    const actions = draft.plan.counts.actions + draft.labels.length;
    const seconds = Math.max(0, (now() - started) / 1000);
    if (!withinBudget(budget, { ...usage, actions, seconds })) {
      return { outcome: await fail("BUDGET_EXCEEDED", "the draft exceeds the task budget", usage) };
    }

    const placed = draftOrigin(ydoc, draft.plan, origin);
    const title = draftTitle(task.input?.lang, agent.name, draft.title);
    let applied;
    try {
      applied = applyRoomDraft(ydoc, draft.plan, {
        placed,
        title,
        agent,
        taskId: task.id,
        citations: draft.citations,
        labels: draft.labels,
        sourceIds: expandedSourceIds,
        now: now(),
      });
    } catch (error) {
      return { outcome: await fail(error?.code ?? "DRAFT_WRITE_FAILED", "the draft could not be written") };
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
      questions: draft.questions,
      counts: draft.plan.counts,
      placedAt: placed,
      skill: skill.slug,
      skillVersion: skill.version,
      model: completion.model ?? null,
      keySource: providerInfo.source,
    };
    const flushed = await store.flushRoom?.(task.board_id);
    if (flushed === false) {
      return { outcome: await fail("APPLY_FAILED", "the room was replaced before the write was stored") };
    }
    const updated = await store.finishAgentTask({
      id: task.id,
      status: "applied",
      usage,
      result,
    });
    if (!updated) {
      await finishMessage("stopped", "");
      return { outcome: { status: "cancelled" } };
    }

    await finishMessage("ready", applied.title, [applied.frameId]);
    return { applied, updated, result };
  });
  if ("outcome" in committed) return committed.outcome;
  const { applied, updated, result } = committed;

  await audit(store, log, {
    actorId: task.created_by,
    orgId: task.org_id,
    boardId: task.board_id,
    action: "agent.draft.write",
    subject: applied.frameId,
    agentId: task.agent_id,
    taskId: task.id,
    skill: `${skill.slug}@${skill.version}`,
    actorType: "agent",
    after: {
      frameId: applied.frameId,
      objects: applied.createdIds.length,
      questions: draft.questions.length,
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
