/**
 * The tidy runner: selection → classification → deterministic layout → proposed plan.
 *
 * The model is optional. When it is configured it may name blocks, but a refusal, a
 * timeout, a missing key or a foreign id all mean the same thing: the deterministic
 * prefix/type fallback is used and the preview says so (ADR-143). Nothing here writes
 * the board; the client applies an approved plan in one local transaction.
 */
import { withinBudget } from "./agents.mjs";
import { callAgentModel } from "./agent-call.mjs";
import { decide, finite } from "./agent-context.mjs";
import { validateAgentPlan } from "./agent-plan.mjs";
import { buildTidyOperations, parseTidyReply, tidyPrompt, tidyStrategy } from "./agent-tidy.mjs";
import { buildSelectionSource, readSelectionInput } from "./selection-source.mjs";
import { emitMetric } from "./metrics-events.mjs";

function fallbackWarning(error) {
  return {
    code: "TIDY_CLASSIFICATION_IGNORED",
    message: `the model's grouping was ignored (${error?.code ?? "AI_FAILED"}); the selection was laid out by prefix and type`,
  };
}

/** The selection a tidy task was created from, read from storage or rebuilt. */
export async function tidySelectionForTask(store, task) {
  const inputs =
    typeof store.listAgentTaskInputs === "function"
      ? await store.listAgentTaskInputs(task.id)
      : [];
  const stored = readSelectionInput(inputs.find((input) => input.source === "selection"));
  if (stored) return stored;
  const ydoc = await store.roomDocument(task.board_id);
  const ids = Array.isArray(task.input?.selectionIds) ? task.input.selectionIds.map(String) : [];
  return buildSelectionSource(ydoc, ids);
}

/**
 * Recompute a proposed tidy plan for another strategy.
 *
 * The classification is kept, so "by meaning" survives a switch to "grid" and back.
 * No model call: the person is choosing a reading of the same selection, not asking
 * for a new one.
 */
export async function relayoutTidyTask({ store, task, strategy }) {
  const ydoc = await store.roomDocument(task.board_id);
  const selection = await tidySelectionForTask(store, task);
  const requested = tidyStrategy(strategy ?? task.input?.strategy);
  const labels = Array.isArray(task.result?.classification?.blocks)
    ? task.result.classification.blocks
    : null;
  const built = buildTidyOperations(ydoc, {
    selectionIds: Array.isArray(task.input?.selectionIds)
      ? task.input.selectionIds.map(String)
      : [],
    strategy: requested,
    labels,
  });
  const validated = validateAgentPlan({
    ydoc,
    operations: built.operations,
    origin: { x: finite(task.input?.origin?.x), y: finite(task.input?.origin?.y) },
    maxActions: null,
    allowedIds: built.selectionIds,
  });
  return {
    plan: validated.plan,
    estimate: validated.estimate,
    strategy: built.strategy,
    requestedStrategy: requested,
    selection,
    warnings: [...built.warnings, ...validated.plan.warnings],
  };
}

export async function runTidyAuthoring({
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
  const selection = await tidySelectionForTask(store, task);
  const allowedIds = (selection.objects ?? []).map((object) => object.id);
  const requested = tidyStrategy(task.input?.strategy);
  const warnings = [];

  let classification = null;
  let model = null;
  let keySource = null;
  let usage = {
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    actions: 0,
    seconds: Math.max(0, (now() - started) / 1000),
  };

  if (ai?.configured) {
    let called = null;
    try {
      called = await callAgentModel({
        store,
        task,
        agent,
        skill,
        prompt: tidyPrompt({ selection, strategy: requested }),
        budget,
        capabilities: decision.capabilities,
        aclVersion: decision.board?.acl_version,
        inputObjectIds: allowedIds,
        ai,
        env,
        now,
      });
    } catch (error) {
      // A model that cannot answer does not fail a tidy: the deterministic layout is
      // the fallback, not an error page (ADR-143).
      warnings.push(fallbackWarning(error));
    }
    if (called) {
      const { completion, providerInfo } = called;
      usage = {
        promptTokens: completion.usage?.promptTokens ?? 0,
        completionTokens: completion.usage?.completionTokens ?? 0,
        costUsd: completion.usage?.costUsd ?? 0,
        actions: 0,
        seconds: Math.max(0, (now() - started) / 1000),
      };
      if (!withinBudget(budget, usage)) {
        return fail("BUDGET_EXCEEDED", "the model call used more than the task allows", usage);
      }
      model = completion.model ?? null;
      keySource = providerInfo.source;
      try {
        classification = parseTidyReply(completion.json, allowedIds);
      } catch (error) {
        warnings.push(fallbackWarning(error));
      }
    }
  }

  // Permissions and cancellation can change while the model is thinking. Tidy writes
  // nothing, but a plan is still a board proposal somebody will be asked to approve.
  const fresh = await store.getAgentTask(task.id);
  if (!fresh || fresh.status !== "running") return { status: "cancelled" };
  const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
  if (!recheck.decision.allowed) {
    return fail("AGENT_DENIED", recheck.decision.reason);
  }

  const strategy =
    requested === "auto" && classification?.strategy && classification.strategy !== "auto"
      ? classification.strategy
      : requested;

  let built;
  let validated;
  try {
    built = buildTidyOperations(ydoc, {
      selectionIds: Array.isArray(task.input?.selectionIds)
        ? task.input.selectionIds.map(String)
        : [],
      strategy,
      labels: classification?.blocks ?? null,
    });
    validated = validateAgentPlan({
      ydoc,
      operations: built.operations,
      origin: { x: finite(task.input?.origin?.x), y: finite(task.input?.origin?.y) },
      maxActions: budget.maxActions,
      allowedIds: built.selectionIds,
    });
  } catch (error) {
    return fail(error?.code ?? "TIDY_FAILED", error?.message ?? String(error));
  }

  if (typeof store.createAgentPlan !== "function") {
    return fail("PLAN_STORE_FAILED", "this runtime cannot store an authoring plan");
  }
  const allWarnings = [
    ...warnings,
    ...built.warnings,
    ...validated.plan.warnings,
  ].filter(
    (warning, index, list) =>
      list.findIndex((candidate) => candidate.code === warning.code && candidate.tempId === warning.tempId) ===
      index,
  );
  // The plan is what the preview reads: a fallback or a skipped lock belongs to it,
  // not only to the task result, so it survives a reload in another tab.
  validated.plan.warnings = allWarnings;
  validated.estimate.warnings = allWarnings;

  const finalUsage = {
    ...usage,
    actions: validated.estimate.actions,
    seconds: Math.max(0, (now() - started) / 1000),
  };
  const result = {
    planId: null,
    status: "proposed",
    strategy: built.strategy,
    requestedStrategy: built.requestedStrategy,
    classification: classification ?? null,
    counts: validated.plan.counts,
    estimate: validated.estimate,
    warnings: allWarnings,
    selection: {
      counts: selection.counts,
      truncated: selection.truncated === true,
    },
    skill: skill.slug,
    skillVersion: skill.version,
    model,
    keySource,
  };

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
      model,
    });
  } catch (error) {
    return fail("PLAN_STORE_FAILED", error?.message ?? String(error));
  }
  if (!row) return fail("PLAN_STORE_FAILED", "the plan was not stored");
  result.planId = row.id;

  const updated = await store.finishAgentTask({
    id: task.id,
    status: "awaiting_approval",
    usage: finalUsage,
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
      placements: validated.plan.counts.placements,
      strategy: built.strategy,
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
      actions: validated.estimate.actions,
      costUsd: finalUsage.costUsd,
      seconds: finalUsage.seconds,
    },
  });

  return { status: "awaiting_approval", task: updated, result };
}
