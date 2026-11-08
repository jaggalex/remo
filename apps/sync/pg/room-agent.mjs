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
            ba.enabled, a.name as agent_name, a.state as agent_state,
            a.owner_id
       from board_agents ba
       join agents a on a.id = ba.agent_id
      where ba.board_id = $1`,
    [boardId],
  );
  return rows[0] ?? null;
},

async setBoardAgent({ boardId, orgId, agentId, assignedBy }) {
  const { rows } = await this.pool.query(
    `insert into board_agents (board_id, org_id, agent_id, assigned_by)
     values ($1, $2, $3, $4)
     on conflict (board_id) do update
       set agent_id = excluded.agent_id,
           assigned_by = excluded.assigned_by,
           assigned_at = now(),
           enabled = true
     returning *`,
    [boardId, orgId, agentId, assignedBy],
  );
  return rows[0] ?? null;
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
    `update agent_tasks
        set status = 'cancelled', finished_at = now(), error = $2
      where board_id = $1 and status in ('queued', 'running')`,
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

async getAgentThread(id) {
  const { rows } = await this.pool.query(
    `select * from agent_threads where id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async listAgentThreads(boardId, limit = 30) {
  const { rows } = await this.pool.query(
    `select t.id, t.board_id, t.agent_id, t.agent_name, t.created_by, t.title,
            t.created_at, t.updated_at,
            (select count(*)::int from agent_thread_messages m where m.thread_id = t.id) as messages,
            (select m.status from agent_thread_messages m
              where m.thread_id = t.id and m.role = 'agent'
              order by m.created_at desc limit 1) as last_status
       from agent_threads t
      where t.board_id = $1
      order by t.updated_at desc
      limit $2`,
    [boardId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
},

async listAgentThreadMessages(threadId, limit = 200) {
  const { rows } = await this.pool.query(
    `select id, thread_id, role, author_id, author_name, agent_name, text, status,
            task_id, frame_ids, created_at
       from agent_thread_messages
      where thread_id = $1
      order by created_at, id
      limit $2`,
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
        text, status, task_id, frame_ids)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      where task_id = $1 and role = 'agent'
      returning id, thread_id, status, text, frame_ids`,
    [taskId, status, text, frameIds],
  );
  return rows[0] ?? null;
},

};
