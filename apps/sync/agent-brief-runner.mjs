/**
 * The runner half of `brief-to-board`: ask the model for operations, validate them
 * against the live board, store a **proposed** plan and stop.
 *
 * Nothing is written to the document. Approval is a person's act and the client's
 * transaction (ADR-142); this module only proves that the plan fits the contract and
 * the task budget before anybody is asked to approve it.
 */
import { withinBudget } from "./agents.mjs";
import { boardSnapshot, briefPrompt, parseBriefReply } from "./agent-brief.mjs";
import { callAgentModel } from "./agent-call.mjs";
import { decide, finite } from "./agent-context.mjs";
import { validateAgentPlan } from "./agent-plan.mjs";
import { emitMetric } from "./metrics-events.mjs";

export async function runBriefAuthoring({
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
  const ydoc = await store.roomDocument(task.board_id);
  const inputs =
    typeof store.listAgentTaskInputs === "function"
      ? await store.listAgentTaskInputs(task.id)
      : [];
  const selectionRow = inputs.find((input) => input.source === "selection");
  let selectionIds = [];
  if (selectionRow?.content) {
    try {
      const parsed = JSON.parse(selectionRow.content);
      selectionIds = Array.isArray(parsed?.objects)
        ? parsed.objects.map((object) => String(object.id ?? "")).filter(Boolean)
        : [];
    } catch {
      selectionIds = [];
    }
  }
  const origin = {
    x: finite(task.input?.origin?.x),
    y: finite(task.input?.origin?.y),
  };
  const prompt = briefPrompt({
    intent: task.intent,
    origin,
    inputs,
    snapshot: boardSnapshot(ydoc),
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
      // The selection is context too: the model may place a structure beside it and
      // refer to its objects, and the AI journal records which objects were read.
      inputObjectIds: selectionIds,
      ai,
      env,
      now,
    });
  } catch (error) {
    return fail(error?.code ?? "AI_FAILED", error?.message ?? String(error));
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

  // Permissions and cancellation can change while the model is thinking. Re-read the
  // task and the owner's access before a plan is stored for somebody to approve.
  const fresh = await store.getAgentTask(task.id);
  if (!fresh || fresh.status !== "running") return { status: "cancelled" };
  const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
  if (!recheck.decision.allowed) {
    return fail("AGENT_DENIED", recheck.decision.reason);
  }

  let operations;
  try {
    operations = parseBriefReply(completion.json);
  } catch (error) {
    return fail(error?.code ?? "BRIEF_SCHEMA", error?.message ?? String(error));
  }

  let validated;
  try {
    validated = validateAgentPlan({
      ydoc,
      operations,
      origin,
      maxActions: budget.maxActions,
      // The brief may create; it may never move an existing object. `place_widgets`
      // belongs to tidy, and a model reply that asks for it is refused here.
      allowPlacements: false,
    });
  } catch (error) {
    return fail(error?.code ?? "BRIEF_INVALID", error?.message ?? String(error));
  }

  if (typeof store.createAgentPlan !== "function") {
    return fail("PLAN_STORE_FAILED", "this runtime cannot store an authoring plan");
  }
  let row;
  try {
    row = await store.createAgentPlan({
      taskId: task.id,
      orgId: task.org_id,
      boardId: task.board_id,
      agentId: task.agent_id,
      plan: validated.plan,
      estimate: validated.estimate,
      skillSlug: skill.slug,
      skillVersion: skill.version,
      model: completion.model ?? null,
    });
  } catch (error) {
    return fail("PLAN_STORE_FAILED", error?.message ?? String(error));
  }
  if (!row) return fail("PLAN_STORE_FAILED", "the plan was not stored");

  usage = { ...usage, seconds: Math.max(0, (now() - started) / 1000) };
  const result = {
    planId: row.id,
    status: row.status,
    counts: validated.plan.counts,
    estimate: validated.estimate,
    warnings: validated.estimate.warnings,
    skill: skill.slug,
    skillVersion: skill.version,
    model: completion.model ?? null,
    keySource: providerInfo.source,
  };
  const updated = await store.finishAgentTask({
    id: task.id,
    status: "awaiting_approval",
    usage,
    result,
  });
  if (!updated) return { status: "cancelled" };

  await audit(store, log, {
    actorId: task.created_by,
    orgId: task.org_id,
    boardId: task.board_id,
    action: "agent.plan.propose",
    subject: task.intent.slice(0, 200),
    agentId: task.agent_id,
    taskId: task.id,
    skill: `${skill.slug}@${skill.version}`,
    actorType: "agent",
    after: {
      planId: row.id,
      objects: validated.plan.counts.objects,
      connectors: validated.plan.counts.connectors,
      status: row.status,
    },
  });
  await audit(store, log, {
    actorId: task.created_by,
    orgId: task.org_id,
    boardId: task.board_id,
    action: "agent.task.finish",
    subject: "awaiting_approval",
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
      status: "awaiting_approval",
      skill: task.skill_slug,
      actions: 0,
      costUsd: usage.costUsd,
      seconds: usage.seconds,
    },
  });

  return { status: "awaiting_approval", task: updated, result };
}
