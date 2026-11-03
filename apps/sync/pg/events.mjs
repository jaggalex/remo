/**
 * The transactional outbox for domain events (ADR-094), and the retry ladder that the
 * webhook consumer drives (ADR-095).
 *
 * `insertEvents` is called with the client of the command transaction, so the event and
 * the idempotency row land together or not at all. `drainEvents` holds the due rows and
 * records each outcome — delivered, retry later, or dead — in the same transaction.
 */
export async function insertEvents(
  client,
  { boardId, orgId = null, actorId = null, actorType = "user", commandRunId = null, events },
) {
  let written = 0;
  for (const event of events) {
    const inserted = await client.query(
      // `clock_timestamp()`, not the transaction's `now()`: events written in one batch
      // keep their order, which is what the drain promises (ADR-094, ADR-097).
      `insert into event_outbox
         (board_id, org_id, actor_id, actor_type, type, subject, payload, command_run_id,
          dedupe_key, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, clock_timestamp())
       on conflict do nothing
       returning id`,
      [
        boardId,
        orgId,
        actorId,
        actorType,
        event.type,
        event.subject ?? null,
        JSON.stringify(event.payload ?? {}),
        commandRunId,
        event.dedupeKey ?? null,
      ],
    );
    written += inserted.rows.length;
  }
  return written;
}

export const eventMethods = {
  /**
   * Write events outside a command: an agent's change set (ADR-097). Deduplication is the
   * caller's `dedupeKey`, so a resumed or replayed run cannot emit the same action twice.
   */
  async recordEvents({ boardId, orgId = null, actorId = null, actorType = "agent", events }) {
    if (!events?.length) return 0;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const written = await insertEvents(client, {
        boardId,
        orgId,
        actorId,
        actorType,
        events,
      });
      await client.query("commit");
      return written;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Deliver the events that are due and record what happened to each one.
   *
   * `for update skip locked` lets a second worker take other rows instead of waiting.
   * The row lock is held for one delivery (the consumer's timeout is short), which is
   * what makes "delivered" and "recorded as delivered" the same transaction.
   *
   * `handle` throws to ask for a retry. Nothing is thrown out of this method for a failed
   * delivery: a consumer outage must not lose the attempt count that proves it happened.
   */
  async drainEvents({ limit = 20, handle, maxAttempts = 8, delayMs = () => 1000 }) {
    const client = await this.pool.connect();
    let delivered = 0;
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `select id, board_id, org_id, actor_id, actor_type, type, subject, payload,
                occurred_at, attempts
           from event_outbox
          where published_at is null
            and dead_at is null
            and (next_attempt_at is null or next_attempt_at <= now())
          order by occurred_at, id
          limit $1
          for update skip locked`,
        [limit],
      );
      for (const row of rows) {
        let failure = null;
        try {
          await handle(row);
        } catch (error) {
          failure = error?.message ?? String(error);
        }
        if (!failure) {
          await client.query(
            `update event_outbox
                set published_at = now(), attempts = attempts + 1, last_error = null
              where id = $1`,
            [row.id],
          );
          delivered += 1;
          continue;
        }
        const attempts = row.attempts + 1;
        if (attempts >= maxAttempts) {
          // The dead-letter queue is a column: the row stays visible and replayable.
          await client.query(
            `update event_outbox
                set attempts = $2, last_error = $3, dead_at = now(), next_attempt_at = null
              where id = $1`,
            [row.id, attempts, failure],
          );
        } else {
          await client.query(
            `update event_outbox
                set attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' milliseconds')::interval
              where id = $1`,
            [row.id, attempts, failure, String(Math.max(0, delayMs(attempts)))],
          );
        }
      }
      await client.query("commit");
      return { delivered, seen: rows.length };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** A board's events for its own readers and tests; never includes board content. */
  async listBoardEvents(boardId, limit = 50) {
    const { rows } = await this.pool.query(
      `select id, type, subject, payload, actor_id, actor_type, occurred_at, published_at
         from event_outbox
        where board_id = $1
        order by occurred_at, id
        limit $2`,
      [boardId, limit],
    );
    return rows;
  },
};
