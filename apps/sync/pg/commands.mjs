/**
 * Idempotency records for the command layer (ADR-092), and the outbox rows for the
 * events the command produced (ADR-094).
 *
 * `recordCommandRun` writes both in one transaction: an event exists if and only if the
 * command that produced it was recorded, and a retry with the same key writes neither
 * twice.
 */
import { insertEvents } from "./events.mjs";

export const commandMethods = {
async findCommandRun(boardId, actorId, idempotencyKey) {
  const { rows } = await this.pool.query(
    `select result, version, created_at from command_runs
      where board_id = $1 and actor_id = $2 and idempotency_key = $3`,
    [boardId, actorId, idempotencyKey],
  );
  return rows[0] ?? null;
},

async recordCommandRun({
  boardId,
  orgId = null,
  actorId,
  actorType,
  command,
  idempotencyKey,
  result,
  version,
  events = [],
}) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `insert into command_runs
         (board_id, actor_id, actor_type, command, idempotency_key, result, version)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)
       on conflict (board_id, actor_id, idempotency_key) do nothing
       returning id, result, version`,
      [
        boardId,
        actorId,
        actorType ?? "user",
        command,
        idempotencyKey,
        JSON.stringify(result),
        version,
      ],
    );
    if (rows[0] && events.length) {
      await insertEvents(client, {
        boardId,
        orgId,
        actorId,
        actorType,
        commandRunId: rows[0].id,
        events,
      });
    }
    await client.query("commit");
    if (rows[0]) return { result: rows[0].result, version: rows[0].version, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // A concurrent request recorded the same key while this one waited on the lock.
  const existing = await this.findCommandRun(boardId, actorId, idempotencyKey);
  return { result: existing?.result ?? result, version: existing?.version ?? version, replayed: true };
},
};
