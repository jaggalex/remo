/**
 * Bearer routes: what an agent token itself may do (identity, tasks, boards, skills, a
 * cards change set). A cookie is never accepted here.
 */
import { agentLimitsFromEnv } from "./agent-context.mjs";
import { agentEffective, normalizeBudget } from "./agents.mjs";
import { estimateChangeSet } from "./change-set.mjs";
import { fail, json, readBody } from "./iam-api.mjs";
import { effective, hashToken } from "./iam.mjs";
import { originOf } from "./agent-api-shared.mjs";

export async function handleBearer(ctx) {
  const { request, response, parts, method, store, log, onTaskQueued } = ctx;

  if (parts[0] === "agent") {
    const header = String(request.headers.authorization ?? "");
    const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const token = secret ? await store.findAgentByToken(hashToken(secret)) : null;
    if (!token) {
      fail(response, 401, "AGENT_AUTH_REQUIRED", "present an agent token");
      return true;
    }
    await store.touchAgentToken(token.token_id).catch(() => {});
    const auditAgent = (event) =>
      store.recordAudit({ actorType: "agent", ...event }).catch((error) => {
        log.error?.("[agents] audit failed:", error.message);
      });

    if (parts[1] === "me" && parts.length === 2 && method === "GET") {
      json(response, 200, {
        agent: {
          id: token.agent_id,
          name: token.agent_name,
          state: token.state,
          orgId: token.org_id,
          owner: { id: token.owner_id, name: token.owner_name, email: token.owner_email },
        },
      });
      return true;
    }
    if (parts[1] === "tasks" && parts.length === 2 && method === "GET") {
      json(response, 200, {
        tasks: await store.listAgentTasksForAgent(token.agent_id, 20),
      });
      return true;
    }

    if (parts[1] === "boards" && parts.length === 2 && method === "GET") {
      const readable = await store.listReadableBoards(token.owner_id);
      const boards = [];
      for (const board of readable) {
        const iam = await store.getIamBoard(board.id);
        if (!iam || iam.owner_id == null || iam.org_id !== token.org_id) continue;
        boards.push({
          id: board.id,
          title: board.title,
          updatedAt: board.updated_at,
          agentsEnabled: iam.agents_enabled === true,
        });
      }
      json(response, 200, { boards });
      return true;
    }

    if (parts[1] === "skills" && parts.length === 2 && method === "GET") {
      json(response, 200, { skills: await store.listAgentSkills(token.org_id) });
      return true;
    }

    if (parts[1] === "change-sets" && parts.length === 2 && method === "POST") {
      const body = await readBody(request);
      const boardId = String(body?.boardId ?? "");
      const board = boardId ? await store.getIamBoard(boardId) : null;
      if (!board || board.owner_id == null || board.org_id !== token.org_id) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "board not found");
        return true;
      }
      const agent = await store.getAgent(token.agent_id);
      const facts = await store.accessFacts(boardId, token.owner_id);
      const ownerAccess = facts
        ? effective({
            board: facts.board,
            viewer: facts.viewer,
            grants: facts.grants,
            policy: facts.policy,
          })
        : { allowed: false, reason: "NOT_FOUND", capabilities: [], sources: [] };
      const policy = await store.getOrgPolicy(token.org_id);
      const decision = agentEffective({
        agent,
        ownerAccess,
        board: { ...board, agentsEnabled: board.agents_enabled === true },
        policy,
        task: {
          id: "agent-preflight",
          status: "queued",
          mode: "write",
          capabilities: ["board.read", "board.edit"],
        },
      });
      if (!decision.allowed) {
        fail(response, 403, "AGENT_DENIED", decision.reason);
        return true;
      }
      const skill = await store.getAgentSkillBySlug(token.org_id, "cards");
      if (!skill || !["builtin:cards"].includes(skill.handler)) {
        fail(response, 422, "SKILL_UNAVAILABLE", "the cards skill is not published");
        return true;
      }
      const operations = body?.operations;
      if (!Array.isArray(operations) || !operations.length) {
        fail(response, 422, "BAD_OPERATIONS", "provide at least one operation");
        return true;
      }
      const intent = String(body?.intent ?? "Cards from a selection").trim().slice(0, 2000);
      if (intent.length < 3) {
        fail(response, 422, "BAD_INTENT", "describe the job");
        return true;
      }
      const budget = normalizeBudget(body?.budget ?? {}, agentLimitsFromEnv());
      const origin = originOf(body?.origin);
      let estimate;
      try {
        estimate = estimateChangeSet({
          ydoc: await store.roomDocument(boardId),
          operations,
          budget,
          agent: { id: agent.id, name: agent.name },
          taskId: "preview",
          origin,
        });
      } catch (error) {
        fail(response, 422, error?.code ?? "CHANGE_SET_INVALID", error?.message ?? String(error));
        return true;
      }
      const key = String(request.headers["idempotency-key"] ?? "").trim().slice(0, 100);
      if (key) {
        const existing = await store.findChangeSetByIdempotency(boardId, token.owner_id, key);
        if (existing) {
          json(response, 200, {
            changeSet: await store.getChangeSet(existing.id),
            task: await store.getAgentTaskByChangeSet(existing.id),
            replayed: true,
          });
          return true;
        }
      }
      const preview = body?.preview === true;
      const changeSet = await store.createChangeSet({
        orgId: token.org_id,
        boardId,
        agentId: token.agent_id,
        operations,
        estimate,
        status: preview ? "draft" : "queued",
        aclVersion: Number(board.acl_version ?? 1),
        createdBy: token.owner_id,
        idempotencyKey: key || null,
        budget,
        intent,
        origin,
      });
      let task = null;
      if (!preview) {
        task = await store.createAgentTask({
          orgId: token.org_id,
          agentId: token.agent_id,
          boardId,
          mode: "write",
          capabilities: decision.capabilities,
          intent,
          input: { changeSetId: changeSet.id, origin },
          skillSlug: "change-set",
          skillVersion: 1,
          budget,
          createdBy: token.owner_id,
          changeSetId: changeSet.id,
        });
        try {
          onTaskQueued?.();
        } catch (error) {
          log.error?.("[agents] could not wake the runner:", error.message);
        }
      }
      await auditAgent({
        actorId: token.owner_id,
        orgId: token.org_id,
        boardId,
        action: "agent.change_set.create",
        subject: intent,
        agentId: token.agent_id,
        taskId: task?.id ?? null,
        skill: "cards",
        actorType: "agent",
        after: { changeSetId: changeSet.id, estimate, preview },
      });
      json(response, 201, { changeSet, task });
      return true;
    }

    if (parts[1] === "change-sets" && parts[2]) {
      const changeSet = await store.getChangeSet(parts[2]);
      if (!changeSet || changeSet.agent_id !== token.agent_id) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
        return true;
      }
      if (method === "GET" && parts.length === 3) {
        json(response, 200, {
          changeSet,
          task: await store.getAgentTaskByChangeSet(changeSet.id),
        });
        return true;
      }
      if (method === "POST" && parts[3] === "cancel") {
        const task = await store.getAgentTaskByChangeSet(changeSet.id);
        if (task?.id) await store.cancelAgentTask(task.id);
        await store.cancelChangeSet(changeSet.id);
        await auditAgent({
          actorId: token.owner_id,
          orgId: token.org_id,
          boardId: changeSet.board_id,
          action: "agent.change_set.cancel",
          subject: changeSet.id,
          agentId: token.agent_id,
          actorType: "agent",
        });
        json(response, 200, { ok: true });
        return true;
      }
      if (method === "POST" && (parts[3] === "execute" || parts[3] === "resume")) {
        const resuming = parts[3] === "resume";
        if (resuming && changeSet.status !== "failed" && changeSet.status !== "cancelled") {
          fail(response, 409, "NOT_RESUMABLE", "only a failed or cancelled change set can resume");
          return true;
        }
        if (!resuming && changeSet.status !== "draft") {
          fail(response, 409, "NOT_DRAFT", "this change set is already queued");
          return true;
        }
        const agent = await store.getAgent(token.agent_id);
        const board = await store.getIamBoard(changeSet.board_id);
        const facts = await store.accessFacts(changeSet.board_id, token.owner_id);
        const ownerAccess = facts
          ? effective({
              board: facts.board,
              viewer: facts.viewer,
              grants: facts.grants,
              policy: facts.policy,
            })
          : { allowed: false, reason: "NOT_FOUND", capabilities: [], sources: [] };
        const policy = await store.getOrgPolicy(token.org_id);
        const decision = agentEffective({
          agent,
          ownerAccess,
          board: board ? { ...board, agentsEnabled: board.agents_enabled === true } : null,
          policy,
          task: {
            id: "agent-preflight",
            status: "queued",
            mode: "write",
            capabilities: ["board.read", "board.edit"],
          },
        });
        if (!decision.allowed) {
          fail(response, 403, "AGENT_DENIED", decision.reason);
          return true;
        }
        const budget = normalizeBudget(changeSet.budget ?? {}, agentLimitsFromEnv());
        try {
          estimateChangeSet({
            ydoc: await store.roomDocument(changeSet.board_id),
            operations: changeSet.operations,
            budget,
            agent: { id: agent.id, name: agent.name },
            taskId: "preview",
            origin: changeSet.origin ?? {},
          });
        } catch (error) {
          fail(response, 422, error?.code ?? "CHANGE_SET_INVALID", error?.message ?? String(error));
          return true;
        }
        const queued = await store.queueChangeSet(changeSet.id);
        if (!queued) {
          fail(response, 409, resuming ? "NOT_RESUMABLE" : "NOT_DRAFT", "the change set moved");
          return true;
        }
        const task = await store.createAgentTask({
          orgId: token.org_id,
          agentId: token.agent_id,
          boardId: changeSet.board_id,
          mode: "write",
          capabilities: decision.capabilities,
          intent: changeSet.intent || "Cards from a selection",
          input: { changeSetId: changeSet.id, origin: changeSet.origin ?? {} },
          skillSlug: "change-set",
          skillVersion: 1,
          budget,
          createdBy: token.owner_id,
          changeSetId: changeSet.id,
        });
        await auditAgent({
          actorId: token.owner_id,
          orgId: token.org_id,
          boardId: changeSet.board_id,
          action: resuming ? "agent.change_set.resume" : "agent.change_set.execute",
          subject: changeSet.id,
          agentId: token.agent_id,
          taskId: task.id,
          actorType: "agent",
        });
        try {
          onTaskQueued?.();
        } catch (error) {
          log.error?.("[agents] could not wake the runner:", error.message);
        }
        json(response, 202, { changeSet: queued, task });
        return true;
      }
    }

    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }

  return false;
}
