/**
 * The room agent store (ADR-189): assignment, shared threads and the task's message.
 *
 * Spread into the Postgres store, so `this.pool` is the same connection pool as every
 * other method and a caller cannot tell which file a method lives in.
 */
export const roomAgentMethods = {
/** The agent assigned to a room, with the name for the panel. */
async getBoardAgent(boardId) {
  const { rows } = await this.pool.query(
    `select ba.board_id, ba.org_id, ba.agent_id, ba.assigned_by, ba.assigned_at,
            ba.enabled, ba.delegate_ids, a.name as agent_name, a.state as agent_state,
            a.owner_id
       from board_agents ba
       join agents a on a.id = ba.agent_id
      where ba.board_id = $1`,
    [boardId],
  );
  return rows[0] ?? null;
},

async setBoardAgent({ boardId, orgId, agentId, assignedBy }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows: boards } = await client.query(
      "select owner_id, visibility from boards where id = $1 for no key update", [boardId],
    );
    if (boards[0]?.owner_id !== assignedBy || boards[0].visibility === "link") {
      await client.query("rollback");
      return null;
    }
    const { rows } = await client.query(
      `insert into board_agents (board_id, org_id, agent_id, assigned_by)
       values ($1, $2, $3, $4)
       on conflict (board_id) do update
         set agent_id = excluded.agent_id,
             assigned_by = excluded.assigned_by,
             assigned_at = now(),
             delegate_ids = case when board_agents.agent_id = excluded.agent_id
               then board_agents.delegate_ids else '{}' end,
             enabled = true
       returning *`,
      [boardId, orgId, agentId, assignedBy],
    );
    await client.query("commit");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

/** Update the current assignment and stop unfinished requests whose grant was removed. */
async setRoomAgentDelegate({ boardId, agentId, ownerId, userId, enabled }) {
  const { rows } = await this.pool.query(
    `with changed as (
       update board_agents ba
          set delegate_ids = case
            when $5 and not ($4 = any(ba.delegate_ids)) then array_append(ba.delegate_ids, $4)
            when not $5 then array_remove(ba.delegate_ids, $4)
            else ba.delegate_ids
          end
         from boards b
        where ba.board_id = $1 and ba.agent_id = $2 and ba.enabled
          and b.id = ba.board_id and b.owner_id = $3 and b.visibility <> 'link'
        returning ba.board_id
     ), stopped as (
       update agent_tasks t
          set status = 'cancelled', finished_at = now(), error = 'room agent permission revoked'
        where not $5 and t.board_id in (select board_id from changed)
          and t.agent_id = $2 and t.created_by = $4 and t.thread_id is not null
          and t.status in ('queued', 'running')
        returning t.id
     ), messages as (
       update agent_thread_messages m set status = 'stopped'
        where m.task_id in (select id from stopped) and m.role = 'agent'
     )
     select board_id from changed`,
    [boardId, agentId, ownerId, userId, enabled],
  );
  return Boolean(rows[0]);
},

async clearBoardAgent(boardId) {
  const { rows } = await this.pool.query(
    `delete from board_agents where board_id = $1 returning *`,
    [boardId],
  );
  return rows[0] ?? null;
},

/** Stop everything unfinished in the room, then drop the assignment (ADR-189). */
async releaseBoardAgent(boardId, reason = "agent unassigned") {
  await this.pool.query(
    `with stopped as (
       update agent_tasks set status = 'cancelled', finished_at = now(), error = $2
        where board_id = $1 and status in ('queued', 'running')
        returning id
     )
     update agent_thread_messages set status = 'stopped'
      where task_id in (select id from stopped) and role = 'agent'`,
    [boardId, reason],
  );
  return this.clearBoardAgent(boardId);
},

async createAgentThread({ orgId, boardId, agentId, agentName, createdBy, title }) {
  const { rows } = await this.pool.query(
    `insert into agent_threads (org_id, board_id, agent_id, agent_name, created_by, title)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [orgId, boardId, agentId, agentName, createdBy, title],
  );
  return rows[0] ?? null;
},

/** Make the queue entry visible together with both history messages. */
async enqueueRoomAgentTask({ thread, task, agentName, authorName }) {
  return this.withTenant(task.orgId, async () => {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = thread ?? await this.createAgentThread({
        orgId: task.orgId,
        boardId: task.boardId,
        agentId: task.agentId,
        agentName,
        createdBy: task.createdBy,
        title: task.intent.slice(0, 80),
      });
      const created = await this.createAgentTask({ ...task, threadId: current.id });
      const message = {
        threadId: current.id,
        orgId: task.orgId,
        boardId: task.boardId,
        taskId: created.id,
      };
      await this.appendAgentThreadMessage({
        ...message,
        role: "user",
        authorId: task.createdBy,
        authorName,
        text: task.intent,
      });
      await this.appendAgentThreadMessage({ ...message, role: "agent", agentName, status: "queued" });
      await client.query("commit");
      return { thread: current, task: created };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
},

async stopRoomAgentTask(id) {
  const { rows } = await this.pool.query(
    `with stopped as (
       update agent_tasks
          set status = 'cancelled', finished_at = now(), error = 'cancelled'
        where id = $1 and status in ('queued', 'running')
        returning id, status
     ), messages as (
       update agent_thread_messages set status = 'stopped'
        where task_id in (select id from stopped) and role = 'agent'
     )
     select * from stopped`,
    [id],
  );
  return rows[0] ?? null;
},

async getAgentThread(id) {
  const { rows } = await this.pool.query(
    `select * from agent_threads where id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async listAgentThreads(boardId, limit = 30, frameId = null) {
  const { rows } = await this.pool.query(
    `select t.id, t.board_id, t.agent_id, t.agent_name, t.created_by, t.title,
            t.created_at, t.updated_at,
            (select count(*)::int from agent_thread_messages m where m.thread_id = t.id) as messages,
            (select m.status from agent_thread_messages m
              where m.thread_id = t.id and m.role = 'agent'
              order by m.created_at desc limit 1) as last_status
       from agent_threads t
      where t.board_id = $1 and ($3::text is null or exists (
        select 1 from agent_thread_messages m where m.thread_id = t.id and $3 = any(m.frame_ids)
      ))
      order by t.updated_at desc
      limit $2`,
    [boardId, Math.min(Math.max(limit, 1), 100), frameId],
  );
  return rows;
},

async listAgentThreadMessages(threadId, limit = 200) {
  const { rows } = await this.pool.query(
    `select * from (
       select id, thread_id, role, author_id, author_name, agent_name, text, status,
              task_id, frame_ids, created_at
         from agent_thread_messages
        where thread_id = $1
        order by created_at desc, id desc
        limit $2
     ) recent order by created_at, id`,
    [threadId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
},

async appendAgentThreadMessage({
  threadId,
  orgId,
  boardId,
  role,
  authorId = null,
  authorName = "",
  agentName = null,
  text = "",
  status = null,
  taskId = null,
  frameIds = [],
}) {
  const { rows } = await this.pool.query(
    `insert into agent_thread_messages
       (thread_id, org_id, board_id, role, author_id, author_name, agent_name,
        text, status, task_id, frame_ids, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp())
     returning *`,
    [threadId, orgId, boardId, role, authorId, authorName, agentName, text, status, taskId, frameIds],
  );
  await this.pool.query(
    `update agent_threads set updated_at = now() where id = $1`,
    [threadId],
  );
  return rows[0] ?? null;
},

async countRunningAgentTasks(boardId) {
  const { rows } = await this.pool.query(
    `select count(*)::int as count from agent_tasks
      where board_id = $1 and status = 'running'`,
    [boardId],
  );
  return rows[0]?.count ?? 0;
},
async updateAgentThreadMessageByTask({ taskId, status, text = "", frameIds = [] }) {
  const { rows } = await this.pool.query(
    `update agent_thread_messages
        set status = $2, text = coalesce(nullif($3, ''), text), frame_ids = $4
      where task_id = $1 and role = 'agent' and status not in ('stopped', 'ready')
      returning id, thread_id, status, text, frame_ids`,
    [taskId, status, text, frameIds],
  );
  return rows[0] ?? null;
},

/** Delete one conversation; unfinished work in it stops first (ADR-190). */
async deleteAgentThread(threadId) {
  const { rows } = await this.pool.query(
    `select id, board_id from agent_threads where id = $1`,
    [threadId],
  );
  const thread = rows[0];
  if (!thread) return null;
  await this.pool.query(
    `update agent_tasks
        set status = 'cancelled', finished_at = now(),
            error = coalesce(error, 'history cleared')
      where thread_id = $1 and status in ('queued', 'running')`,
    [threadId],
  );
  await this.pool.query(`delete from agent_threads where id = $1`, [threadId]);
  return thread;
},

/** Clear every conversation in one room; frames and task rows stay (ADR-190). */
async deleteBoardAgentThreads(boardId) {
  await this.pool.query(
    `update agent_tasks t
        set status = 'cancelled', finished_at = now(),
            error = coalesce(t.error, 'history cleared')
       from agent_threads th
      where t.thread_id = th.id and th.board_id = $1
        and t.status in ('queued', 'running')`,
    [boardId],
  );
  const { rowCount } = await this.pool.query(
    `delete from agent_threads where board_id = $1`,
    [boardId],
  );
  return rowCount ?? 0;
},

};
