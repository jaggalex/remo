/**
 * Provider keys, the model policy and the chained journal (ADR-067).
 *
 * Keys are ciphertext with a wrapped DEK; the journal stores parameters and hashes, never
 * prompts or board content.
 */
import { hashRun, normalizeRun } from "../ai-log.mjs";

export const aiMethods = {
async getAiPolicy(orgId) {
  const { rows } = await this.pool.query(
    `select ai_key_mode as "keyMode", ai_providers as providers, ai_models as models
       from org_policies where org_id = $1`,
    [orgId],
  );
  return rows[0] ?? { keyMode: "either", providers: [], models: [] };
},

async setAiPolicy(orgId, { keyMode = "either", providers = [], models = [] }) {
  const { rows } = await this.pool.query(
    `insert into org_policies (org_id, ai_key_mode, ai_providers, ai_models)
     values ($1, $2, $3, $4)
     on conflict (org_id) do update set
       ai_key_mode = excluded.ai_key_mode,
       ai_providers = excluded.ai_providers,
       ai_models = excluded.ai_models
     returning ai_key_mode as "keyMode", ai_providers as providers, ai_models as models`,
    [orgId, keyMode, providers, models],
  );
  return rows[0];
},

async createAiCredential({
  id,
  scope,
  scopeId,
  provider,
  label,
  baseUrl,
  model,
  ciphertext,
  nonce,
  dekWrapped,
  dekNonce,
  kekId,
  fingerprint,
  isDefault = true,
  createdBy,
}) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    if (isDefault) {
      await client.query(
        `update ai_credentials set is_default = false
          where scope = $1 and scope_id = $2 and provider = $3 and state = 'active'`,
        [scope, scopeId, provider],
      );
    }
    const { rows } = await client.query(
      `insert into ai_credentials
         (id, scope, scope_id, provider, label, base_url, model, ciphertext, nonce,
          dek_wrapped, dek_nonce, kek_id, fingerprint, is_default, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning id, scope, scope_id, provider, label, base_url, model, fingerprint,
                 is_default, state, created_at`,
      [
        id,
        scope,
        scopeId,
        provider,
        label,
        baseUrl,
        model,
        ciphertext,
        nonce,
        dekWrapped,
        dekNonce,
        kekId,
        fingerprint,
        isDefault,
        createdBy,
      ],
    );
    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async listAiCredentials(scope, scopeId) {
  const { rows } = await this.pool.query(
    `select id, scope, scope_id, provider, label, base_url, model, fingerprint,
            is_default, state, created_at, rotated_at, last_used_at
       from ai_credentials
      where scope = $1 and scope_id = $2 and state = 'active'
      order by is_default desc, created_at`,
    [scope, scopeId],
  );
  return rows;
},

async getAiCredential(id) {
  const { rows } = await this.pool.query(
    `select * from ai_credentials where id = $1 and state = 'active'`,
    [id],
  );
  return rows[0] ?? null;
},

async getDefaultAiCredential(scope, scopeId) {
  const { rows } = await this.pool.query(
    `select * from ai_credentials
      where scope = $1 and scope_id = $2 and is_default and state = 'active'
      order by created_at desc limit 1`,
    [scope, scopeId],
  );
  return rows[0] ?? null;
},

async revokeAiCredential(id, scope, scopeId) {
  const { rows } = await this.pool.query(
    `update ai_credentials set state = 'revoked', is_default = false
      where id = $1 and scope = $2 and scope_id = $3 and state = 'active'
      returning id`,
    [id, scope, scopeId],
  );
  return rows[0] ?? null;
},

async rotateAiCredential({
  id,
  scope,
  scopeId,
  ciphertext,
  nonce,
  dekWrapped,
  dekNonce,
  kekId,
  fingerprint,
}) {
  const { rows } = await this.pool.query(
    `update ai_credentials
        set ciphertext = $4, nonce = $5, dek_wrapped = $6, dek_nonce = $7,
            kek_id = $8, fingerprint = $9, rotated_at = now()
      where id = $1 and scope = $2 and scope_id = $3 and state = 'active'
      returning id, label, fingerprint, rotated_at`,
    [id, scope, scopeId, ciphertext, nonce, dekWrapped, dekNonce, kekId, fingerprint],
  );
  return rows[0] ?? null;
},

async setDefaultAiCredential({ id, scope, scopeId, provider }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update ai_credentials set is_default = false
        where scope = $1 and scope_id = $2 and provider = $3 and state = 'active'`,
      [scope, scopeId, provider],
    );
    const { rows } = await client.query(
      `update ai_credentials set is_default = true
        where id = $1 and scope = $2 and scope_id = $3 and state = 'active'
        returning id, is_default`,
      [id, scope, scopeId],
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

async touchAiCredential(id) {
  await this.pool.query(`update ai_credentials set last_used_at = now() where id = $1`, [id]);
},

async appendAiRun(input) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    // Serialize the chain per organisation; two calls must not pick the same seq.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      String(input.orgId),
    ]);
    const { rows: last } = await client.query(
      `select seq, hash from ai_runs where org_id = $1 order by seq desc limit 1`,
      [input.orgId],
    );
    const seq = last[0] ? Number(last[0].seq) + 1 : 1;
    const prevHash = last[0]?.hash ?? "";
    const run = normalizeRun({ ...input, orgId: input.orgId, seq, prevHash });
    const hash = hashRun(run);
    await client.query(
      `insert into ai_runs
         (org_id, seq, prev_hash, hash, agent_id, task_id, owner_id, board_id,
          skill, skill_version, capabilities, acl_version, provider, model,
          credential_id, key_fingerprint, temperature, max_tokens, toolset,
          prompt_hash, input_object_ids, prompt_tokens, completion_tokens, cost_usd,
          latency_ms, status, error_code, error_message, request_id, started_at, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
               $30, $31)`,
      [
        run.orgId,
        run.seq,
        run.prevHash,
        hash,
        run.agentId,
        run.taskId,
        run.ownerId,
        run.boardId,
        run.skill,
        run.skillVersion,
        run.capabilities,
        run.aclVersion,
        run.provider,
        run.model,
        run.credentialId,
        run.keyFingerprint,
        run.temperature,
        run.maxTokens,
        run.toolset,
        run.promptHash,
        run.inputObjectIds,
        run.promptTokens,
        run.completionTokens,
        run.costUsd,
        run.latencyMs,
        run.status,
        run.errorCode,
        run.errorMessage,
        run.requestId,
        run.startedAt,
        run.finishedAt,
      ],
    );
    await client.query("commit");
    return { ...run, hash };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async latestAiRun(orgId) {
  const { rows } = await this.pool.query(
    `select seq, hash, status, at
       from (select seq, hash, status, finished_at as at from ai_runs where org_id = $1
             order by seq desc limit 1) latest`,
    [orgId],
  );
  return rows[0] ?? null;
},

async listAiRuns(orgId, limit = 50) {
  const { rows } = await this.pool.query(
    `select id, org_id, seq, prev_hash, hash, agent_id, task_id, owner_id, board_id,
            skill, skill_version, capabilities, acl_version, provider, model,
            credential_id, key_fingerprint, temperature, max_tokens, toolset,
            prompt_hash, input_object_ids, prompt_tokens, completion_tokens, cost_usd,
            latency_ms, status, error_code, error_message, request_id, started_at, finished_at
       from ai_runs where org_id = $1 order by seq desc limit $2`,
    [orgId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
},

async aiRunsForVerify(orgId) {
  const { rows } = await this.pool.query(
    `select org_id, seq, prev_hash, hash, agent_id, task_id, owner_id, board_id,
            skill, skill_version, capabilities, acl_version, provider, model,
            credential_id, key_fingerprint, temperature, max_tokens, toolset,
            prompt_hash, input_object_ids, prompt_tokens, completion_tokens, cost_usd,
            latency_ms, status, error_code, error_message, request_id, started_at, finished_at
       from ai_runs where org_id = $1 order by seq`,
    [orgId],
  );
  return rows;
},

async orgsWithAiRuns() {
  // The log verifier walks every organisation; the function is the one cross-tenant
  // read, and each per-org read after it runs inside that tenant (ADR-178).
  const { rows } = await this.pool.query("select * from remo_ai_orgs() as org_id");
  return rows.map((row) => row.org_id);
},

async recordAiAnchor({ orgId, seq, hash, destination, ref = null }) {
  const { rows } = await this.pool.query(
    `insert into ai_log_anchors (org_id, seq, hash, destination, ref)
     values ($1, $2, $3, $4, $5)
     returning id, seq, hash, destination, ref, created_at`,
    [orgId, seq, hash, destination, ref],
  );
  return rows[0];
},

async latestAiAnchor(orgId) {
  const { rows } = await this.pool.query(
    `select seq, hash, destination, ref, created_at
       from ai_log_anchors where org_id = $1 order by seq desc, id desc limit 1`,
    [orgId],
  );
  return rows[0] ?? null;
}
};
