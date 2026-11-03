/**
 * Change sets: the plan, its progress and its result (ADR-068).
 *
 * The writes themselves live in the command registry; this module only remembers what
 * was planned and how far it got.
 */
export const changeSetMethods = {
async createChangeSet({
  orgId,
  boardId,
  agentId,
  operations,
  estimate = {},
  status = "draft",
  aclVersion = null,
  createdBy,
  idempotencyKey = null,
  budget = {},
  intent = "",
  origin = {},
}) {
  const { rows } = await this.pool.query(
    `insert into agent_change_sets
       (org_id, board_id, agent_id, operations, estimate, status, acl_version,
        created_by, idempotency_key, budget, intent, origin)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning *`,
    [
      orgId,
      boardId,
      agentId,
      JSON.stringify(operations),
      JSON.stringify(estimate),
      status,
      aclVersion,
      createdBy,
      idempotencyKey,
      JSON.stringify(budget),
      intent,
      JSON.stringify(origin),
    ],
  );
  return rows[0];
},

async getChangeSet(id) {
  const { rows } = await this.pool.query(
    `select c.*, a.name as agent_name, a.owner_id, b.title as board_title
       from agent_change_sets c
       join agents a on a.id = c.agent_id
       left join boards b on b.id = c.board_id
      where c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async listBoardChangeSets(boardId, limit = 20) {
  const { rows } = await this.pool.query(
    `select c.id, c.org_id, c.board_id, c.agent_id, c.status, c.estimate,
            c.progress, c.result, c.error, c.created_at, c.started_at, c.finished_at,
            a.name as agent_name
       from agent_change_sets c join agents a on a.id = c.agent_id
      where c.board_id = $1
      order by c.created_at desc
      limit $2`,
    [boardId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
},

async findChangeSetByIdempotency(boardId, createdBy, key) {
  const { rows } = await this.pool.query(
    `select id from agent_change_sets
      where board_id = $1 and created_by = $2 and idempotency_key = $3`,
    [boardId, createdBy, key],
  );
  return rows[0] ?? null;
},

async queueChangeSet(id) {
  const { rows } = await this.pool.query(
    `update agent_change_sets set status = 'queued', error = null
      where id = $1 and status in ('draft','failed','cancelled')
      returning *`,
    [id],
  );
  return rows[0] ?? null;
},

async startChangeSet(id) {
  const { rows } = await this.pool.query(
    `update agent_change_sets set status = 'running', started_at = now()
      where id = $1 and status = 'queued'
      returning *`,
    [id],
  );
  return rows[0] ?? null;
},

async updateChangeSetProgress(id, progress) {
  const { rows } = await this.pool.query(
    `update agent_change_sets set progress = $2
      where id = $1 and status = 'running'
      returning id, progress`,
    [id, JSON.stringify(progress ?? {})],
  );
  return rows[0] ?? null;
},

async finishChangeSet({ id, status, result = null, error = null }) {
  const { rows } = await this.pool.query(
    `update agent_change_sets
        set status = $2, result = $3, error = $4, finished_at = now()
      where id = $1 and status in ('running','queued')
      returning *`,
    [id, status, result ? JSON.stringify(result) : null, error],
  );
  return rows[0] ?? null;
},

async cancelChangeSet(id) {
  const { rows } = await this.pool.query(
    `update agent_change_sets
        set status = 'cancelled', finished_at = now(),
            error = coalesce(error, 'cancelled')
      where id = $1 and status in ('draft','queued','running')
      returning *`,
    [id],
  );
  return rows[0] ?? null;
}
};
