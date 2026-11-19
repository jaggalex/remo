/**
 * The organisation's webhook endpoint and its secret (ADR-095).
 *
 * One row per organisation. The secret is stored in the same envelope as provider keys
 * and is only ever returned by the create/rotate call that generated it.
 */
export const webhookMethods = {
  async getOrgWebhook(orgId) {
    const { rows } = await this.pool.query(
      `select org_id, url, ciphertext, nonce, dek_wrapped, dek_nonce, kek_id, fingerprint,
              enabled, created_by, created_at, updated_at, rotated_at, last_delivery_at,
              last_error
         from org_webhooks where org_id = $1`,
      [orgId],
    );
    return rows[0] ?? null;
  },

  async saveOrgWebhook({ orgId, url, secret, createdBy = null, rotated = false }) {
    const { rows } = await this.pool.query(
      `insert into org_webhooks
         (org_id, url, ciphertext, nonce, dek_wrapped, dek_nonce, kek_id, fingerprint,
          enabled, created_by, rotated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
       on conflict (org_id) do update set
         url = excluded.url,
         ciphertext = excluded.ciphertext,
         nonce = excluded.nonce,
         dek_wrapped = excluded.dek_wrapped,
         dek_nonce = excluded.dek_nonce,
         kek_id = excluded.kek_id,
         fingerprint = excluded.fingerprint,
         enabled = true,
         rotated_at = coalesce(excluded.rotated_at, org_webhooks.rotated_at),
         updated_at = now(),
         last_error = null
       returning org_id, url, fingerprint, enabled, created_at, updated_at, rotated_at`,
      [
        orgId,
        url,
        secret.ciphertext,
        secret.nonce,
        secret.dekWrapped,
        secret.dekNonce,
        secret.kekId,
        secret.fingerprint,
        createdBy,
        rotated ? new Date() : null,
      ],
    );
    return rows[0];
  },

  async deleteOrgWebhook(orgId) {
    const { rowCount } = await this.pool.query("delete from org_webhooks where org_id = $1", [
      orgId,
    ]);
    return rowCount > 0;
  },

  async touchWebhook(orgId, { ok, error = null }) {
    await this.pool.query(
      `update org_webhooks
          set last_delivery_at = case when $2 then now() else last_delivery_at end,
              last_error = $3
        where org_id = $1`,
      [orgId, ok, error],
    );
  },

  /** Recent events of an organisation for the deliveries view. */
  async listOrgEvents(orgId, { limit = 50, dead = false } = {}) {
    const { rows } = await this.pool.query(
      `select id, board_id, type, subject, payload, actor_id, actor_type, occurred_at,
              published_at, attempts, next_attempt_at, dead_at, last_error
         from event_outbox
        where org_id = $1 ${dead ? "and dead_at is not null" : ""}
        order by occurred_at desc, id desc
        limit $2`,
      [orgId, limit],
    );
    return rows;
  },

  /**
   * Put events back in the queue: with `eventIds`, exactly those; without, everything
   * that died. Delivered events are not re-sent by accident.
   */
  async resetOrgEvents({ orgId, eventIds = null }) {
    const ids = Array.isArray(eventIds) && eventIds.length ? eventIds : null;
    const { rowCount } = await this.pool.query(
      `update event_outbox
          set published_at = null,
              dead_at = null,
              attempts = 0,
              next_attempt_at = null,
              last_error = null
        where org_id = $1
          and ($2::uuid[] is not null or dead_at is not null)
          and ($2::uuid[] is null or id = any($2::uuid[]))`,
      [orgId, ids],
    );
    return rowCount;
  },
};
