/**
 * Agents, tokens, skills, tasks, schedules and actions (ADR-066).
 *
 * An agent has no grants of its own: every row here is scoped by an owner and a task.
 */
export const agentMethods = {
async createAgent({ orgId, ownerId, name, createdBy, credentialId = null, model = null }) {
  const { rows } = await this.pool.query(
    `insert into agents (org_id, owner_id, name, created_by, credential_id, model)
     values ($1, $2, $3, $4, $5, $6)
     returning id, org_id, owner_id, name, state, credential_id, model, created_at`,
    [orgId, ownerId, name, createdBy, credentialId, model],
  );
  return rows[0];
},

async getAgent(id) {
  const { rows } = await this.pool.query(
    `select a.id, a.org_id, a.owner_id, a.name, a.state, a.created_at, a.disabled_at,
            a.credential_id, a.model,
            u.name as owner_name, u.email as owner_email
       from agents a join users u on u.id = a.owner_id
      where a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async listAgents(orgId) {
  const { rows } = await this.pool.query(
    `select a.id, a.org_id, a.owner_id, a.name, a.state, a.created_at, a.disabled_at,
            a.credential_id, a.model,
            u.name as owner_name, u.email as owner_email,
            (select count(*)::int from agent_tokens t
              where t.agent_id = a.id and t.revoked_at is null and t.expires_at > now())
              as active_tokens
       from agents a join users u on u.id = a.owner_id
      where a.org_id = $1
      order by a.created_at`,
    [orgId],
  );
  return rows;
},

async updateAgent({ id, name, state }) {
  const { rows } = await this.pool.query(
    `update agents
        set name = coalesce($2, name),
            state = coalesce($3, state),
            disabled_at = case
              when $3 = 'disabled' then now()
              when $3 = 'active' then null
              else disabled_at
            end
      where id = $1
      returning id, org_id, owner_id, name, state, disabled_at`,
    [id, name ?? null, state ?? null],
  );
  return rows[0] ?? null;
},

async setAgentCredential({ id, credentialId, model }) {
  const { rows } = await this.pool.query(
    `update agents set credential_id = $2, model = $3
      where id = $1
      returning id, credential_id, model`,
    [id, credentialId ?? null, model ?? null],
  );
  return rows[0] ?? null;
},

async setAgentState({ id, state }) {
  const { rows } = await this.pool.query(
    `update agents
        set state = $2,
            disabled_at = case when $2 = 'disabled' then now() else null end
      where id = $1
      returning id, state, disabled_at`,
    [id, state],
  );
  return rows[0] ?? null;
},

async createAgentToken({ agentId, tokenHash, label, expiresAt, createdBy }) {
  const { rows } = await this.pool.query(
    `insert into agent_tokens (agent_id, token_hash, label, expires_at, created_by)
     values ($1, $2, $3, $4, $5)
     returning id, label, expires_at, created_at`,
    [agentId, tokenHash, label, expiresAt, createdBy],
  );
  return rows[0];
},

async listAgentTokens(agentId) {
  const { rows } = await this.pool.query(
    `select id, label, expires_at, revoked_at, last_used_at, created_at
       from agent_tokens where agent_id = $1 order by created_at desc`,
    [agentId],
  );
  return rows;
},

async revokeAgentToken(agentId, tokenId) {
  const { rows } = await this.pool.query(
    `update agent_tokens set revoked_at = now()
      where id = $1 and agent_id = $2 and revoked_at is null
      returning id`,
    [tokenId, agentId],
  );
  return rows[0] ?? null;
},

async findAgentByToken(tokenHash) {
  const { rows } = await this.pool.query(
    `select a.id as agent_id, a.org_id, a.owner_id, a.name as agent_name, a.state,
            u.name as owner_name, u.email as owner_email,
            t.id as token_id, t.expires_at
       from agent_tokens t
       join agents a on a.id = t.agent_id
       join users u on u.id = a.owner_id
       join org_memberships m
         on m.org_id = a.org_id and m.user_id = a.owner_id and m.state = 'active'
      where t.token_hash = $1 and t.revoked_at is null and t.expires_at > now()
        and a.state = 'active'`,
    [tokenHash],
  );
  return rows[0] ?? null;
},

async touchAgentToken(tokenId) {
  await this.pool.query(`update agent_tokens set last_used_at = now() where id = $1`, [
    tokenId,
  ]);
},

async listAgentSkills(orgId) {
  const { rows } = await this.pool.query(
    `select distinct on (slug)
            id, org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at
       from agent_skills
      where state = 'published' and (org_id is null or org_id = $1)
      order by slug, (org_id is null) asc, version desc`,
    [orgId],
  );
  return rows;
},

async getAgentSkill(id) {
  const { rows } = await this.pool.query(
    `select id, org_id, slug, version, name, description, input_schema, output_schema,
            required_capabilities, tools, risk, handler, state, published_at
       from agent_skills where id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async getAgentSkillBySlug(orgId, slug) {
  const { rows } = await this.pool.query(
    `select id, org_id, slug, version, name, description, required_capabilities,
            tools, risk, handler, state
       from agent_skills
      where state = 'published' and slug = $2 and (org_id is null or org_id = $1)
      order by (org_id is null) asc, version desc
      limit 1`,
    [orgId, slug],
  );
  return rows[0] ?? null;
},

async createAgentSkill({
  orgId,
  slug,
  version = 1,
  name,
  description = "",
  inputSchema = {},
  outputSchema = {},
  requiredCapabilities = [],
  tools = [],
  risk = "propose",
  handler,
  createdBy,
}) {
  const { rows } = await this.pool.query(
    `insert into agent_skills
       (org_id, slug, version, name, description, input_schema, output_schema,
        required_capabilities, tools, risk, handler, state, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12)
     returning id, org_id, slug, version, state`,
    [
      orgId,
      slug,
      version,
      name,
      description,
      JSON.stringify(inputSchema),
      JSON.stringify(outputSchema),
      requiredCapabilities,
      tools,
      risk,
      handler,
      createdBy,
    ],
  );
  return rows[0];
},

async publishAgentSkill(id, userId) {
  const { rows } = await this.pool.query(
    `update agent_skills
        set state = 'published', published_by = $2, published_at = now()
      where id = $1 and state in ('draft', 'disabled')
      returning id, org_id, slug, version, state, published_at`,
    [id, userId],
  );
  return rows[0] ?? null;
},

async createAgentTask({
  orgId,
  agentId,
  boardId,
  mode = "write",
  capabilities = [],
  intent,
  input = {},
  skillId = null,
  skillSlug = null,
  skillVersion = null,
  budget = {},
  createdBy,
  scheduleId = null,
  credentialId = null,
  model = null,
  idempotencyKey = null,
  changeSetId = null,
  threadId = null,
}) {
  const { rows } = await this.pool.query(
    `insert into agent_tasks
       (org_id, agent_id, board_id, mode, capabilities, intent, input,
        skill_id, skill_slug, skill_version, budget, created_by, schedule_id,
        credential_id, model, idempotency_key, change_set_id, thread_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     returning *`,
    [
      orgId,
      agentId,
      boardId,
      mode,
      capabilities,
      intent,
      JSON.stringify(input),
      skillId,
      skillSlug,
      skillVersion,
      JSON.stringify(budget),
      createdBy,
      scheduleId,
      credentialId,
      model,
      idempotencyKey,
      changeSetId,
      threadId,
    ],
  );
  return rows[0];
},

async findAgentTaskByIdempotency(boardId, createdBy, key) {
  const { rows } = await this.pool.query(
    `select id, agent_id, board_id, status, intent, skill_slug, created_at
       from agent_tasks
      where board_id = $1 and created_by = $2 and idempotency_key = $3`,
    [boardId, createdBy, key],
  );
  return rows[0] ?? null;
},

async getAgentTaskByChangeSet(changeSetId) {
  const { rows } = await this.pool.query(
    `select id, status, skill_slug, intent, created_at, finished_at
       from agent_tasks where change_set_id = $1
      order by created_at desc limit 1`,
    [changeSetId],
  );
  return rows[0] ?? null;
},

async getAgentTask(id) {
  const { rows } = await this.pool.query(
    `select t.*, a.name as agent_name, a.owner_id, a.state as agent_state,
            u.name as owner_name, u.email as owner_email, b.title as board_title
       from agent_tasks t
       join agents a on a.id = t.agent_id
       join users u on u.id = a.owner_id
       left join boards b on b.id = t.board_id
      where t.id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async listBoardAgentTasks(boardId, limit = 20) {
  const { rows } = await this.pool.query(
    `select t.id, t.agent_id, t.board_id, t.mode, t.intent, t.skill_slug,
            t.status, t.budget, t.usage, t.progress, t.result, t.error,
            t.created_at, t.started_at, t.finished_at, a.name as agent_name
       from agent_tasks t join agents a on a.id = t.agent_id
      where t.board_id = $1
      order by t.created_at desc
      limit $2`,
    [boardId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
},

async listAgentTasksForAgent(agentId, limit = 20) {
  const { rows } = await this.pool.query(
    `select id, board_id, intent, skill_slug, status, usage, error, created_at, finished_at
       from agent_tasks where agent_id = $1
      order by created_at desc limit $2`,
    [agentId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
},

async listOrgAgentTasks(orgId, limit = 50) {
  const { rows } = await this.pool.query(
    `select t.id, t.agent_id, t.board_id, t.intent, t.skill_slug, t.status,
            t.usage, t.error, t.created_at, t.finished_at, a.name as agent_name
       from agent_tasks t join agents a on a.id = t.agent_id
      where t.org_id = $1
      order by t.created_at desc
      limit $2`,
    [orgId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows;
},

async nextQueuedAgentTask() {
  const { rows } = await this.pool.query(
    `select t.id, t.skill_slug from agent_tasks t
      where t.status = 'queued'
        and not exists (
          select 1 from agent_tasks running
           where running.board_id = t.board_id and running.status = 'running'
        )
      order by t.created_at limit 1`,
  );
  return rows[0] ?? null;
},

async claimAgentTask(id) {
  try {
    const { rows } = await this.pool.query(
      `update agent_tasks
          set status = 'running', started_at = now()
        where id = $1 and status = 'queued'
        returning *`,
      [id],
    );
    return rows[0] ?? null;
  } catch (error) {
    // ADR-189: one running task per room. Another room's task may still start; a second
    // task in the same room waits in the queue until the first finishes.
    if (error?.code === "23505") return null;
    throw error;
  }
},

async updateAgentTaskProgress(id, progress) {
  const { rows } = await this.pool.query(
    `update agent_tasks set progress = $2
      where id = $1 and status = 'running'
      returning id, progress`,
    [id, JSON.stringify(progress ?? {})],
  );
  return rows[0] ?? null;
},

async finishAgentTask({ id, status, usage = {}, result = null, error = null }) {
  const { rows } = await this.pool.query(
    `update agent_tasks
        set status = $2, usage = $3, result = $4, error = $5, finished_at = now()
      where id = $1 and status = 'running'
      returning *`,
    [id, status, JSON.stringify(usage), result ? JSON.stringify(result) : null, error],
  );
  return rows[0] ?? null;
},

/**
 * Replace a task's result without touching its status.
 *
 * A tidy relayout is the same proposal read another way: the task stays
 * `awaiting_approval`, and only the strategy/estimate inside `result` changes.
 */
async updateAgentTaskResult({ id, result }) {
  const { rows } = await this.pool.query(
    `update agent_tasks set result = $2 where id = $1 returning id, result`,
    [id, JSON.stringify(result)],
  );
  return rows[0] ?? null;
},

async cancelAgentTask(id) {
  const { rows } = await this.pool.query(
    `update agent_tasks
        set status = 'cancelled', finished_at = now(),
            error = coalesce(error, 'cancelled')
      where id = $1 and status in ('queued', 'running')
      returning id, status`,
    [id],
  );
  return rows[0] ?? null;
},

async cancelQueuedAgentTasksForBoard(boardId) {
  const { rows } = await this.pool.query(
    `update agent_tasks set status = 'cancelled', finished_at = now(),
            error = 'agents disabled on this board'
      where board_id = $1 and status = 'queued'
      returning id`,
    [boardId],
  );
  return rows;
},

async cancelQueuedAgentTasksForAgent(agentId) {
  const { rows } = await this.pool.query(
    `update agent_tasks set status = 'cancelled', finished_at = now(),
            error = 'the agent was disabled'
      where agent_id = $1 and status = 'queued'
      returning id`,
    [agentId],
  );
  return rows;
},

async cancelQueuedAgentTasksForOrg(orgId) {
  const { rows } = await this.pool.query(
    `update agent_tasks set status = 'cancelled', finished_at = now(),
            error = 'agents disabled in this organisation'
      where org_id = $1 and status = 'queued'
      returning id`,
    [orgId],
  );
  return rows;
},

async countQueuedAgentTasks(boardId) {
  const { rows } = await this.pool.query(
    `select count(*)::int as total from agent_tasks
      where board_id = $1 and status in ('queued', 'running')`,
    [boardId],
  );
  return rows[0]?.total ?? 0;
},

async getAgentSchedule(id) {
  const { rows } = await this.pool.query(
    `select s.*, a.owner_id, a.name as agent_name
       from agent_schedules s join agents a on a.id = s.agent_id
      where s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

async disableAgentSchedulesForOrg(orgId) {
  await this.pool.query(
    `update agent_schedules set enabled = false where org_id = $1 and enabled`,
    [orgId],
  );
},

async recoverStaleAgentTasks(minutes = 15) {
  const { rows } = await this.pool.query(
    `update agent_tasks
        set status = 'failed', finished_at = now(),
            error = 'the worker stopped before finishing'
      where status = 'running' and started_at < now() - ($1::int * interval '1 minute')
      returning id`,
    [minutes],
  );
  return rows;
},

async createAgentSchedule({
  orgId,
  agentId,
  boardId,
  skillSlug,
  intent,
  input = {},
  budget = {},
  intervalSeconds,
  createdBy,
}) {
  const { rows } = await this.pool.query(
    `insert into agent_schedules
       (org_id, agent_id, board_id, skill_slug, intent, input, budget,
        interval_seconds, next_run_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($8::int * interval '1 second'), $9)
     returning id, board_id, agent_id, skill_slug, intent, interval_seconds,
               enabled, next_run_at, created_at`,
    [
      orgId,
      agentId,
      boardId,
      skillSlug,
      intent,
      JSON.stringify(input),
      JSON.stringify(budget),
      intervalSeconds,
      createdBy,
    ],
  );
  return rows[0];
},

async listBoardAgentSchedules(boardId) {
  const { rows } = await this.pool.query(
    `select s.id, s.board_id, s.agent_id, s.skill_slug, s.intent, s.interval_seconds,
            s.enabled, s.next_run_at, s.last_run_at, s.created_at, a.name as agent_name
       from agent_schedules s join agents a on a.id = s.agent_id
      where s.board_id = $1
      order by s.created_at`,
    [boardId],
  );
  return rows;
},

async dueAgentSchedules(limit = 10) {
  const { rows } = await this.pool.query(
    `select id, org_id, agent_id, board_id, skill_slug, intent, input, budget,
            interval_seconds, next_run_at
       from agent_schedules
      where enabled and next_run_at <= now()
      order by next_run_at
      limit $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return rows;
},

async advanceAgentSchedule(id) {
  const { rows } = await this.pool.query(
    `update agent_schedules
        set last_run_at = now(),
            next_run_at = now() + (interval_seconds * interval '1 second')
      where id = $1 and enabled and next_run_at <= now()
      returning id, next_run_at`,
    [id],
  );
  return rows[0] ?? null;
},

async disableAgentSchedulesForBoard(boardId) {
  await this.pool.query(
    `update agent_schedules set enabled = false where board_id = $1 and enabled`,
    [boardId],
  );
},

async deleteAgentSchedule(id) {
  const { rows } = await this.pool.query(
    `delete from agent_schedules where id = $1 returning id`,
    [id],
  );
  return rows[0] ?? null;
},

async recordAgentAction({ taskId, boardId, objectId, action, detail = null }) {
  await this.pool.query(
    `insert into agent_actions (task_id, board_id, object_id, action, detail)
     values ($1, $2, $3, $4, $5)`,
    [taskId, boardId, objectId ?? null, action, detail ? JSON.stringify(detail) : null],
  );
},

/* ------------------------------------------------------- authoring plans -- */

async createAgentTaskInputs({ taskId, boardId, inputs }) {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const rows = [];
  for (const input of inputs) {
    const { rows: inserted } = await this.pool.query(
      `insert into agent_task_inputs
         (task_id, source, name, kind, content, bytes, chars, truncated, truncation_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (task_id, source) do update
         set name = excluded.name, kind = excluded.kind, content = excluded.content,
             bytes = excluded.bytes, chars = excluded.chars,
             truncated = excluded.truncated, truncation_code = excluded.truncation_code
       returning task_id, source, name, kind, bytes, chars, truncated, truncation_code`,
      [
        taskId,
        input.source,
        input.name ?? "",
        input.kind,
        input.content,
        input.bytes ?? 0,
        input.chars ?? 0,
        input.truncated === true,
        input.truncation_code ?? null,
      ],
    );
    rows.push(inserted[0]);
  }
  return rows;
},

async listAgentTaskInputs(taskId) {
  const { rows } = await this.pool.query(
    `select task_id, source, name, kind, content, bytes, chars, truncated, truncation_code,
            created_at
       from agent_task_inputs where task_id = $1 order by source`,
    [taskId],
  );
  return rows;
},

/**
 * Store the plan a task proposed.
 *
 * `task_id` is unique, so a repeated run refreshes a plan nobody has approved yet and
 * never replaces one a person already acted on. The returned row is the plan that is
 * now current, whichever branch won.
 */
async createAgentPlan({
  taskId,
  orgId,
  boardId,
  agentId,
  plan,
  estimate = {},
  skillSlug = null,
  skillVersion = null,
  model = null,
}) {
  const { rows } = await this.pool.query(
    `insert into agent_task_plans
       (task_id, org_id, board_id, agent_id, plan, estimate, skill_slug, skill_version, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (task_id) do update
       set plan = excluded.plan,
           estimate = excluded.estimate,
           skill_slug = excluded.skill_slug,
           skill_version = excluded.skill_version,
           model = excluded.model,
           proposed_at = now()
       where agent_task_plans.status = 'proposed'
     returning *`,
    [
      taskId,
      orgId,
      boardId,
      agentId,
      JSON.stringify(plan),
      JSON.stringify(estimate),
      skillSlug,
      skillVersion,
      model,
    ],
  );
  if (rows[0]) return rows[0];
  return this.getAgentTaskPlan(taskId);
},

async getAgentTaskPlan(taskId) {
  const { rows } = await this.pool.query(
    `select id, task_id, org_id, board_id, agent_id, status, plan, estimate,
            skill_slug, skill_version, model, proposed_at, approved_at, approved_by,
            applied_at, rejected_at, rejected_by, rejection_reason
       from agent_task_plans where task_id = $1`,
    [taskId],
  );
  return rows[0] ?? null;
},

/** Approve a proposed plan. A second call returns the plan that is already approved. */
async approveAgentPlan({ taskId, userId }) {
  const { rows } = await this.pool.query(
    `update agent_task_plans
        set status = 'approved', approved_at = now(), approved_by = $2
      where task_id = $1 and status = 'proposed'
      returning *`,
    [taskId, userId],
  );
  if (rows[0]) return { plan: rows[0], transitioned: true };
  return { plan: await this.getAgentTaskPlan(taskId), transitioned: false };
},

/** Reject a proposed plan and close the task that proposed it. */
async rejectAgentPlan({ taskId, userId, reason = null }) {
  const { rows } = await this.pool.query(
    `update agent_task_plans
        set status = 'rejected', rejected_at = now(), rejected_by = $2, rejection_reason = $3
      where task_id = $1 and status = 'proposed'
      returning *`,
    [taskId, userId, reason],
  );
  if (!rows[0]) return { plan: await this.getAgentTaskPlan(taskId), transitioned: false };
  await this.pool.query(
    `update agent_tasks
        set status = 'cancelled', finished_at = now(),
            error = coalesce(error, 'the plan was rejected')
      where id = $1 and status = 'awaiting_approval'`,
    [taskId],
  );
  return { plan: rows[0], transitioned: true };
},

/**
 * Mark an approved plan as applied after the client's transaction.
 *
 * The server never writes the objects (ADR-142); M2b calls this once the author's tab
 * reports the transaction, so the record says "approved and applied" instead of
 * "approved forever".
 */
async markAgentPlanApplied({ taskId }) {
  const { rows } = await this.pool.query(
    `update agent_task_plans
        set status = 'applied', applied_at = now()
      where task_id = $1 and status = 'approved'
      returning *`,
    [taskId],
  );
  if (!rows[0]) return { plan: await this.getAgentTaskPlan(taskId), transitioned: false };
  await this.pool.query(
    `update agent_tasks
        set status = 'applied', finished_at = coalesce(finished_at, now())
      where id = $1 and status = 'awaiting_approval'`,
    [taskId],
  );
  return { plan: rows[0], transitioned: true };
},
};