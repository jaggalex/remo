import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { recoverRoomDrafts } from "./sync-agents.mjs";
import { testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

const database = await testDatabaseStore("room draft recovery");
const suite = database ? describe : describe.skip;

afterAll(async () => {
  await database?.store.close();
});

suite("room draft restart", () => {
  it("settles saved and unsaved attempts using persisted state without adding any objects", async () => {
    const { store } = database;
    const orgId = randomUUID();
    const authorId = randomUUID();
    const agentId = randomUUID();
    const boardId = `draft-recovery-${randomUUID()}`;
    const scopedRecovery = Object.create(store);
    // Other database suites may have a live worker sharing this test database.
    scopedRecovery.roomDraftsToRecover = async () =>
      (await store.roomDraftsToRecover()).filter((task) => task.org_id === orgId);
    const log = {
      error(...args) {
        throw new Error(args.join(" "));
      },
    };

    async function startAttempt() {
      const thread = await store.createAgentThread({
        orgId,
        boardId,
        agentId,
        agentName: "Mira",
        createdBy: authorId,
        title: "Draft",
      });
      const task = await store.createAgentTask({
        orgId,
        boardId,
        agentId,
        createdBy: authorId,
        intent: "Draft",
        skillSlug: "room-draft",
        skillVersion: 1,
        threadId: thread.id,
      });
      await store.appendAgentThreadMessage({
        orgId,
        boardId,
        threadId: thread.id,
        role: "agent",
        status: "running",
        taskId: task.id,
      });
      await store.claimAgentTask(task.id);
      return { threadId: thread.id, taskId: task.id };
    }

    try {
      await store.pool.query(
        "insert into users (id, email, password_hash, name, handle) values ($1, $2, 'x', 'Anna', $3)",
        [authorId, `${authorId}@example.test`, `anna-${authorId.slice(0, 8)}`],
      );
      await store.pool.query(
        "insert into orgs (id, name, slug, created_by) values ($1, 'Org', $2, $3)",
        [orgId, `recovery-${orgId.slice(0, 8)}`, authorId],
      );
      await store.pool.query(
        "insert into boards (id, title, org_id, owner_id) values ($1, 'Room', $2, $3)",
        [boardId, orgId, authorId],
      );
      await store.pool.query(
        "insert into agents (id, org_id, owner_id, name) values ($1, $2, $3, 'Mira')",
        [agentId, orgId, authorId],
      );

      const saved = await startAttempt();
      const doc = new Y.Doc();
      const widgets = doc.getMap("widgets");
      widgets.set("frame-draft", {
        id: "frame-draft",
        type: "frame",
        title: "Draft from Mira",
        agent: { taskId: saved.taskId },
      });
      widgets.set("note-draft", { id: "note-draft", type: "note", agent: { taskId: saved.taskId } });
      await store.pool.query("insert into board_updates (board_id, update) values ($1, $2)", [
        boardId,
        Buffer.from(Y.encodeStateAsUpdate(doc)),
      ]);
      doc.destroy();

      expect(await recoverRoomDrafts(scopedRecovery, log)).toBe(1);
      expect(await store.getAgentTask(saved.taskId)).toMatchObject({
        status: "applied",
        result: { frameId: "frame-draft", createdIds: ["frame-draft", "note-draft"], recovered: true },
      });
      expect(await store.listAgentThreadMessages(saved.threadId)).toMatchObject([
        { status: "ready", frame_ids: ["frame-draft"], text: "Draft from Mira" },
      ]);

      // The task may have committed immediately before the process lost the history update.
      await store.pool.query(
        "update agent_thread_messages set status = 'running', frame_ids = '{}' where task_id = $1",
        [saved.taskId],
      );
      expect(await recoverRoomDrafts(scopedRecovery, log)).toBe(1);
      expect(await store.listAgentThreadMessages(saved.threadId)).toMatchObject([
        { status: "ready", frame_ids: ["frame-draft"] },
      ]);

      const unsaved = await startAttempt();
      expect(await recoverRoomDrafts(scopedRecovery, log)).toBe(1);
      expect(await store.getAgentTask(unsaved.taskId)).toMatchObject({ status: "failed" });
      expect(await store.listAgentThreadMessages(unsaved.threadId)).toMatchObject([
        { status: "error", frame_ids: [] },
      ]);
      expect(await recoverRoomDrafts(scopedRecovery, log)).toBe(0);
      const { rowCount } = await store.pool.query("select id from board_updates where board_id = $1", [
        boardId,
      ]);
      expect(rowCount).toBe(1);
    } finally {
      await store.pool.query("delete from boards where id = $1", [boardId]);
      await store.pool.query("delete from orgs where id = $1", [orgId]);
      await store.pool.query("delete from users where id = $1", [authorId]);
    }
  });
});
