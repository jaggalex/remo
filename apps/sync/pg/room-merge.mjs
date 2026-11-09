/**
 * Repair the rooms that a percent-encoded path split in two (ADR-148).
 *
 * Before the fix the socket named its room from the raw request path, so a board with a
 * non-ASCII id lived under `%D0%B7…` while every HTTP route used `запуск…`. A database
 * that ran that build can hold both rows: the encoded one with the document, the decoded
 * one as an empty shell created by `bindState` (or the other way round).
 *
 * The repair runs once per start, inside the migration lock, and is idempotent: it looks
 * for `boards.id` values that still contain a percent sequence, decodes exactly one level
 * and merges that row into the decoded board. Nothing is deleted before it is moved; the
 * projection is rebuilt from the merged log on the next load.
 *
 * The document is CRDT state, so "which copy wins" is not a choice: the target keeps its
 * snapshot and the source's snapshot is appended to the log as one more update. Yjs
 * unions updates, so both survive. `snapshot_through` is reset to 0 because the moved
 * updates may carry ids below either watermark; re-applying folded updates is a no-op
 * for Yjs.
 */

/** Tables whose `board_id` is copied before the duplicate row is deleted. */
const SIMPLE = [
  "agent_actions",
  "agent_schedules",
  "agent_task_plans",
  "agent_threads",
  "agent_thread_messages",
  "ai_runs",
  "audit_events",
  "board_link_unlocks",
  "board_updates",
  "comment_threads",
  "comments",
  "vote_sessions",
];

/** Tables with their own uniqueness on top of `board_id`; duplicates are dropped first. */
const SPECIAL = [
  "widgets",
  "kanban_columns",
  "kanban_swimlanes",
  "kanban_cards",
  "board_grants",
  "board_links",
  "command_runs",
  "event_outbox",
  "agent_change_sets",
  "agent_tasks",
  "board_agents",
];

/** An empty Yjs state update is two bytes; anything longer carries content. */
function hasState(snapshot) {
  return Boolean(snapshot && snapshot.length > 2);
}

/** Decode one level, or null when the id is not a URL form at all. */
function decodedOnce(id) {
  try {
    const decoded = decodeURIComponent(id);
    return decoded === id ? null : decoded;
  } catch {
    return null;
  }
}

export const roomMergeMethods = {
  /**
   * Merge every percent-encoded board row into the board id the network now uses.
   * Returns what it did so a test (and the log) can see it; a failure rolls the whole
   * batch back and leaves the database exactly as it was.
   */
  async mergeLegacyRoomIds({ client: provided = null } = {}) {
    const client = provided ?? (await this.pool.connect());
    const merged = [];
    const skipped = [];
    try {
      // One transaction for the whole batch: a merge either completes or leaves the
      // duplicates exactly as they were. The caller's client must not be inside one.
      await client.query("begin");
      const { rows } = await client.query(
        "select id from boards where position('%' in id) > 0 order by id",
      );
      for (const row of rows) {
        const targetId = decodedOnce(row.id);
        if (!targetId) continue;
        const outcome = await this.mergeLegacyRoom(client, row.id, targetId);
        if (outcome.merged) merged.push({ from: row.id, to: targetId });
        else if (outcome.reason) skipped.push({ id: row.id, reason: outcome.reason });
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      if (!provided) client.release();
    }

    for (const { from, to } of merged) {
      this.log.log(`[sync] merged duplicate room ${from} into ${to}`);
    }
    for (const { id, reason } of skipped) {
      this.log.error(`[sync] duplicate room ${id} was not merged: ${reason}`);
    }
    return { merged, skipped };
  },

  /** Merge one encoded row into its decoded id; called inside the caller's transaction. */
  async mergeLegacyRoom(client, sourceId, targetId) {
    const { rows: tables } = await client.query(
      `select table_name from information_schema.columns
        where table_schema = current_schema() and column_name = 'board_id'`,
    );
    const known = new Set([...SIMPLE, ...SPECIAL]);
    const unknown = tables
      .map((table) => table.table_name)
      .filter((table) => !known.has(table));
    // A table this repair does not know about would lose its rows to the cascade when the
    // duplicate board is deleted. Skip and say so instead of deleting data.
    if (unknown.length) {
      return { reason: `unknown board tables: ${unknown.join(", ")}` };
    }

    const { rows } = await client.query(
      `select id, title, snapshot, org_id, team_id, owner_id, visibility, acl_version,
              archived_at, claimed_at, claim_token_hash, agents_enabled, updated_at
         from boards where id = any($1::text[]) order by id for update`,
      [[sourceId, targetId]],
    );
    const source = rows.find((row) => row.id === sourceId);
    const target = rows.find((row) => row.id === targetId) ?? null;
    if (!source) return { reason: "source row disappeared" };
    // Two real boards that only collide after decoding: merging would silently move an
    // owner, so leave both rows for a human.
    if (target?.owner_id && source.owner_id && target.owner_id !== source.owner_id) {
      return { reason: "both rows have different owners" };
    }

    if (!target) {
      await client.query(
        `insert into boards (id, title, icon, snapshot, snapshot_through, org_id, team_id,
                             owner_id, created_by, created_at, visibility, acl_version,
                             archived_at, claimed_at, claim_token_hash, agents_enabled, updated_at)
         select $2, title, icon, snapshot, 0, org_id, team_id, owner_id, created_by, created_at,
                visibility, acl_version, archived_at, claimed_at, claim_token_hash,
                agents_enabled, updated_at
           from boards where id = $1`,
        [sourceId, targetId],
      );
    } else {
      // The source document is not lost: its snapshot becomes one more log entry. The
      // watermark drops to 0 because the moved updates may carry ids below this row's own
      // watermark (the two logs interleave on one sequence); re-applying folded updates is
      // a no-op for Yjs, skipping a moved one would lose an edit.
      if (hasState(source.snapshot)) {
        if (!hasState(target.snapshot)) {
          await client.query("update boards set snapshot = $2 where id = $1", [
            targetId,
            source.snapshot,
          ]);
        } else {
          await client.query(
            "insert into board_updates (board_id, update) values ($1, $2)",
            [targetId, source.snapshot],
          );
        }
      }
      await client.query(
        `update boards set
           snapshot_through = 0,
           title = coalesce(nullif(title, ''), $2),
           org_id = coalesce(org_id, $3),
           team_id = coalesce(team_id, $4),
           owner_id = coalesce(owner_id, $5),
           visibility = case when owner_id is null then coalesce($6, visibility) else visibility end,
           acl_version = greatest(acl_version, $7),
           archived_at = coalesce(archived_at, $8),
           claimed_at = coalesce(claimed_at, $9),
           claim_token_hash = coalesce(claim_token_hash, $10),
           agents_enabled = agents_enabled or $11,
           updated_at = greatest(updated_at, $12)
         where id = $1`,
        [
          targetId,
          source.title ?? "",
          source.org_id,
          source.team_id,
          source.owner_id,
          source.visibility,
          source.acl_version,
          source.archived_at,
          source.claimed_at,
          source.claim_token_hash,
          source.agents_enabled,
          source.updated_at,
        ],
      );
    }

    // One log, one projection, one set of grants and links: the source's rows move to the
    // target. Rows that already exist there are duplicates of the same key, so the source
    // copy is dropped after the move rather than overwriting the target.
    await client.query(
      `delete from widgets w
        where w.board_id = $1
          and exists (select 1 from widgets t where t.board_id = $2 and t.id = w.id)`,
      [sourceId, targetId],
    );
    await client.query("update widgets set board_id = $2 where board_id = $1", [
      sourceId,
      targetId,
    ]);
    // The room agent is a setting with one row per board: keep the target's choice, or
    // adopt the source's when the target has none, then drop the source row.
    await client.query(
      `insert into board_agents (board_id, org_id, agent_id, assigned_by, assigned_at, enabled)
       select $2, org_id, agent_id, assigned_by, assigned_at, enabled
         from board_agents where board_id = $1
       on conflict (board_id) do nothing`,
      [sourceId, targetId],
    );
    await client.query("delete from board_agents where board_id = $1", [sourceId]);
    for (const [table, key] of [
      ["kanban_columns", "id"],
      ["kanban_swimlanes", "id"],
      ["kanban_cards", "card_id"],
    ]) {
      await client.query(
        `delete from ${table} s
          where s.board_id = $1
            and exists (
              select 1 from ${table} t
               where t.board_id = $2 and t.kanban_id = s.kanban_id and t.${key} = s.${key}
            )`,
        [sourceId, targetId],
      );
      await client.query(`update ${table} set board_id = $2 where board_id = $1`, [
        sourceId,
        targetId,
      ]);
    }
    await client.query(
      `delete from board_grants g
        where g.board_id = $1
          and exists (
            select 1 from board_grants t
             where t.board_id = $2 and t.subject_type = g.subject_type and t.subject_id = g.subject_id
          )`,
      [sourceId, targetId],
    );
    await client.query("update board_grants set board_id = $2 where board_id = $1", [
      sourceId,
      targetId,
    ]);
    await client.query(
      `delete from board_links where board_id = $1
        and exists (select 1 from board_links where board_id = $2)`,
      [sourceId, targetId],
    );
    await client.query("update board_links set board_id = $2 where board_id = $1", [
      sourceId,
      targetId,
    ]);
    await client.query(
      `delete from command_runs c
        where c.board_id = $1 and c.idempotency_key is not null
          and exists (
            select 1 from command_runs t
             where t.board_id = $2 and t.actor_id = c.actor_id
               and t.idempotency_key = c.idempotency_key
          )`,
      [sourceId, targetId],
    );
    await client.query("update command_runs set board_id = $2 where board_id = $1", [
      sourceId,
      targetId,
    ]);
    await client.query(
      `delete from event_outbox o
        where o.board_id = $1 and o.dedupe_key is not null
          and exists (
            select 1 from event_outbox t
             where t.board_id = $2 and t.dedupe_key = o.dedupe_key
          )`,
      [sourceId, targetId],
    );
    await client.query("update event_outbox set board_id = $2 where board_id = $1", [
      sourceId,
      targetId,
    ]);

    // Agent tasks and change sets carry a unique `(board_id, created_by,
    // idempotency_key)` index, so a bare move can collide. Keep both records: a shared
    // key is re-keyed on the source, not deleted. Deleting the set would orphan the
    // task's `input.changeSetId` and the runner would fail with CHANGE_SET_MISSING.
    for (const table of ["agent_change_sets", "agent_tasks"]) {
      await client.query(
        `update ${table} s
            set idempotency_key = s.idempotency_key || ':merged:' || s.id::text
          where s.board_id = $1 and s.idempotency_key is not null
            and exists (
              select 1 from ${table} t
               where t.board_id = $2 and t.created_by = s.created_by
                 and t.idempotency_key = s.idempotency_key
            )`,
        [sourceId, targetId],
      );
      await client.query(`update ${table} set board_id = $2 where board_id = $1`, [
        sourceId,
        targetId,
      ]);
    }

    for (const table of SIMPLE) {
      await client.query(`update ${table} set board_id = $2 where board_id = $1`, [
        sourceId,
        targetId,
      ]);
    }

    // Everything now hangs off the target; the duplicate row itself is the only thing
    // left to remove.
    await client.query("delete from boards where id = $1", [sourceId]);
    return { merged: true };
  },
};
