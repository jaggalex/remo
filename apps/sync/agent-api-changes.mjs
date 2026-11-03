/**
 * Change sets: preview, cancel, execute, resume — the agent writes through one.
 */
import { agentLimitsFromEnv } from "./agent-context.mjs";
import { budgetMissing, normalizeBudget } from "./agents.mjs";
import { estimateChangeSet } from "./change-set.mjs";
import { fail, json, readBody } from "./iam-api.mjs";
import { originOf } from "./agent-api-shared.mjs";

export async function handleChangeSets(ctx) {
  const { request, response, parts, method, store, log, me, audit, isOrgAdmin, boardAndAccess, preflight, onTaskQueued } = ctx;

  async function prepareChangeSet({ boardId, body }) {
    const agentId = String(body?.agentId ?? "");
    if (!agentId) return { status: 422, code: "AGENT_REQUIRED", message: "choose an agent" };
    const operations = body?.operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      return { status: 422, code: "BAD_OPERATIONS", message: "provide at least one operation" };
    }
    const intent = String(body?.intent ?? "Cards from a selection").trim().slice(0, 2000);
    if (intent.length < 3) {
      return { status: 422, code: "BAD_INTENT", message: "describe the job" };
    }
    const ready = await preflight({ boardId, agentId, skillSlug: "cards" });
    if (ready.status) return ready;
    if (budgetMissing(body?.budget)) {
      return {
        status: 422,
        code: "BUDGET_REQUIRED",
        message: "set a budget: a change set without one is not created",
      };
    }
    const budget = normalizeBudget(body?.budget ?? {}, agentLimitsFromEnv());
    const origin = originOf(body?.origin);
    let estimate;
    try {
      const ydoc = await store.roomDocument(boardId);
      estimate = estimateChangeSet({
        ydoc,
        operations,
        budget,
        agent: { id: ready.agent.id, name: ready.agent.name },
        taskId: "preview",
        origin,
      });
    } catch (error) {
      return {
        status: 422,
        code: error?.code ?? "CHANGE_SET_INVALID",
        message: error?.message ?? String(error),
      };
    }
    return { ready, budget, estimate, origin, intent };
  }

  async function enqueueChangeSet({ changeSet, prepared, createdBy }) {
    const task = await store.createAgentTask({
      orgId: changeSet.org_id,
      agentId: changeSet.agent_id,
      boardId: changeSet.board_id,
      mode: "write",
      capabilities: prepared.ready.decision.capabilities,
      intent: prepared.intent,
      input: {
        changeSetId: changeSet.id,
        origin: prepared.origin,
      },
      skillSlug: "change-set",
      skillVersion: 1,
      budget: prepared.budget,
      createdBy,
      changeSetId: changeSet.id,
    });
    return task;
  }

  if (parts[0] === "boards" && parts[2] === "agent-change-sets") {
    const boardId = parts[1];
    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      json(response, 200, {
        changeSets: await store.listBoardChangeSets(boardId, 20),
      });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(request);
      // Replay first: the same key returns the change set that was created, even if the
      // retry is missing a field (AG-11).
      const key = String(request.headers["idempotency-key"] ?? "").trim().slice(0, 100);
      if (key) {
        const existing = await store.findChangeSetByIdempotency(boardId, me.id, key);
        if (existing) {
          const changeSet = await store.getChangeSet(existing.id);
          json(response, 200, {
            changeSet,
            task: await store.getAgentTaskByChangeSet(existing.id),
            replayed: true,
          });
          return true;
        }
      }
      const prepared = await prepareChangeSet({ boardId, body });
      if (prepared.status) {
        fail(response, prepared.status, prepared.code, prepared.message);
        return true;
      }
      const preview = body?.preview === true;
      let changeSet;
      try {
        changeSet = await store.createChangeSet({
          orgId: board.org_id,
          boardId,
          agentId: prepared.ready.agent.id,
          operations: body.operations,
          estimate: prepared.estimate,
          status: preview ? "draft" : "queued",
          aclVersion: Number(board.acl_version ?? 1),
          createdBy: me.id,
          idempotencyKey: key || null,
          budget: prepared.budget,
          intent: prepared.intent,
          origin: prepared.origin,
        });
      } catch (error) {
        if (key && error?.code === "23505") {
          const existing = await store.findChangeSetByIdempotency(boardId, me.id, key);
          if (existing) {
            json(response, 200, {
              changeSet: await store.getChangeSet(existing.id),
              task: await store.getAgentTaskByChangeSet(existing.id),
              replayed: true,
            });
            return true;
          }
        }
        throw error;
      }
      await audit({
        orgId: board.org_id,
        boardId,
        action: "agent.change_set.create",
        subject: prepared.intent,
        agentId: prepared.ready.agent.id,
        skill: "cards",
        after: { changeSetId: changeSet.id, estimate: prepared.estimate, preview },
        actorType: "user",
      });
      let task = null;
      if (!preview) {
        try {
          task = await enqueueChangeSet({ changeSet, prepared, createdBy: me.id });
        } catch (error) {
          await store
            .finishChangeSet({
              id: changeSet.id,
              status: "failed",
              error: `queue failed: ${error.message}`,
            })
            .catch(() => {});
          throw error;
        }
        try {
          onTaskQueued?.();
        } catch (error) {
          log.error?.("[agents] could not wake the runner:", error.message);
        }
      }
      json(response, 201, { changeSet, task });
      return true;
    }
  }

  if (parts[0] === "change-sets" && parts[1]) {
    const changeSet = await store.getChangeSet(parts[1]);
    if (!changeSet) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    const allowed =
      changeSet.created_by === me.id ||
      changeSet.owner_id === me.id ||
      (await isOrgAdmin(changeSet.org_id));
    if (!allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    const task = await store.getAgentTaskByChangeSet(changeSet.id);

    if (method === "GET" && parts.length === 2) {
      json(response, 200, { changeSet, task });
      return true;
    }

    if (method === "POST" && parts[2] === "cancel") {
      if (task?.id) await store.cancelAgentTask(task.id);
      await store.cancelChangeSet(changeSet.id);
      await audit({
        orgId: changeSet.org_id,
        boardId: changeSet.board_id,
        action: "agent.change_set.cancel",
        subject: changeSet.id,
        agentId: changeSet.agent_id,
      });
      json(response, 200, { ok: true });
      return true;
    }

    if (method === "POST" && parts[2] === "execute") {
      if (changeSet.status !== "draft") {
        fail(response, 409, "NOT_DRAFT", "this change set is already queued");
        return true;
      }
      const body = {
        agentId: changeSet.agent_id,
        operations: changeSet.operations,
        budget: changeSet.budget ?? {},
        intent: changeSet.intent,
        origin: changeSet.origin ?? {},
      };
      const prepared = await prepareChangeSet({ boardId: changeSet.board_id, body });
      if (prepared.status) {
        fail(response, prepared.status, prepared.code, prepared.message);
        return true;
      }
      const queued = await store.queueChangeSet(changeSet.id);
      if (!queued) {
        fail(response, 409, "NOT_DRAFT", "this change set is already queued");
        return true;
      }
      const newTask = await enqueueChangeSet({
        changeSet: queued,
        prepared,
        createdBy: me.id,
      });
      await audit({
        orgId: changeSet.org_id,
        boardId: changeSet.board_id,
        action: "agent.change_set.execute",
        subject: changeSet.id,
        agentId: changeSet.agent_id,
        taskId: newTask.id,
      });
      try {
        onTaskQueued?.();
      } catch (error) {
        log.error?.("[agents] could not wake the runner:", error.message);
      }
      json(response, 202, { changeSet: queued, task: newTask });
      return true;
    }

    if (method === "POST" && parts[2] === "resume") {
      if (changeSet.status !== "failed" && changeSet.status !== "cancelled") {
        fail(response, 409, "NOT_RESUMABLE", "only a failed or cancelled change set can resume");
        return true;
      }
      const prepared = await prepareChangeSet({
        boardId: changeSet.board_id,
        body: {
          agentId: changeSet.agent_id,
          operations: changeSet.operations,
          budget: changeSet.budget ?? {},
          intent: changeSet.intent,
          origin: changeSet.origin ?? {},
        },
      });
      if (prepared.status) {
        fail(response, prepared.status, prepared.code, prepared.message);
        return true;
      }
      const queued = await store.queueChangeSet(changeSet.id);
      if (!queued) {
        fail(response, 409, "NOT_RESUMABLE", "this change set cannot resume");
        return true;
      }
      const newTask = await enqueueChangeSet({
        changeSet: queued,
        prepared,
        createdBy: me.id,
      });
      await audit({
        orgId: changeSet.org_id,
        boardId: changeSet.board_id,
        action: "agent.change_set.resume",
        subject: changeSet.id,
        agentId: changeSet.agent_id,
        taskId: newTask.id,
      });
      try {
        onTaskQueued?.();
      } catch (error) {
        log.error?.("[agents] could not wake the runner:", error.message);
      }
      json(response, 202, { changeSet: queued, task: newTask });
      return true;
    }
  }

  return false;
}
