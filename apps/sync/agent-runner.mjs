/**
 * Running an agent task: the only place that turns a queued task into changes on a
 * board.
 *
 * Everything is checked twice — when the task is created and again just before the
 * document is touched — because a model call takes seconds and permissions can change
 * in the meantime. The runner never trusts a skill, a budget or a board flag it read
 * before the call (spec/AI-agents-v1.md §3, §10).
 */
import { normalizeBudget, resolveSkill, withinBudget } from "./agents.mjs";
import { agentLimitsFromEnv, audit, decide, finite, selectionTexts } from "./agent-context.mjs";
import { callAgentModel } from "./agent-call.mjs";
import { runBriefAuthoring } from "./agent-brief-runner.mjs";
import { runTidyAuthoring } from "./agent-tidy-runner.mjs";
import { CARD_LIMITS, convertToCards } from "./cards.mjs";
import { executeChangeSet } from "./change-set.mjs";
import { applyDiagram, diagramPrompt, parseDiagram } from "./diagram.mjs";
import { effective } from "./iam.mjs";
import { emitMetric } from "./metrics-events.mjs";

export async function runAgentTask({
  store,
  taskId,
  ai = null,
  log = console,
  limits = agentLimitsFromEnv(),
  now = Date.now,
  env = process.env,
}) {
  const claimed = await store.claimAgentTask(taskId);
  if (!claimed) return { status: "skipped", reason: "not-queued" };

  const task = await store.getAgentTask(taskId);
  if (!task) return { status: "skipped", reason: "missing" };
  const agent = await store.getAgent(task.agent_id);
  const started = now();
  let usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, actions: 0, seconds: 0 };

  const fail = async (code, message, extra = {}, result = null) => {
    const seconds = Math.max(0, (now() - started) / 1000);
    const finalUsage = { ...usage, ...extra, seconds };
    const updated = await store.finishAgentTask({
      id: task.id,
      status: "failed",
      usage: finalUsage,
      result,
      error: `${code}: ${message}`,
    });
    if (updated) {
      await audit(store, log, {
        actorId: task.created_by,
        orgId: task.org_id,
        boardId: task.board_id,
        action: "agent.task.finish",
        subject: code,
        agentId: task.agent_id,
        taskId: task.id,
        skill: task.skill_slug,
        actorType: "agent",
        reason: message,
      });
    }
    return { status: "failed", code, message };
  };

  /**
   * The document must be the room's current one when the write happens, and the write
   * must be durable before the task says `applied`. A reload can replace the room while
   * the model is thinking; writing to the retired document loses the objects.
   */
  const flushApplied = async (doc) => {
    const current = await store.roomDocument(task.board_id);
    if (doc && current !== doc) return false;
    const stored = await store.flushRoom?.(task.board_id);
    return stored !== false;
  };

  try {
    const first = await decide(store, task, agent);
    if (!first.decision.allowed) {
      await audit(store, log, {
        actorId: task.created_by,
        orgId: task.org_id,
        boardId: task.board_id,
        action: "agent.denied",
        subject: first.decision.reason,
        agentId: task.agent_id,
        taskId: task.id,
        actorType: "agent",
      });
      return fail("AGENT_DENIED", first.decision.reason);
    }

    if (task.skill_slug === "change-set") {
      const changeSetId = task.input?.changeSetId;
      const changeSet = changeSetId ? await store.getChangeSet(changeSetId) : null;
      if (
        !changeSet ||
        changeSet.agent_id !== task.agent_id ||
        changeSet.board_id !== task.board_id
      ) {
        return fail("CHANGE_SET_MISSING", "the change set does not belong to this task");
      }
      const startedSet = await store.startChangeSet(changeSet.id);
      if (!startedSet) return { status: "cancelled" };

      const budget = normalizeBudget(task.budget ?? {}, limits);
      const fresh = await store.getAgentTask(task.id);
      if (!fresh || fresh.status !== "running") {
        await store
          .finishChangeSet({ id: changeSet.id, status: "cancelled", error: "cancelled" })
          .catch(() => {});
        return { status: "cancelled" };
      }
      const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
      if (!recheck.decision.allowed) {
        await store
          .finishChangeSet({
            id: changeSet.id,
            status: "failed",
            error: `AGENT_DENIED: ${recheck.decision.reason}`,
          })
          .catch(() => {});
        return fail("AGENT_DENIED", recheck.decision.reason);
      }

      const ydoc = await store.roomDocument(task.board_id);
      let executed;
      try {
        executed = await executeChangeSet({
          ydoc,
          operations: changeSet.operations ?? [],
          agent: { id: agent.id, name: agent.name },
          taskId: task.id,
          budget,
          origin: {
            x: finite(task.input?.origin?.x),
            y: finite(task.input?.origin?.y),
          },
          progress: changeSet.progress ?? {},
          changeSetId: changeSet.id,
          // Agent writes are domain events too (ADR-097). The dedupe key inside each
          // event makes a resumed chunk harmless; the batch is written before the
          // progress that would skip it.
          onEvents:
            typeof store.recordEvents === "function"
              ? (events) =>
                  store.recordEvents({
                    boardId: task.board_id,
                    orgId: task.org_id,
                    actorId: task.agent_id,
                    actorType: "agent",
                    events,
                  })
              : null,
          onProgress: async (progress) => {
            await store
              .updateAgentTaskProgress?.(task.id, progress)
              .catch(() => {});
            await store.updateChangeSetProgress(changeSet.id, progress).catch(() => {});
          },
          shouldContinue: async () => {
            const current = await store.getAgentTask(task.id);
            return current?.status === "running";
          },
        });
      } catch (error) {
        await store
          .finishChangeSet({
            id: changeSet.id,
            status: "failed",
            error: `${error?.code ?? "CHANGE_SET_FAILED"}: ${error?.message ?? error}`,
          })
          .catch(() => {});
        return fail(error?.code ?? "CHANGE_SET_FAILED", error?.message ?? String(error));
      }

      if (executed.cancelled) {
        await store
          .finishChangeSet({
            id: changeSet.id,
            status: "cancelled",
            progress: executed,
            error: "cancelled",
          })
          .catch(() => {});
        return { status: "cancelled" };
      }

      for (const card of executed.created) {
        await store.recordAgentAction({
          taskId: task.id,
          boardId: task.board_id,
          objectId: card.id,
          action: "create_card",
          detail: { sourceId: card.sourceId, title: card.title, columnId: card.columnId },
        });
      }
      for (const connector of executed.connectors ?? []) {
        await store.recordAgentAction({
          taskId: task.id,
          boardId: task.board_id,
          objectId: connector.id,
          action: "set_connector",
          detail: { from: connector.from ?? null, to: connector.to ?? null, routing: connector.routing ?? null },
        });
      }

      const usage = {
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        actions: executed.count,
        seconds: Math.max(0, (now() - started) / 1000),
      };
      const result = {
        ...executed,
        skill: "cards",
        skillVersion: 1,
        model: null,
        changeSetId: changeSet.id,
      };
      if (!(await flushApplied(ydoc))) {
        return fail("APPLY_FAILED", "the room was replaced before the write was stored");
      }
      const updated = await store.finishAgentTask({
        id: task.id,
        status: "applied",
        usage,
        result,
      });
      if (!updated) {
        await store
          .finishChangeSet({
            id: changeSet.id,
            status: "cancelled",
            error: "the task was cancelled while the change set was finishing",
          })
          .catch(() => {});
        return { status: "cancelled" };
      }
      await store.finishChangeSet({
        id: changeSet.id,
        status: "applied",
        result,
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
          actions: executed.count,
          costUsd: usage.costUsd,
          seconds: usage.seconds,
        },
      });

      await audit(store, log, {
        actorId: task.created_by,
        orgId: task.org_id,
        boardId: task.board_id,
        action: "agent.write",
        subject: task.intent.slice(0, 200),
        agentId: task.agent_id,
        taskId: task.id,
        skill: "cards@1",
        actorType: "agent",
        after: {
          cards: executed.created.length,
          connectors: (executed.connectors ?? []).length,
          skipped: executed.skipped.length,
          changeSetId: changeSet.id,
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
        skill: "cards",
        actorType: "agent",
        reason: "change set",
      });
      return { status: "applied", task: updated, result };
    }

    const catalog = await store.listAgentSkills(task.org_id);
    const skill =
      (task.skill_id ? await store.getAgentSkill(task.skill_id) : null) ??
      resolveSkill(catalog, { slug: task.skill_slug, intent: task.intent });
    if (!skill || skill.state !== "published") return fail("SKILL_UNAVAILABLE", "no published skill");
    if (
      !["builtin:diagram", "builtin:cards", "builtin:brief", "builtin:tidy"].includes(
        skill.handler,
      )
    ) {
      return fail("SKILL_NOT_SUPPORTED", `this runtime cannot execute ${skill.handler}`);
    }
    if (!(skill.required_capabilities ?? []).every((cap) => first.decision.capabilities.includes(cap))) {
      return fail("SKILL_NOT_ALLOWED", "the skill asks for more than the task allows");
    }

    const budget = normalizeBudget(task.budget ?? {}, limits);
    const ydoc = await store.roomDocument(task.board_id);

    if (skill.handler === "builtin:cards") {
      const fresh = await store.getAgentTask(task.id);
      if (!fresh || fresh.status !== "running") return { status: "cancelled" };
      const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
      if (!recheck.decision.allowed) return fail("AGENT_DENIED", recheck.decision.reason);

      const selection = Array.isArray(task.input?.selectionIds)
        ? task.input.selectionIds.map(String)
        : [];
      const options = {
        target: task.input?.target ?? { kind: "standalone" },
        mode: task.input?.mode === "move" ? "move" : "copy",
        origin: {
          x: finite(task.input?.origin?.x),
          y: finite(task.input?.origin?.y),
        },
        agent: { id: agent.id, name: agent.name },
        taskId: task.id,
        skill: skill.slug,
      };

      // Plan first: nothing is written until the whole batch fits the budget and the
      // per-task limit. A partial conversion that silently drops objects is worse than
      // a clear refusal.
      let plan;
      try {
        plan = convertToCards(await store.roomDocument(task.board_id), {
          ...options,
          selectionIds: selection,
          maxCards: budget.maxActions,
          dryRun: true,
        });
      } catch (error) {
        return fail(error?.code ?? "CARDS_FAILED", error?.message ?? String(error));
      }
      if (plan.count > budget.maxActions) {
        return fail("BUDGET_ACTIONS", `the task allows ${budget.maxActions} changes`);
      }

      const chunks = [];
      for (let index = 0; index < selection.length; index += CARD_LIMITS.chunk) {
        chunks.push(selection.slice(index, index + CARD_LIMITS.chunk));
      }

      const created = [];
      const skipped = [...plan.skipped];
      let targetResult = plan.target;
      let lastDoc = null;
      for (const [index, chunk] of chunks.entries()) {
        const fresh = await store.getAgentTask(task.id);
        if (!fresh || fresh.status !== "running") return { status: "cancelled" };
        const current = await store.roomDocument(task.board_id);
        if (lastDoc && current !== lastDoc) {
          return fail("APPLY_FAILED", "the room was replaced during the card conversion");
        }
        lastDoc = current;
        let converted;
        try {
          converted = convertToCards(current, {
            ...options,
            selectionIds: chunk,
            maxCards: chunk.length,
          });
        } catch (error) {
          if (created.length) {
            return fail(
              error?.code ?? "CARDS_PARTIAL",
              `${created.length} cards were created before the failure: ${error?.message ?? error}`,
              { actions: created.length },
              { partial: true, created, skipped, target: targetResult },
            );
          }
          return fail(error?.code ?? "CARDS_FAILED", error?.message ?? String(error));
        }
        created.push(...converted.created);
        skipped.push(...converted.skipped);
        targetResult = converted.target;
        await store
          .updateAgentTaskProgress?.(task.id, {
            done: created.length,
            total: selection.length,
            chunk: index + 1,
            chunks: chunks.length,
          })
          .catch(() => {});
      }

      for (const card of created) {
        await store.recordAgentAction({
          taskId: task.id,
          boardId: task.board_id,
          objectId: card.id,
          action: "create_card",
          detail: { sourceId: card.sourceId, title: card.title, columnId: card.columnId },
        });
      }

      const cardUsage = {
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        actions: created.length,
        seconds: Math.max(0, (now() - started) / 1000),
      };
      if (!withinBudget(budget, cardUsage)) {
        return fail("BUDGET_EXCEEDED", "the conversion used more than the task allows", cardUsage);
      }
      const cardResult = {
        created,
        skipped,
        count: created.length,
        target: targetResult,
        mode: options.mode,
        chunks: chunks.length,
        skill: skill.slug,
        skillVersion: skill.version,
        model: null,
      };
      if (!(await flushApplied(lastDoc))) {
        return fail("APPLY_FAILED", "the room was replaced before the write was stored");
      }
      const updated = await store.finishAgentTask({
        id: task.id,
        status: "applied",
        usage: cardUsage,
        result: cardResult,
      });
      if (!updated) return { status: "cancelled" };

      await audit(store, log, {
        actorId: task.created_by,
        orgId: task.org_id,
        boardId: task.board_id,
        action: "agent.write",
        subject: task.intent.slice(0, 200),
        agentId: task.agent_id,
        taskId: task.id,
        skill: `${skill.slug}@${skill.version}`,
        actorType: "agent",
        after: { cards: created.length, skipped: skipped.length },
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
      return { status: "applied", task: updated, result: cardResult };
    }

    if (skill.handler === "builtin:brief") {
      // The plan is the result: nothing is written until a person approves it and the
      // client applies it in one transaction (ADR-142).
      return runBriefAuthoring({
        store,
        task,
        agent,
        skill,
        budget,
        decision: { ...first.decision, board: first.board },
        ai,
        env,
        log,
        now,
        started,
        fail,
        audit,
      });
    }

    if (skill.handler === "builtin:tidy") {
      // Tidy also proposes and stops. It works without a provider: the layout is
      // deterministic and the model only labels blocks (ADR-143).
      return runTidyAuthoring({
        store,
        task,
        agent,
        skill,
        budget,
        decision: { ...first.decision, board: first.board },
        ai,
        env,
        log,
        now,
        started,
        fail,
        audit,
      });
    }

    const selection = selectionTexts(ydoc, task.input?.selectionIds ?? []);
    const prompt = diagramPrompt({ intent: task.intent, selection });
    const inputObjectIds = Array.isArray(task.input?.selectionIds)
      ? task.input.selectionIds.map(String)
      : [];
    let called;
    try {
      called = await callAgentModel({
        store,
        task,
        agent,
        skill,
        prompt,
        budget,
        capabilities: first.decision.capabilities,
        aclVersion: first.board?.acl_version,
        inputObjectIds,
        ai,
        env,
        now,
      });
    } catch (error) {
      return fail(error?.code ?? "AI_FAILED", error?.message ?? String(error));
    }
    const { completion, providerInfo } = called;
    usage = {
      promptTokens: completion.usage?.promptTokens ?? 0,
      completionTokens: completion.usage?.completionTokens ?? 0,
      costUsd: completion.usage?.costUsd ?? 0,
      actions: 0,
      seconds: 0,
    };

    let diagram;
    try {
      diagram = parseDiagram(completion.json);
    } catch (error) {
      return fail(error?.code ?? "BAD_DIAGRAM", error?.message ?? "invalid diagram");
    }

    usage.actions = diagram.nodes.length + diagram.edges.length;
    usage.seconds = Math.max(0, (now() - started) / 1000);
    if (usage.actions > budget.maxActions) {
      return fail("BUDGET_ACTIONS", `the diagram needs ${usage.actions} changes`);
    }
    if (!withinBudget(budget, usage)) {
      return fail("BUDGET_EXCEEDED", "the model call used more than the task allows");
    }

    // Permissions can change while the model is thinking: re-read the task, the agent
    // and the owner's access, then decide again.
    const fresh = await store.getAgentTask(task.id);
    if (!fresh || fresh.status !== "running") return { status: "cancelled" };
    const recheck = await decide(store, fresh, await store.getAgent(task.agent_id));
    if (!recheck.decision.allowed) {
      return fail("AGENT_DENIED", recheck.decision.reason);
    }

    const origin = {
      x: finite(task.input?.origin?.x),
      y: finite(task.input?.origin?.y),
    };
    let applied;
    let currentDoc = null;
    try {
      currentDoc = await store.roomDocument(task.board_id);
      applied = applyDiagram(currentDoc, diagram, {
        origin,
        agent: { id: agent.id, name: agent.name },
        taskId: task.id,
        skill: skill.slug,
      });
    } catch (error) {
      return fail("APPLY_FAILED", error?.message ?? String(error));
    }

    for (const object of applied.objects) {
      await store.recordAgentAction({
        taskId: task.id,
        boardId: task.board_id,
        objectId: object.id,
        action: object.kind === "node" ? "create_shape" : "create_connector",
        detail: object,
      });
    }

    const result = {
      title: applied.title,
      nodes: applied.nodes,
      edges: applied.edges,
      objects: applied.objects,
      origin: applied.origin,
      skill: skill.slug,
      skillVersion: skill.version,
      model: completion.model,
      keySource: providerInfo.source,
    };
    if (!(await flushApplied(currentDoc))) {
      return fail("APPLY_FAILED", "the room was replaced before the write was stored");
    }
    const updated = await store.finishAgentTask({
      id: task.id,
      status: "applied",
      usage,
      result,
    });
    if (!updated) return { status: "cancelled" };

    await audit(store, log, {
      actorId: task.created_by,
      orgId: task.org_id,
      boardId: task.board_id,
      action: "agent.write",
      subject: task.intent.slice(0, 200),
      agentId: task.agent_id,
      taskId: task.id,
      skill: `${skill.slug}@${skill.version}`,
      actorType: "agent",
      after: { nodes: applied.nodes, edges: applied.edges, objects: applied.objects.length },
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

    return { status: "applied", task: updated, result };
  } catch (error) {
    log.error?.("[agent] task failed:", error);
    const code =
      error?.code === "AI_NOT_CONFIGURED" ? "AI_NOT_CONFIGURED" : "AGENT_ERROR";
    return fail(code, error?.message ?? String(error));
  }
}

/**
 * One scheduler tick: due schedules become tasks, then queued tasks run.
 *
 * Single-flight is the caller's job (the service has one process in v1), and tasks are
 * processed one at a time so a large diagram cannot starve the canvas.
 */
export async function agentTick({
  store,
  ai,
  log = console,
  limits = agentLimitsFromEnv(),
  maxSchedules = 5,
  maxTasks = 2,
}) {
  const created = [];
  for (const schedule of await store.dueAgentSchedules(maxSchedules)) {
    // Moving the clock first makes a crash re-run the schedule rather than double-run
    // it: the task row is the durable record, and the next tick is a full interval away.
    const advanced = await store.advanceAgentSchedule(schedule.id);
    if (!advanced) continue;

    const agent = await store.getAgent(schedule.agent_id);
    if (!agent || agent.state !== "active") continue;
    const board = await store.getIamBoard(schedule.board_id);
    const policy = await store.getOrgPolicy(schedule.org_id);
    if (!board || !board.agents_enabled || !policy.agentsEnabled) continue;

    // Do not queue work that will obviously be denied: a schedule whose owner lost
    // edit rights should stay quiet instead of producing a failed task every interval.
    const facts = await store.accessFacts(schedule.board_id, agent.owner_id);
    const access = facts
      ? effective({
          board: facts.board,
          viewer: facts.viewer,
          grants: facts.grants,
          policy: facts.policy,
        })
      : null;
    if (!access?.allowed || !access.capabilities.includes("board.edit")) continue;

    const task = await store.createAgentTask({
      orgId: schedule.org_id,
      agentId: schedule.agent_id,
      boardId: schedule.board_id,
      mode: "write",
      capabilities: ["board.read", "board.edit"],
      intent: schedule.intent,
      input: schedule.input ?? {},
      skillSlug: schedule.skill_slug,
      budget: schedule.budget ?? {},
      createdBy: schedule.created_by,
      scheduleId: schedule.id,
    });
    if (task) {
      created.push(task.id);
      await audit(store, log, {
        actorId: schedule.created_by,
        orgId: schedule.org_id,
        boardId: schedule.board_id,
        action: "agent.task.create",
        subject: schedule.intent.slice(0, 200),
        agentId: schedule.agent_id,
        taskId: task.id,
        skill: schedule.skill_slug,
        actorType: "agent",
        reason: "schedule",
      });
    }
  }

  // A task may be backed by an environment key or by a key stored for the org in the
  // database; the scheduler cannot tell from `ai.configured` alone, so it always tries.
  // `callAgentModel` resolves the stored credential; a missing one fails the task with
  // AI_NOT_CONFIGURED instead of leaving it silently queued (ADR-142).
  const ran = [];
  for (let index = 0; index < maxTasks; index += 1) {
    const next = await store.nextQueuedAgentTask();
    if (!next) break;
    ran.push(await runAgentTask({ store, taskId: next.id, ai, log, limits }));
  }
  return { created, ran };
}
