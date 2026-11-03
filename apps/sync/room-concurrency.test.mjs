/**
 * One room per board, and a projection that can be replayed (ADR-148).
 *
 * A board is opened from two directions at once: the browser's socket (`bindState`) and
 * an HTTP route (`roomDocument` — a command, an agent task, a backup). Two loads used to
 * build two room objects with two documents, each with its own projection pass, and the
 * two full passes raced on the same rows: the second insert failed on `widgets_pkey`
 * and the mirror kept whichever document committed last.
 *
 * These run against a real database, because the failure is a Postgres constraint, not a
 * JavaScript ordering accident. They skip when no test server is reachable (ADR-131).
 */
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

const database = await testDatabaseStore("room concurrency");
const store = database?.store ?? null;
const suite = store ? describe : describe.skip;

let sequence = 0;
/** A board name unique to one test, so suites can run beside each other. */
function boardId(label) {
  sequence += 1;
  return `test-room-${label}-${Date.now()}-${sequence}`;
}

function sticky(id, x = 0) {
  return { id, type: "sticky_note", x, y: 0, width: 161, height: 185 };
}

const silent = { log() {}, error() {} };

suite("room lifecycle", () => {
  afterAll(async () => {
    if (!store) return;
    // The database is thrown away with the run (ADR-131); only the rows this suite
    // named are cleared, best effort, so a failure here cannot hang the suite.
    const cleanup = (async () => {
      await store.pool
        .query("delete from boards where id like 'test-room-%'")
        .catch(() => {});
      await store.close().catch(() => {});
    })();
    const deadline = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([cleanup, deadline]);
  }, 15000);

  it("gives the socket and an HTTP read one room when both load at once", async () => {
    // The socket binds `socketDoc`; at the same moment an HTTP route asks for the same
    // board's document. Exactly one of them may own the room, and the other must get
    // that same document — otherwise the HTTP caller writes into a document nobody
    // persists, and both rooms project.
    const board = boardId("parallel");
    const seed = new Y.Doc();
    await store.bindState(board, seed);
    seed.getMap("widgets").set("w1", sticky("w1"));
    await store.writeState(board, seed);

    for (let round = 0; round < 10; round += 1) {
      const socketDoc = new Y.Doc();
      const [, httpDoc] = await Promise.all([
        store.bindState(board, socketDoc),
        store.roomDocument(board),
      ]);

      expect(store.rooms.get(board)?.ydoc).toBe(socketDoc);
      expect(httpDoc).toBe(socketDoc);
      // The loser must not have loaded a rival copy: the stored widget is in it.
      expect(httpDoc.getMap("widgets").has("w1")).toBe(true);

      await store.writeState(board, socketDoc);
      expect(store.rooms.has(board)).toBe(false);
    }

    await store.pool.query("delete from boards where id = $1", [board]);
  }, 30000);

  it("projects the same document while a rival row lands, without a duplicate key", async () => {
    // The exact interleaving behind `duplicate key … widgets_pkey`: a second writer
    // inserts the row after this pass deleted the old one and before it inserts. The
    // projection must replay as an upsert — the document, not the constraint, decides
    // the row.
    const board = boardId("idempotent");
    const doc = new Y.Doc();
    await store.bindState(board, doc);
    doc.getMap("widgets").set("w1", sticky("w1", 10));

    const { default: pg } = await import("pg");
    const rival = new pg.Client({ connectionString: database.url });
    await rival.connect();

    const originalConnect = store.pool.connect.bind(store.pool);
    const errors = [];
    const originalLog = store.log;
    let injected = false;
    store.pool.connect = async () => {
      const client = await originalConnect();
      const query = client.query.bind(client);
      // Keep both shapes node-postgres uses: the promise API of `client.query` and the
      // callback API `pool.query` drives it with.
      client.query = (...args) => {
        const callback = typeof args.at(-1) === "function" ? args.pop() : null;
        const run = (async () => {
          const result = await query(...args);
          // The full pass deletes by absence and then upserts; the rival row lands in
          // that gap, exactly as a second writer's row would.
          if (!injected && /^delete from widgets/i.test(String(args[0]))) {
            injected = true;
            await rival.query(
              `insert into widgets (board_id, id, type, x, y, width, height)
               values ($1, 'w1', 'sticky_note', 999, 0, 1, 1)`,
              [board],
            );
          }
          return result;
        })();
        if (!callback) return run;
        void run.then(
          (result) => callback(null, result),
          (error) => callback(error),
        );
        return undefined;
      };
      return client;
    };
    store.log = { log() {}, error: (...args) => errors.push(args.join(" ")) };

    try {
      await store.refreshProjection(store.rooms.get(board));
    } finally {
      store.pool.connect = originalConnect;
      store.log = originalLog;
      await rival.end().catch(() => {});
    }

    expect(injected).toBe(true);
    expect(errors).toEqual([]);
    const { rows } = await store.pool.query(
      "select x, type from widgets where board_id = $1 and id = 'w1'",
      [board],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].x)).toBe(10);

    await store.writeState(board, doc);
    await store.pool.query("delete from boards where id = $1", [board]);
  }, 15000);

  it("does not let a retired room project over the live mirror", async () => {
    // A reload replaces the document while the old one may still have a projection
    // timer (or an update) buffered. That pass reads the *old* document; letting it
    // write would put a stale row over the state the new room already committed.
    const board = boardId("retired");
    const oldDoc = new Y.Doc();
    await store.bindState(board, oldDoc);
    const oldRoom = store.rooms.get(board);
    oldDoc.getMap("widgets").set("w1", sticky("w1", 10));
    await store.flushLog(oldRoom);

    const liveDoc = new Y.Doc();
    await store.bindState(board, liveDoc);
    expect(store.rooms.get(board)?.ydoc).toBe(liveDoc);
    expect(liveDoc.getMap("widgets").get("w1")?.x).toBe(10);

    oldDoc.getMap("widgets").set("w1", sticky("w1", 999));
    await store.refreshProjection(oldRoom);

    const { rows } = await store.pool.query(
      "select x from widgets where board_id = $1 and id = 'w1'",
      [board],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].x)).toBe(10);

    await store.writeState(board, liveDoc);
    await store.pool.query("delete from boards where id = $1", [board]);
  }, 15000);

  it("ignores a teardown asked for by a document that is no longer the room's", async () => {
    // y-websocket calls `writeState` when the last socket of a document closes and does
    // not await it. By the time it runs, the reload may already have bound a
    // replacement: tearing *that* down would drop a live room with open sockets.
    const board = boardId("stale-teardown");
    const socketDoc = new Y.Doc();
    await store.bindState(board, socketDoc);

    const replacement = new Y.Doc();
    await store.bindState(board, replacement);
    expect(store.rooms.get(board)?.ydoc).toBe(replacement);

    await store.writeState(board, socketDoc);
    expect(store.rooms.get(board)?.ydoc).toBe(replacement);

    await store.writeState(board, replacement);
    await store.pool.query("delete from boards where id = $1", [board]);
  }, 15000);
});
