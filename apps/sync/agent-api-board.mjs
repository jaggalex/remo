/**
 * Board routes (agents, tasks, schedules) and the single-agent routes that own them.
 */
import { fail, json, readBody } from "./iam-api.mjs";
import { hashToken, newToken } from "./iam.mjs";
import { aiEntryRefusal } from "./agents.mjs";
import { MAX_TOKENS_PER_AGENT, integer, operatorView } from "./agent-api-shared.mjs";
import { relayoutTidyTask } from "./agent-tidy-runner.mjs";
import { readSelectionInput } from "./selection-source.mjs";

export async function handleBoardRoutes(ctx) {
  const { request, response, parts, method, store, me, audit, isOrgAdmin, boardAndAccess, createTask, createSchedule } = ctx;

  if (parts[0] === "boards" && parts[2] === "agents") {
    const boardId = parts[1];
    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      const policy = await store.getOrgPolicy(board.org_id);
      const agents = await store.listAgents(board.org_id);
      // Task intents are the author's words, not board content: only somebody who can
      // edit this board may read the history (a viewer still sees the board switches).
      const history = access.capabilities.includes("board.edit");
      json(response, 200, {
        enabled: board.agents_enabled === true,
        orgEnabled: policy.agentsEnabled,
        agents: agents.filter(
          (agent) => agent.owner_id === me.id && agent.state === "active",
        ),
        tasks: history ? await store.listBoardAgentTasks(boardId, 20) : [],
        schedules: history ? await store.listBoardAgentSchedules(boardId) : [],
        skills: await store.listAgentSkills(board.org_id),
      });
      return true;
    }
    if (method === "PUT") {
      if (!access.capabilities.includes("board.manage")) {
        fail(response, 403, "FORBIDDEN", "only an owner or co-owner can change this");
        return true;
      }
      const body = await readBody(request);
      const enabled = body?.enabled === true;
      await store.setBoardAgentsEnabled(boardId, enabled);
      if (!enabled) await store.cancelQueuedAgentTasksForBoard(boardId);
      await audit({
        orgId: board.org_id,
        boardId,
        action: "board.agents.update",
        subject: enabled ? "on" : "off",
      });
      json(response, 200, { enabled });
      return true;
    }
  }

  if (parts[0] === "boards" && parts[2] === "agent-tasks") {
    const boardId = parts[1];
    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      json(response, 200, {
        tasks: access.capabilities.includes("board.edit")
          ? await store.listBoardAgentTasks(boardId, 20)
          : [],
      });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(request);
      const result = await createTask({ boardId, body });
      if (result.status >= 400) {
        fail(response, result.status, result.code, result.message);
        return true;
      }
      json(response, result.replayed ? 200 : 202, {
        task: result.task,
        ...(result.replayed ? { replayed: true } : {}),
      });
      return true;
    }
  }

  if (parts[0] === "boards" && parts[2] === "agent-schedules") {
    const boardId = parts[1];
    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      json(response, 200, {
        schedules: access.capabilities.includes("board.edit")
          ? await store.listBoardAgentSchedules(boardId)
          : [],
      });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(request);
      const result = await createSchedule({ boardId, body });
      if (result.status >= 400) {
        fail(response, result.status, result.code, result.message);
        return true;
      }
      json(response, 201, { schedule: result.schedule });
      return true;
    }
  }

  if (parts[0] === "agent-tasks" && parts[1]) {
    const task = await store.getAgentTask(parts[1]);
    if (!task) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }

    /* ---------------------------------------------------------- plan routes --- */

    if (parts[2] === "plan") {
      // A plan is board content that leads to board writes. Approval therefore needs
      // the same account and the same `board.edit` as applying it: a public-link
      // visitor or a reader gets a refusal that says which one they are (ADR-142).
      const { board, access } = await boardAndAccess(task.board_id);
      if (!board || !access?.allowed) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
        return true;
      }
      const entry = aiEntryRefusal(access);
      if (entry === "ACCOUNT_REQUIRED") {
        fail(
          response,
          403,
          "ACCOUNT_REQUIRED",
          "AI works for an account: a public link is view-only",
        );
        return true;
      }
      if (!access.capabilities.includes("board.edit")) {
        fail(response, 403, "FORBIDDEN", "you cannot edit this board");
        return true;
      }

      if (method === "GET" && parts.length === 3) {
        const plan = await store.getAgentTaskPlan(task.id);
        if (!plan) {
          fail(
            response,
            404,
            "PLAN_NOT_READY",
            "this task has not proposed a plan yet; run it first",
          );
          return true;
        }
        const inputs =
          typeof store.listAgentTaskInputs === "function"
            ? await store.listAgentTaskInputs(task.id)
            : [];
        const file = inputs.find((input) => input.source === "file") ?? null;
        const selectionRow = inputs.find((input) => input.source === "selection") ?? null;
        const selection = readSelectionInput(selectionRow);
        const result = task.result && typeof task.result === "object" ? task.result : {};
        json(response, 200, {
          task: { id: task.id, status: task.status, intent: task.intent, skillSlug: task.skill_slug },
          plan: plan.plan,
          estimate: plan.estimate,
          status: plan.status,
          planId: plan.id,
          proposedAt: plan.proposed_at,
          approvedAt: plan.approved_at,
          appliedAt: plan.applied_at,
          rejectedAt: plan.rejected_at,
          rejectionReason: plan.rejection_reason,
          // Provenance for the objects the client will create: the board record says
          // which agent proposed the plan, not only that a person applied it.
          agent: { id: task.agent_id, name: task.agent_name ?? "Agent" },
          file: file
            ? {
                name: file.name,
                kind: file.kind,
                chars: file.chars,
                truncated: file.truncated,
                ...(file.truncation_code ? { truncationCode: file.truncation_code } : {}),
              }
            : null,
          // The selection is source: the preview names what was read, and a tidy plan
          // knows which ids it may move (ADR-143).
          selection: selection
            ? {
                ids: Array.isArray(selection.allowedIds)
                  ? selection.allowedIds.map(String)
                  : Array.isArray(task.input?.selectionIds)
                    ? task.input.selectionIds.map(String)
                    : [],
                counts: selection.counts ?? null,
                truncated: selection.truncated === true,
              }
            : null,
          ...(task.skill_slug === "tidy-selection"
            ? {
                strategy: result.strategy ?? task.input?.strategy ?? null,
                requestedStrategy: result.requestedStrategy ?? task.input?.strategy ?? null,
                classification: result.classification ?? null,
              }
            : {}),
        });
        return true;
      }

      if (method === "POST" && parts.length === 4 && parts[3] === "relayout") {
        if (task.skill_slug !== "tidy-selection") {
          fail(
            response,
            409,
            "TIDY_ONLY",
            "only a tidy plan can change its strategy; ask the agent for a new plan",
          );
          return true;
        }
        const body = await readBody(request);
        const current = await store.getAgentTaskPlan(task.id);
        if (!current) {
          fail(
            response,
            404,
            "PLAN_NOT_READY",
            "this task has not proposed a plan yet; run it first",
          );
          return true;
        }
        if (current.status !== "proposed") {
          fail(
            response,
            409,
            "PLAN_ALREADY_APPROVED",
            "this plan is already approved; switching the strategy would apply something nobody read",
          );
          return true;
        }

        // The classification is kept; only the geometry is recomputed for the strategy
        // the person picked. This writes no object and calls no model (ADR-143).
        let laidOut;
        try {
          laidOut = await relayoutTidyTask({
            store,
            task,
            strategy: body?.strategy,
          });
        } catch (error) {
          fail(
            response,
            422,
            error?.code ?? "TIDY_FAILED",
            error?.message ?? "this strategy cannot be laid out",
          );
          return true;
        }

        const nextResult = {
          ...(task.result && typeof task.result === "object" ? task.result : {}),
          strategy: laidOut.strategy,
          requestedStrategy: laidOut.requestedStrategy,
          warnings: laidOut.warnings,
          counts: laidOut.plan.counts,
          estimate: laidOut.estimate,
        };
        const stored = await store.createAgentPlan({
          taskId: task.id,
          orgId: task.org_id,
          boardId: task.board_id,
          agentId: task.agent_id,
          plan: laidOut.plan,
          estimate: laidOut.estimate,
          skillSlug: current.skill_slug ?? "tidy-selection",
          skillVersion: current.skill_version ?? 1,
          model: current.model ?? null,
        });
        if (!stored) {
          fail(response, 503, "PLAN_STORE_FAILED", "the plan could not be updated");
          return true;
        }
        if (stored.status !== "proposed") {
          // Another tab approved while this strategy was being recomputed. The plan a
          // person read must not change under an approval (ADR-143).
          fail(
            response,
            409,
            "PLAN_ALREADY_APPROVED",
            "this plan is already approved; switching the strategy would apply something nobody read",
          );
          return true;
        }
        if (typeof store.updateAgentTaskResult === "function") {
          await store.updateAgentTaskResult({ id: task.id, result: nextResult });
        }
        await audit({
          orgId: task.org_id,
          boardId: task.board_id,
          action: "agent.plan.relayout",
          subject: stored.id,
          agentId: task.agent_id,
          taskId: task.id,
          skill: stored.skill_slug ?? "tidy-selection",
          actorType: "user",
          after: {
            strategy: laidOut.strategy,
            placements: laidOut.plan.counts.placements,
            objects: laidOut.plan.counts.objects,
          },
        });
        json(response, 200, {
          plan: laidOut.plan,
          estimate: laidOut.estimate,
          status: stored.status,
          planId: stored.id,
          strategy: laidOut.strategy,
          requestedStrategy: laidOut.requestedStrategy,
          replayed: false,
        });
        return true;
      }

      if (method === "POST" && parts.length === 4 && parts[3] === "approve") {
        const current = await store.getAgentTaskPlan(task.id);
        if (!current) {
          fail(
            response,
            404,
            "PLAN_NOT_READY",
            "this task has not proposed a plan yet; run it first",
          );
          return true;
        }
        if (current.status === "rejected") {
          fail(
            response,
            409,
            "PLAN_REJECTED",
            "this plan was rejected; ask the agent for a new one",
          );
          return true;
        }
        if (current.status === "approved" || current.status === "applied") {
          json(response, 200, {
            plan: current.plan,
            estimate: current.estimate,
            status: current.status,
            planId: current.id,
            approvedAt: current.approved_at,
            appliedAt: current.applied_at,
            replayed: true,
          });
          return true;
        }

        // The update is conditional on `proposed`, so two approvals racing produce one
        // audit line and both callers receive the same plan.
        const approved = await store.approveAgentPlan({ taskId: task.id, userId: me.id });
        if (!approved.plan) {
          fail(response, 404, "PLAN_NOT_READY", "the plan disappeared");
          return true;
        }
        if (approved.transitioned) {
          await audit({
            orgId: task.org_id,
            boardId: task.board_id,
            action: "agent.plan.approved",
            subject: approved.plan.id,
            agentId: task.agent_id,
            taskId: task.id,
            skill: approved.plan.skill_slug,
            actorType: "user",
            after: {
              objects: approved.plan.plan?.counts?.objects ?? null,
              connectors: approved.plan.plan?.counts?.connectors ?? null,
              status: "approved",
            },
          });
        }
        json(response, 200, {
          plan: approved.plan.plan,
          estimate: approved.plan.estimate,
          status: approved.plan.status,
          planId: approved.plan.id,
          approvedAt: approved.plan.approved_at,
          replayed: !approved.transitioned,
        });
        return true;
      }

      if (method === "POST" && parts.length === 4 && parts[3] === "applied") {
        const current = await store.getAgentTaskPlan(task.id);
        if (!current) {
          fail(
            response,
            404,
            "PLAN_NOT_READY",
            "this task has not proposed a plan yet; run it first",
          );
          return true;
        }
        if (current.status === "proposed" || current.status === "rejected") {
          fail(
            response,
            409,
            "PLAN_NOT_APPROVED",
            "approve the plan before reporting that the client applied it",
          );
          return true;
        }
        if (current.status === "applied") {
          json(response, 200, {
            status: "applied",
            planId: current.id,
            appliedAt: current.applied_at,
            replayed: true,
          });
          return true;
        }

        // The client has written the objects in one local transaction. This route only
        // records that fact: the server still has no authoring writer (ADR-142).
        const applied = await store.markAgentPlanApplied({ taskId: task.id });
        if (!applied.plan) {
          fail(response, 404, "PLAN_NOT_READY", "the plan disappeared");
          return true;
        }
        if (applied.transitioned) {
          await audit({
            orgId: task.org_id,
            boardId: task.board_id,
            action: "agent.plan.applied",
            subject: applied.plan.id,
            agentId: task.agent_id,
            taskId: task.id,
            skill: applied.plan.skill_slug,
            actorType: "user",
            after: {
              objects: applied.plan.plan?.counts?.objects ?? null,
              connectors: applied.plan.plan?.counts?.connectors ?? null,
              status: "applied",
            },
          });
        }
        json(response, 200, {
          status: "applied",
          planId: applied.plan.id,
          appliedAt: applied.plan.applied_at,
          replayed: !applied.transitioned,
        });
        return true;
      }

      if (method === "POST" && parts.length === 4 && parts[3] === "reject") {
        const body = await readBody(request);
        const reason = String(body?.reason ?? "").trim().slice(0, 500) || null;
        const current = await store.getAgentTaskPlan(task.id);
        if (!current) {
          fail(
            response,
            404,
            "PLAN_NOT_READY",
            "this task has not proposed a plan yet; run it first",
          );
          return true;
        }
        if (current.status === "rejected") {
          json(response, 200, {
            status: "rejected",
            planId: current.id,
            rejectedAt: current.rejected_at,
            rejectionReason: current.rejection_reason,
            replayed: true,
          });
          return true;
        }
        if (current.status === "approved" || current.status === "applied") {
          fail(
            response,
            409,
            "PLAN_ALREADY_APPROVED",
            "this plan is already approved; cancel the task instead",
          );
          return true;
        }
        const rejected = await store.rejectAgentPlan({
          taskId: task.id,
          userId: me.id,
          reason,
        });
        if (!rejected.plan) {
          fail(response, 404, "PLAN_NOT_READY", "the plan disappeared");
          return true;
        }
        if (rejected.transitioned) {
          await audit({
            orgId: task.org_id,
            boardId: task.board_id,
            action: "agent.plan.rejected",
            subject: rejected.plan.id,
            agentId: task.agent_id,
            taskId: task.id,
            skill: rejected.plan.skill_slug,
            actorType: "user",
            reason,
            after: { status: "rejected" },
          });
        }
        json(response, 200, {
          status: "rejected",
          planId: rejected.plan.id,
          rejectedAt: rejected.plan.rejected_at,
          rejectionReason: rejected.plan.rejection_reason,
          replayed: !rejected.transitioned,
        });
        return true;
      }

      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }

    const { access: boardAccess } = await boardAndAccess(task.board_id);
    const onBoard = Boolean(boardAccess?.allowed);
    const mine = task.created_by === me.id || task.owner_id === me.id;
    if (!(onBoard && mine) && !(await isOrgAdmin(task.org_id))) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (method === "GET") {
      json(response, 200, { task: onBoard ? task : operatorView(task) });
      return true;
    }
    if (method === "POST" && parts[2] === "cancel") {
      const cancelled = await store.cancelAgentTask(task.id);
      if (!cancelled) {
        fail(response, 409, "TASK_NOT_ACTIVE", "this task already finished");
        return true;
      }
      await audit({
        orgId: task.org_id,
        boardId: task.board_id,
        action: "agent.task.cancel",
        subject: task.id,
        agentId: task.agent_id,
        taskId: task.id,
        actorType: "user",
      });
      json(response, 200, { ok: true });
      return true;
    }
  }

  if (parts[0] === "agent-schedules" && parts[1] && method === "DELETE") {
    const schedule = await store.getAgentSchedule(parts[1]);
    if (!schedule) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    const allowed =
      schedule.created_by === me.id ||
      schedule.owner_id === me.id ||
      (await isOrgAdmin(schedule.org_id));
    if (!allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    await store.deleteAgentSchedule(schedule.id);
    await audit({
      orgId: schedule.org_id,
      boardId: schedule.board_id,
      action: "agent.schedule.delete",
      subject: schedule.id,
      agentId: schedule.agent_id,
    });
    json(response, 200, { ok: true });
    return true;
  }

  /* ------------------------------------------------------- single agent --- */

  if (parts[0] === "agents" && parts[1]) {
    const agent = await store.getAgent(parts[1]);
    if (!agent) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    const owner = agent.owner_id === me.id;
    const admin = await isOrgAdmin(agent.org_id);
    if (!owner && !admin) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }

    if (method === "PATCH" && parts.length === 2) {
      const body = await readBody(request);
      const name =
        body?.name === undefined ? undefined : String(body.name).trim().slice(0, 60);
      if (name !== undefined && !name) {
        fail(response, 422, "NAME_REQUIRED", "the name cannot be empty");
        return true;
      }
      const state =
        body?.state === "active" || body?.state === "disabled" ? body.state : undefined;
      if (Object.prototype.hasOwnProperty.call(body ?? {}, "credentialId")) {
        const credentialId = body.credentialId ? String(body.credentialId) : null;
        if (credentialId) {
          const row = await store.getAiCredential(credentialId);
          const allowed =
            row &&
            ((row.scope === "user" && row.scope_id === agent.owner_id) ||
              (row.scope === "org" && row.scope_id === agent.org_id));
          if (!allowed) {
            fail(response, 422, "BAD_CREDENTIAL", "choose a key that belongs to the owner or this organisation");
            return true;
          }
        }
        await store.setAgentCredential({
          id: agent.id,
          credentialId,
          model:
            body.model === undefined
              ? agent.model
              : body.model
                ? String(body.model).trim().slice(0, 120)
                : null,
        });
      }
      const updated = await store.updateAgent({ id: agent.id, name, state });
      if (state === "disabled") await store.cancelQueuedAgentTasksForAgent(agent.id);
      await audit({
        orgId: agent.org_id,
        action: "agent.update",
        subject: updated.name,
        agentId: agent.id,
        after: { state: updated.state },
      });
      json(response, 200, { agent: updated });
      return true;
    }

    if (parts[2] === "tokens" && parts.length === 3) {
      if (!owner) {
        fail(response, 403, "FORBIDDEN", "only the owner can manage tokens");
        return true;
      }
      if (method === "GET") {
        json(response, 200, { tokens: await store.listAgentTokens(agent.id) });
        return true;
      }
      if (method === "POST") {
        const active = (await store.listAgentTokens(agent.id)).filter(
          (token) => !token.revoked_at && new Date(token.expires_at).getTime() > Date.now(),
        );
        if (active.length >= MAX_TOKENS_PER_AGENT) {
          fail(response, 429, "TOO_MANY_TOKENS", "revoke an old key first");
          return true;
        }
        const body = await readBody(request);
        const days = integer(body?.expiresInDays, 1, 365, 30);
        const secret = `remo_agent_${newToken(24)}`;
        const token = await store.createAgentToken({
          agentId: agent.id,
          tokenHash: hashToken(secret),
          label: String(body?.label ?? "").slice(0, 60),
          expiresAt: new Date(Date.now() + days * 86_400_000),
          createdBy: me.id,
        });
        await audit({
          orgId: agent.org_id,
          action: "agent.token.create",
          subject: token.label || token.id,
          agentId: agent.id,
        });
        json(response, 201, { secret, token });
        return true;
      }
    }

    if (parts[2] === "tokens" && parts[3] && method === "DELETE") {
      if (!owner) {
        fail(response, 403, "FORBIDDEN", "only the owner can manage tokens");
        return true;
      }
      const revoked = await store.revokeAgentToken(agent.id, parts[3]);
      if (!revoked) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
        return true;
      }
      await audit({
        orgId: agent.org_id,
        action: "agent.token.revoke",
        subject: parts[3],
        agentId: agent.id,
      });
      json(response, 200, { ok: true });
      return true;
    }
  }

  return false;
}
