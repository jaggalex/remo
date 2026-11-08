/**
 * The room agent (ADR-189): assignment, shared threads and the immediate draft.
 *
 * This file is the HTTP skin. The authority lives in `createRoomTask`; the write lives in
 * the runner. Keeping the routes thin makes the same decision usable from the panel and,
 * later, from an integration without a second permission path.
 */
import { fail, json, readBody } from "./iam-api.mjs";
import { fakeModelEnabled } from "./ai-fake.mjs";

export async function handleRoomAgentRoutes(ctx) {
  const {
    request,
    response,
    parts,
    method,
    store,
    me,
    audit,
    boardAndAccess,
    createRoomTask,
    membership,
  } = ctx;

  /** History belongs to the organisation, not to a public link or a guest (ADR-189). */
  async function mayReadHistory(board) {
    if (!board?.org_id) return false;
    const seat = await membership(board.org_id);
    return Boolean(seat && seat.state === "active" && seat.relation === "member");
  }

  /* ------------------------------------------------ assignment on a room -- */

  if (parts[0] === "boards" && parts[2] === "agent") {
    const boardId = parts[1];
    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }

    if (method === "GET") {
      const policy = await store.getOrgPolicy(board.org_id);
      const assigned = typeof store.getBoardAgent === "function"
        ? await store.getBoardAgent(boardId)
        : null;
      const agents = (await store.listAgents(board.org_id)).filter(
        (agent) => agent.owner_id === me.id && agent.state === "active",
      );
      const recent = typeof store.listAgentThreads === "function"
        ? (await store.listAgentThreads(boardId, 1))[0]
        : null;
      json(response, 200, {
        assigned: assigned
          ? {
              agentId: assigned.agent_id,
              name: assigned.agent_name,
              enabled: assigned.enabled,
            }
          : null,
        canAssign: board.owner_id === me.id && board.visibility !== "link",
        publicLink: board.visibility === "link",
        orgEnabled: policy.agentsEnabled === true,
        boardEnabled: board.agents_enabled === true,
        owner: board.owner_id === me.id,
        status: recent?.last_status ?? null,
        demo: fakeModelEnabled(),
        agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
      });
      return true;
    }

    if (method === "PUT") {
      if (!access.capabilities.includes("board.manage") || board.owner_id !== me.id) {
        fail(response, 403, "FORBIDDEN", "only the room owner can assign an agent");
        return true;
      }
      if (board.visibility === "link") {
        fail(response, 409, "PUBLIC_LINK_ON", "turn off the public link first");
        return true;
      }
      const body = await readBody(request);
      const agentId = body?.agentId ? String(body.agentId) : "";
      if (!agentId) {
        if (typeof store.releaseBoardAgent === "function") {
          await store.releaseBoardAgent(boardId, "agent unassigned");
        } else {
          await store.clearBoardAgent(boardId);
        }
        await audit({
          orgId: board.org_id,
          boardId,
          action: "board.agent.assign",
          subject: "off",
          actorType: "user",
        });
        json(response, 200, { assigned: null });
        return true;
      }
      const agent = await store.getAgent(agentId);
      if (!agent || agent.org_id !== board.org_id) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "agent not found");
        return true;
      }
      if (agent.owner_id !== me.id || agent.state !== "active") {
        fail(response, 403, "FORBIDDEN", "choose an active agent of your own");
        return true;
      }
      const policy = await store.getOrgPolicy(board.org_id);
      if (policy.agentsEnabled !== true) {
        fail(response, 403, "AGENTS_DISABLED_ORG", "agents are disabled in this organisation");
        return true;
      }
      await store.setBoardAgent({
        boardId,
        orgId: board.org_id,
        agentId,
        assignedBy: me.id,
      });
      // Assigning is the owner's explicit act, so it also opens the board switch the
      // existing agent surface uses. The organisation switch stays the outer kill.
      if (typeof store.setBoardAgentsEnabled === "function") {
        await store.setBoardAgentsEnabled(boardId, true);
      }
      await audit({
        orgId: board.org_id,
        boardId,
        action: "board.agent.assign",
        subject: agentId,
        agentId,
        actorType: "user",
      });
      json(response, 200, { assigned: { agentId, name: agent.name, enabled: true } });
      return true;
    }
  }

  /* ------------------------------------------------------- shared threads -- */

  if (parts[0] === "boards" && parts[2] === "agent-threads") {
    const boardId = parts[1];
    const { board, access } = await boardAndAccess(boardId);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (!(await mayReadHistory(board))) {
      fail(response, 403, "HISTORY_FORBIDDEN", "task history belongs to the organisation");
      return true;
    }
    if (method === "DELETE") {
      if (board.owner_id !== me.id) {
        fail(response, 403, "FORBIDDEN", "only the room owner can clear the history");
        return true;
      }
      const deleted = typeof store.deleteBoardAgentThreads === "function"
        ? await store.deleteBoardAgentThreads(boardId)
        : 0;
      await audit({
        orgId: board.org_id,
        boardId,
        action: "agent.thread.clear",
        subject: "all",
        after: { threads: deleted },
        actorType: "user",
      });
      json(response, 200, { deleted });
      return true;
    }
    if (method === "GET") {
      json(response, 200, {
        threads: typeof store.listAgentThreads === "function"
          ? await store.listAgentThreads(boardId)
          : [],
      });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(request);
      const result = await createRoomTask({ boardId, body });
      if (result.status >= 400) {
        fail(response, result.status, result.code, result.message);
        return true;
      }
      json(response, 202, { thread: result.thread, task: result.task });
      return true;
    }
  }

  if (parts[0] === "agent-threads" && Boolean(parts[1])) {
    const threadId = parts[1];
    const thread = typeof store.getAgentThread === "function"
      ? await store.getAgentThread(threadId)
      : null;
    if (!thread) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    const { board, access } = await boardAndAccess(thread.board_id);
    if (!board || !access?.allowed) {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    if (!(await mayReadHistory(board))) {
      fail(response, 403, "HISTORY_FORBIDDEN", "task history belongs to the organisation");
      return true;
    }

    if (method === "DELETE" && parts.length === 2) {
      if (board.owner_id !== me.id) {
        fail(response, 403, "FORBIDDEN", "only the room owner can delete a conversation");
        return true;
      }
      const deleted = typeof store.deleteAgentThread === "function"
        ? await store.deleteAgentThread(threadId)
        : null;
      if (!deleted) {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
        return true;
      }
      await audit({
        orgId: board.org_id,
        boardId: thread.board_id,
        action: "agent.thread.delete",
        subject: String(thread.title ?? "").slice(0, 200),
        actorType: "user",
      });
      json(response, 200, { deleted: true });
      return true;
    }
    if (method === "GET" && parts.length === 2) {
      json(response, 200, {
        thread,
        messages: await store.listAgentThreadMessages(threadId),
      });
      return true;
    }

    if (method === "POST" && parts[2] === "messages") {
      const body = await readBody(request);
      const result = await createRoomTask({
        boardId: thread.board_id,
        body: { ...body, threadId },
      });
      if (result.status >= 400) {
        fail(response, result.status, result.code, result.message);
        return true;
      }
      json(response, 202, { thread: result.thread, task: result.task });
      return true;
    }
  }

  return false;
}
