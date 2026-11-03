/**
 * A board that a percent-encoded socket path split in two is one board again (ADR-148).
 *
 * The repair runs at every start, inside the migration lock: the encoded row is the one
 * that holds the document, the decoded row is the empty shell the browser's own URL
 * created. Rows move before anything is deleted, and the document is CRDT state — both
 * snapshots survive as a union.
 */
import { describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

const database = await testDatabaseStore("legacy room ids");
const store = database?.store ?? null;
const suite = store ? describe : describe.skip;

const ROOM = "test-merge-запуск-продукта";

function sticky(id, x = 0) {
  return { id, type: "sticky_note", x, y: 0, width: 161, height: 185 };
}

/** Give `room` a document with one sticky, written the way the store writes it. */
async function seedRoom(room, label, widgetId = "w1", x = 0) {
  const seeded = new Y.Doc();
  await store.bindState(room, seeded);
  seeded.getMap("meta").set("title", label);
  seeded.getMap("widgets").set(widgetId, sticky(widgetId, x));
  await store.writeState(room, seeded);
}

suite("legacy room ids", () => {
  it("merges an encoded duplicate into the decoded board and keeps the document", async () => {
    const board = `${ROOM}-${Date.now()}`;
    const encoded = encodeURIComponent(board);
    expect(encoded).not.toBe(board);

    // The shell: exactly what the old socket left behind for the decoded URL.
    await store.pool.query("insert into boards (id, title) values ($1, '')", [board]);
    // The real board, claimed and with the document, under the wire form of the id.
    const live = new Y.Doc();
    await store.bindState(encoded, live);
    live.getMap("meta").set("title", "Запуск продукта");
    live.getMap("widgets").set("w1", sticky("w1", 42));
    await store.writeState(encoded, live);
    const { rows: owners } = await store.pool.query(
      `insert into users (email, password_hash, name)
       values ($1, 'x', 'Owner') on conflict (email) do update set name = excluded.name
       returning id`,
      [`merge-owner-${Date.now()}@example.com`],
    );
    await store.pool.query(
      `update boards set owner_id = $2, acl_version = 2, claimed_at = now() where id = $1`,
      [encoded, owners[0].id],
    );

    const { merged, skipped } = await store.mergeLegacyRoomIds();
    expect(skipped).toEqual([]);
    expect(merged).toContainEqual({ from: encoded, to: board });

    const { rows } = await store.pool.query(
      "select id, title, snapshot, snapshot_through, owner_id, acl_version, claimed_at from boards where id like $1 order by id",
      [`${board}%`],
    );
    expect(rows.map((row) => row.id)).toEqual([board]);
    const row = rows[0];
    expect(Buffer.from(row.snapshot ?? []).length).toBeGreaterThan(2);
    expect(Number(row.snapshot_through)).toBe(0);
    expect(row.owner_id).not.toBeNull();
    expect(Number(row.acl_version)).toBe(2);
    expect(row.claimed_at).not.toBeNull();

    // The move really happened: no child row still names the encoded id.
    for (const table of ["board_updates", "widgets"]) {
      const { rows: left } = await store.pool.query(
        `select count(*)::int as n from ${table} where board_id = $1`,
        [encoded],
      );
      expect(left[0].n).toBe(0);
    }

    // Opening the decoded board (what the browser now does) finds the widget.
    const opened = new Y.Doc();
    await store.bindState(board, opened);
    expect(opened.getMap("meta").get("title")).toBe("Запуск продукта");
    expect(opened.getMap("widgets").get("w1")?.x).toBe(42);

    // The repair is idempotent: a second start has nothing left to merge.
    const again = await store.mergeLegacyRoomIds();
    expect(again.merged).toEqual([]);

    await store.writeState(board, opened);
    await store.pool.query("delete from boards where id = $1", [board]);
    await store.pool.query("delete from users where id = $1", [owners[0].id]);
  }, 20000);

  it("renames an encoded board that has no decoded twin, and keeps its document", async () => {
    // The other shape: nobody ever opened the decoded URL, so only the encoded row exists.
    // Renaming must not lose the child rows either.
    const board = `${ROOM}-only-${Date.now()}`;
    const encoded = encodeURIComponent(board);
    await seedRoom(encoded, "Только закодированная");

    const { merged } = await store.mergeLegacyRoomIds();
    expect(merged).toContainEqual({ from: encoded, to: board });

    const opened = new Y.Doc();
    await store.bindState(board, opened);
    expect(opened.getMap("widgets").get("w1")?.id).toBe("w1");

    await store.writeState(board, opened);
    await store.pool.query("delete from boards where id = $1", [board]);
  }, 20000);

  it("keeps both documents when the two rows each have state", async () => {
    // A merge is a CRDT union, not a choice: the target keeps its snapshot and the
    // source's snapshot is appended as one more update, so neither document is dropped.
    const board = `${ROOM}-both-${Date.now()}`;
    const encoded = encodeURIComponent(board);
    await seedRoom(board, "Decoded copy", "w1", 1);
    await seedRoom(encoded, "Encoded copy", "w2", 2);

    const { merged } = await store.mergeLegacyRoomIds();
    expect(merged).toContainEqual({ from: encoded, to: board });

    const opened = new Y.Doc();
    await store.bindState(board, opened);
    expect([...opened.getMap("widgets").keys()].sort()).toEqual(["w1", "w2"]);

    await store.writeState(board, opened);
    await store.pool.query("delete from boards where id = $1", [board]);
  }, 20000);

  it("does not skip a moved update whose id is below the other row's watermark", async () => {
    // The two rows share one update sequence, so the target can have compacted *after* the
    // source's newest log row was written. Carrying the watermark over would make the
    // loader skip that row and lose the edit; the merge resets it to 0.
    const board = `${ROOM}-watermark-${Date.now()}`;
    const encoded = encodeURIComponent(board);

    // The source: a snapshot with w1, plus one log row that only carries w2.
    const base = new Y.Doc();
    base.getMap("widgets").set("w1", sticky("w1", 1));
    const withW2 = new Y.Doc();
    Y.applyUpdate(withW2, Y.encodeStateAsUpdate(base));
    withW2.getMap("widgets").set("w2", sticky("w2", 2));
    await store.pool.query(
      "insert into boards (id, title, snapshot, snapshot_through) values ($1, 'Encoded', $2, 0)",
      [encoded, Buffer.from(Y.encodeStateAsUpdate(base))],
    );
    await store.pool.query("insert into board_updates (board_id, update) values ($1, $2)", [
      encoded,
      Buffer.from(Y.encodeStateAsUpdate(withW2)),
    ]);

    // The target, compacted afterwards: its watermark is now above that log row's id.
    await seedRoom(board, "Decoded", "w3", 3);
    const { rows: watermark } = await store.pool.query(
      "select snapshot_through from boards where id = $1",
      [board],
    );
    expect(Number(watermark[0].snapshot_through)).toBeGreaterThan(0);

    const { merged } = await store.mergeLegacyRoomIds();
    expect(merged).toContainEqual({ from: encoded, to: board });

    const opened = new Y.Doc();
    await store.bindState(board, opened);
    expect([...opened.getMap("widgets").keys()].sort()).toEqual(["w1", "w2", "w3"]);

    await store.writeState(board, opened);
    await store.pool.query("delete from boards where id = $1", [board]);
  }, 20000);

  it("leaves a board alone when its duplicate has a different owner", async () => {
    // Two claims on names that only collide after decoding are two real boards; moving
    // one under the other would change who owns what without anybody asking.
    const board = `${ROOM}-owned-${Date.now()}`;
    const encoded = encodeURIComponent(board);
    const { rows: users } = await store.pool.query("select id from users limit 2");
    if (users.length < 2) return;
    await store.pool.query("insert into boards (id, title, owner_id) values ($1, 'A', $2)", [
      board,
      users[0].id,
    ]);
    await store.pool.query("insert into boards (id, title, owner_id) values ($1, 'B', $2)", [
      encoded,
      users[1].id,
    ]);

    const { merged, skipped } = await store.mergeLegacyRoomIds();
    expect(merged).toEqual([]);
    expect(skipped.some((entry) => entry.id === encoded)).toBe(true);

    const { rows } = await store.pool.query("select id from boards where id = any($1::text[])", [
      [board, encoded],
    ]);
    expect(rows).toHaveLength(2);

    await store.pool.query("delete from boards where id = any($1::text[])", [[board, encoded]]);
  }, 20000);

  it("merges agent tasks and change sets that share an idempotency key", async () => {
    // The idempotency index is (board_id, created_by, idempotency_key). A bare move of
    // two rows with the same key would raise 23505 and roll back the whole batch, so the
    // repair drops the source duplicate first.
    const board = `${ROOM}-agent-${Date.now()}`;
    const encoded = encodeURIComponent(board);
    await store.pool.query("insert into boards (id, title) values ($1, '')", [board]);
    await seedRoom(encoded, "Agent copy");

    const { rows: owners } = await store.pool.query(
      `insert into users (email, password_hash, name)
       values ($1, 'x', 'Agent Owner') on conflict (email) do update set name = excluded.name
       returning id`,
      [`merge-agent-${Date.now()}@example.com`],
    );
    const owner = owners[0].id;
    const { rows: orgs } = await store.pool.query(
      "insert into orgs (name, slug, created_by) values ('Merge', $1, $2) returning id",
      [`merge-agent-${Date.now()}`, owner],
    );
    const orgId = orgs[0].id;
    const { rows: agents } = await store.pool.query(
      `insert into agents (org_id, owner_id, name, created_by)
       values ($1, $2, 'Scout', $2) returning id`,
      [orgId, owner],
    );
    const agentId = agents[0].id;

    for (const boardId of [board, encoded]) {
      await store.pool.query(
        `insert into agent_change_sets
           (org_id, board_id, agent_id, created_by, operations, idempotency_key)
         values ($1, $2, $3, $4, '[]'::jsonb, 'same-key')`,
        [orgId, boardId, agentId, owner],
      );
      await store.pool.query(
        `insert into agent_tasks
           (org_id, board_id, agent_id, intent, created_by, idempotency_key, change_set_id)
         values ($1, $2, $3, 'intent', $4, 'same-key',
                 (select id from agent_change_sets
                   where board_id = $2 and idempotency_key = 'same-key'))`,
        [orgId, boardId, agentId, owner],
      );
    }

    const { merged, skipped } = await store.mergeLegacyRoomIds();
    expect(skipped).toEqual([]);
    expect(merged).toContainEqual({ from: encoded, to: board });

    const { rows: tasks } = await store.pool.query(
      "select board_id, change_set_id from agent_tasks where org_id = $1",
      [orgId],
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].board_id).toBe(board);
    expect(tasks[0].change_set_id).not.toBeNull();
    const { rows: sets } = await store.pool.query(
      "select board_id from agent_change_sets where org_id = $1",
      [orgId],
    );
    expect(sets).toEqual([{ board_id: board }]);

    await store.pool.query("delete from boards where id = $1", [board]);
    await store.pool.query("delete from orgs where id = $1", [orgId]);
    await store.pool.query("delete from users where id = $1", [owner]);
  }, 20000);
});
