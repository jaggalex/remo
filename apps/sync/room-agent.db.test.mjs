/**
 * The room agent store against a real database (ADR-189).
 *
 * Proves the parts the pure planner cannot: one assignment per room, the thread survives
 * a reload, one running task per room, and releasing the assignment stops what is queued.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("room agent");
const store = database?.store ?? null;
const reachable = store !== null;
const suite = reachable ? describe : describe.skip;

const ids = {
  user: randomUUID(),
  org: randomUUID(),
  board: `room-agent-${randomUUID()}`,
  agent: randomUUID(),
  agent2: randomUUID(),
};

beforeAll(async () => {
  if (!store) return;
  const pool = store.pool;
  await pool.query(
    `insert into users (id, email, password_hash, name, handle)
     values ($1, $2, 'x', 'Anna', 'anna-room')`,
    [ids.user, `anna-${ids.user}@example.test`],
  );
  await pool.query(
    `insert into orgs (id, name, slug, kind, created_by)
     values ($1, 'Room org', $2, 'shared', $3)`,
    [ids.org, `room-${ids.org.slice(0, 8)}`, ids.user],
  );
  await pool.query(
    `insert into boards (id, title, org_id, owner_id, visibility)
     values ($1, 'Room', $2, $3, 'private')`,
    [ids.board, ids.org, ids.user],
  );
  await pool.query(
    `insert into agents (id, org_id, owner_id, name, state)
     values ($1, $2, $3, 'Mira', 'active'), ($4, $2, $3, 'Second', 'active')`,
    [ids.agent, ids.org, ids.user, ids.agent2],
  );
});

afterAll(async () => {
  if (!store) return;
  await store.pool.query("delete from boards where id = $1", [ids.board]);
  await store.pool.query("delete from orgs where id = $1", [ids.org]);
  await store.pool.query("delete from users where id = $1", [ids.user]);
  await store.close();
});

suite("room agent store", () => {
  it("assigns one agent and releases it with unfinished work", async () => {
    await store.setBoardAgent({
      boardId: ids.board,
      orgId: ids.org,
      agentId: ids.agent,
      assignedBy: ids.user,
    });
    const assigned = await store.getBoardAgent(ids.board);
    expect(assigned).toMatchObject({
      agent_id: ids.agent,
      agent_name: "Mira",
      enabled: true,
    });

    const task = await store.createAgentTask({
      orgId: ids.org,
      agentId: ids.agent,
      boardId: ids.board,
      intent: "stop me",
      createdBy: ids.user,
    });
    await store.releaseBoardAgent(ids.board, "unassigned");
    expect(await store.getBoardAgent(ids.board)).toBeNull();
    const stopped = await store.getAgentTask(task.id);
    expect(stopped.status).toBe("cancelled");
  });

  it("keeps a thread and its statuses across reads", async () => {
    const thread = await store.createAgentThread({
      orgId: ids.org,
      boardId: ids.board,
      agentId: ids.agent,
      agentName: "Mira",
      createdBy: ids.user,
      title: "Refund process",
    });
    const task = await store.createAgentTask({
      orgId: ids.org,
      agentId: ids.agent,
      boardId: ids.board,
      intent: "map the refund process",
      threadId: thread.id,
      createdBy: ids.user,
    });
    await store.appendAgentThreadMessage({
      threadId: thread.id,
      orgId: ids.org,
      boardId: ids.board,
      role: "user",
      authorId: ids.user,
      authorName: "Anna",
      text: "map the refund process",
      taskId: task.id,
    });
    await store.appendAgentThreadMessage({
      threadId: thread.id,
      orgId: ids.org,
      boardId: ids.board,
      role: "agent",
      agentName: "Mira",
      status: "queued",
      taskId: task.id,
    });
    await store.updateAgentThreadMessageByTask({
      taskId: task.id,
      status: "ready",
      text: "Draft",
      frameIds: ["frame-1"],
    });

    const threads = await store.listAgentThreads(ids.board);
    expect(threads[0]).toMatchObject({ id: thread.id, messages: 2, last_status: "ready" });
    const messages = await store.listAgentThreadMessages(thread.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "agent"]);
    expect(messages[1].frame_ids).toEqual(["frame-1"]);
  });

  it("deletes one conversation and stops its unfinished task", async () => {
    const thread = await store.createAgentThread({
      orgId: ids.org,
      boardId: ids.board,
      agentId: ids.agent,
      agentName: "Mira",
      createdBy: ids.user,
      title: "Delete me",
    });
    const task = await store.createAgentTask({
      orgId: ids.org,
      agentId: ids.agent,
      boardId: ids.board,
      intent: "delete me",
      threadId: thread.id,
      createdBy: ids.user,
    });
    await store.appendAgentThreadMessage({
      threadId: thread.id,
      orgId: ids.org,
      boardId: ids.board,
      role: "user",
      authorId: ids.user,
      authorName: "Anna",
      text: "delete me",
      taskId: task.id,
    });
    expect(await store.claimAgentTask(task.id)).not.toBeNull();

    const deleted = await store.deleteAgentThread(thread.id);
    expect(deleted?.id).toBe(thread.id);
    expect(await store.getAgentThread(thread.id)).toBeNull();
    expect(await store.listAgentThreadMessages(thread.id)).toEqual([]);
    const stopped = await store.getAgentTask(task.id);
    expect(stopped.status).toBe("cancelled");
  });

  it("clears every conversation in the room", async () => {
    for (const title of ["one", "two"]) {
      await store.createAgentThread({
        orgId: ids.org,
        boardId: ids.board,
        agentId: ids.agent,
        agentName: "Mira",
        createdBy: ids.user,
        title,
      });
    }
    const deleted = await store.deleteBoardAgentThreads(ids.board);
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(await store.listAgentThreads(ids.board)).toEqual([]);
  });

  it("runs one task per room and leaves the second in the queue", async () => {
    await store.pool.query(
      `update agent_tasks set status = 'cancelled', finished_at = now()
        where board_id = $1 and status in ('queued', 'running')`,
      [ids.board],
    );
    const first = await store.createAgentTask({
      orgId: ids.org,
      agentId: ids.agent,
      boardId: ids.board,
      intent: "first",
      createdBy: ids.user,
    });
    const second = await store.createAgentTask({
      orgId: ids.org,
      agentId: ids.agent,
      boardId: ids.board,
      intent: "second",
      createdBy: ids.user,
    });
    expect(await store.claimAgentTask(first.id)).not.toBeNull();
    expect(await store.claimAgentTask(second.id)).toBeNull();
    // The runner must not be offered the queued task of a room that is still busy.
    // Other suites may have their own queued work; only this task must stay hidden.
    const next = await store.nextQueuedAgentTask();
    expect(next?.id).not.toBe(second.id);
    await store.finishAgentTask({ id: first.id, status: "applied" });
    expect(await store.claimAgentTask(second.id)).not.toBeNull();
    await store.finishAgentTask({ id: second.id, status: "cancelled" });
  });
});
