/**
 * The mail outbox and the tokens behind its links (ADR-246, `spec/mail.md` §3).
 *
 * These tables are global like `users` and `sessions`: a letter belongs to an account,
 * not to a room, so none of these queries runs under a tenant. The sealed parameters are
 * cleared in the same statement that records the outcome, so a sent or dead row never
 * keeps a usable link.
 */

/**
 * `decryptSecret` reads `scope/scope_id/provider/id`; the outbox keeps the sealed parts
 * under `sealed_*`. This is the only place that maps one to the other (spec §3).
 */
export function sealedMailRow(row) {
  return {
    scope: "user",
    scope_id: row.user_id ?? "none",
    provider: "mail",
    id: row.id,
    ciphertext: row.sealed_ciphertext,
    nonce: row.sealed_nonce,
    dek_wrapped: row.sealed_dek_wrapped,
    dek_nonce: row.sealed_dek_nonce,
    kek_id: row.sealed_kek_id,
  };
}

export const mailMethods = {
  /** The id comes from the caller: it is the AAD of the sealed parameters (ADR-246). */
  async enqueueMail({
    id,
    userId = null,
    toEmail,
    template,
    locale,
    params = {},
    sealed = null,
    validUntil = null,
  }) {
    await this.pool.query(
      `insert into mail_outbox
         (id, user_id, to_email, template, locale, params, valid_until,
          sealed_ciphertext, sealed_nonce, sealed_dek_wrapped, sealed_dek_nonce, sealed_kek_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        userId,
        toEmail,
        template,
        locale,
        JSON.stringify(params),
        validUntil,
        sealed?.ciphertext ?? null,
        sealed?.nonce ?? null,
        sealed?.dekWrapped ?? null,
        sealed?.dekNonce ?? null,
        sealed?.kekId ?? null,
      ],
    );
    return { id };
  },

  /** `spec/mail.md` §4: the claim marks a five-minute lease, not a row lock. */
  async claimMailBatch(limit = 10) {
    const { rows } = await this.pool.query("select * from remo_claim_mail_batch($1)", [limit]);
    return rows;
  },

  async markMailSent(id, providerId = null) {
    await this.pool.query(
      `update mail_outbox
          set sent_at = now(),
              provider_id = $2,
              next_attempt_at = null,
              last_error = null,
              sealed_ciphertext = null,
              sealed_nonce = null,
              sealed_dek_wrapped = null,
              sealed_dek_nonce = null,
              sealed_kek_id = null
        where id = $1`,
      [id, providerId],
    );
  },

  async markMailRetry(id, { attempts, error = null, nextAttemptAt = null }) {
    await this.pool.query(
      `update mail_outbox
          set attempts = $2,
              last_error = left($3, 500),
              next_attempt_at = $4::timestamptz
        where id = $1`,
      [id, attempts, error, nextAttemptAt],
    );
  },

  async markMailDead(id, { attempts, error = null }) {
    await this.pool.query(
      `update mail_outbox
          set attempts = $2,
              last_error = left($3, 500),
              dead_at = now(),
              next_attempt_at = null,
              sealed_ciphertext = null,
              sealed_nonce = null,
              sealed_dek_wrapped = null,
              sealed_dek_nonce = null,
              sealed_kek_id = null
        where id = $1`,
      [id, attempts, error],
    );
  },

  /** Return rows claimed by mistake to the queue without waiting out the lease. */
  async releaseMailClaim(ids) {
    if (!ids?.length) return 0;
    const { rowCount } = await this.pool.query(
      `update mail_outbox
          set next_attempt_at = null
        where id = any($1::uuid[]) and sent_at is null and dead_at is null`,
      [ids],
    );
    return rowCount;
  },

  /** The gauge behind `remo_mail_queue_depth` (`spec/mail.md` §4). */
  async mailQueueDepth() {
    const { rows } = await this.pool.query(
      "select count(*)::int as n from mail_outbox where sent_at is null and dead_at is null",
    );
    return rows[0]?.n ?? 0;
  },

  /** What `pnpm mail:dead` lists: the dead letters and the code that buried them. */
  async listDeadMail(limit = 50) {
    const { rows } = await this.pool.query(
      `select id, template, locale, attempts, last_error, dead_at
         from mail_outbox
        where dead_at is not null
        order by dead_at desc, id
        limit $1`,
      [limit],
    );
    return rows;
  },

  /**
   * Put a dead letter back only while its sealed link still exists, or when the template
   * needs no link at all. Every ordinary death clears the link on purpose (ADR-246), so
   * this is a repair for a row buried by an older release — not a way to resend a secret
   * that was deliberately removed.
   */
  async retryDeadMail(id) {
    const { rowCount } = await this.pool.query(
      `update mail_outbox
          set dead_at = null,
              attempts = 0,
              next_attempt_at = null,
              last_error = null
        where id = $1
          and dead_at is not null
          and (sealed_ciphertext is not null or template = 'password_changed')`,
      [id],
    );
    return rowCount > 0;
  },

  /**
   * A new token of the same purpose voids the old ones in the same transaction, so a
   * second "forgot password" click leaves exactly one working link (`spec/mail.md` §5.1,
   * §8). Another purpose is left alone: a reset request must not kill a verify link.
   */
  async issueAuthToken({ id, userId, purpose, tokenHash, email, expiresAt }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update auth_tokens
            set used_at = now()
          where user_id = $1 and purpose = $2 and used_at is null`,
        [userId, purpose],
      );
      await client.query(
        `insert into auth_tokens (id, user_id, purpose, token_hash, email, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, userId, purpose, tokenHash, email, expiresAt],
      );
      await client.query("commit");
      return { id };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * The one transaction behind `POST /auth/password/reset` (`spec/mail.md` §5.2). The
   * locked token decides the answer: a missing or used row is rejected, an expired one
   * is reported without being marked used (so the caller can say "request a new link"
   * instead of "invalid"), and only a live one changes the password. Every session ends
   * because the old password is gone, and the address is confirmed only when the token
   * still names the account's current address — otherwise the token proves nothing about
   * the new one.
   */
  async completePasswordReset({ tokenHash, passwordHash }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `select id, user_id, email, expires_at, used_at, (expires_at <= now()) as expired
           from auth_tokens
          where token_hash = $1
          for update`,
        [tokenHash],
      );
      const token = rows[0];
      if (!token || token.used_at) {
        await client.query("rollback");
        return { status: "invalid" };
      }
      if (token.expired) {
        await client.query("rollback");
        return { status: "expired" };
      }
      await client.query(
        `update users
            set password_hash = $2,
                updated_at = now(),
                email_verified_at = case when email = $3
                                         then coalesce(email_verified_at, now())
                                         else email_verified_at end
          where id = $1`,
        [token.user_id, passwordHash, token.email],
      );
      await client.query(
        `update auth_tokens
            set used_at = now()
          where user_id = $1 and purpose = 'password_reset' and used_at is null`,
        [token.user_id],
      );
      await client.query(
        `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
        [token.user_id],
      );
      await client.query("commit");
      return { status: "ok", userId: token.user_id, email: token.email };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * The caller knows which kind of token it expects, so the purpose is part of the key:
   * the table holds reset and verification rows side by side.
   */
  async findAuthToken(tokenHash, purpose) {
    const { rows } = await this.pool.query(
      `select * from auth_tokens where token_hash = $1 and purpose = $2`,
      [tokenHash, purpose],
    );
    return rows[0] ?? null;
  },

  /** False means the token was already spent: a link works once (`spec/mail.md` §8). */
  async consumeAuthToken(id) {
    const { rowCount } = await this.pool.query(
      `update auth_tokens set used_at = now() where id = $1 and used_at is null`,
      [id],
    );
    return rowCount > 0;
  },

  /**
   * The address must still be the account's own: a token issued before an address change
   * must not confirm the new one (`spec/mail.md` §3). A mismatch writes nothing.
   */
  async setEmailVerified(userId, email) {
    const { rowCount } = await this.pool.query(
      `update users set email_verified_at = coalesce(email_verified_at, now())
        where id = $1 and email = $2`,
      [userId, email],
    );
    return rowCount > 0;
  },

  /**
   * The hourly retention pass: 30 days of letters, 7 days of tokens. Bounded to 1000 rows
   * per table so one pass never holds a long lock, like the other operator cleanups.
   */
  async purgeMailRows({ mailCutoff, tokenCutoff }) {
    const mail = await this.pool.query(
      `delete from mail_outbox
        where id in (select id from mail_outbox where created_at < $1 order by created_at limit 1000)`,
      [mailCutoff],
    );
    const tokens = await this.pool.query(
      `delete from auth_tokens
        where id in (
          select id from auth_tokens
           where created_at < $1
             and (used_at is not null or expires_at < now())
           order by created_at
           limit 1000
        )`,
      [tokenCutoff],
    );
    return { mail: mail.rowCount, tokens: tokens.rowCount };
  },
};
