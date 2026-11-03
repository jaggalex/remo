/**
 * Integration tokens (ADR-096). Only the hash is stored; listing never returns it.
 */
export const integrationMethods = {
  async createIntegrationToken({
    orgId,
    ownerId,
    label,
    scopes,
    expiresAt,
    tokenHash,
    createdBy = null,
  }) {
    const { rows } = await this.pool.query(
      `insert into integration_tokens
         (org_id, owner_id, label, token_hash, scopes, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, org_id, owner_id, label, scopes, expires_at, revoked_at, created_at`,
      [orgId, ownerId, label, tokenHash, scopes, expiresAt, createdBy],
    );
    return rows[0];
  },

  async findIntegrationToken(tokenHash) {
    const { rows } = await this.pool.query(
      `select id, org_id, owner_id, label, scopes, expires_at, revoked_at, last_used_at
         from integration_tokens where token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  async touchIntegrationToken(id) {
    await this.pool.query("update integration_tokens set last_used_at = now() where id = $1", [
      id,
    ]);
  },

  async listIntegrationTokens(orgId) {
    const { rows } = await this.pool.query(
      `select id, label, scopes, expires_at, revoked_at, last_used_at, created_at
         from integration_tokens
        where org_id = $1
        order by created_at desc`,
      [orgId],
    );
    return rows;
  },

  async revokeIntegrationToken({ orgId, id }) {
    const { rowCount } = await this.pool.query(
      `update integration_tokens
          set revoked_at = now()
        where org_id = $1 and id = $2 and revoked_at is null`,
      [orgId, id],
    );
    return rowCount > 0;
  },
};
