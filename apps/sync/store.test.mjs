/**
 * Durability tests for the Postgres store: log + snapshot + projection.
 *
 * These run against a real database, because the point is to prove the storage
 * layout survives a restart — a mocked pool would test the mock. They skip when no
 * database is reachable, so `pnpm test` still works on a machine without Docker.
 *
 *   docker compose up -d
 *   pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresStore } from "./postgres.mjs";
import { ensureBoard, testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

const database = await testDatabaseStore("postgres store");
const databaseUrl = database?.url ?? null;
const store = database?.store ?? null;
const reachable = store !== null;
const BOARD = `test-store-${Date.now()}`;

const suite = reachable ? describe : describe.skip;

/** Widget ids in a document, so two replicas can be compared meaningfully. */
function shape(doc) {
  return {
    widgets: [...doc.getMap("widgets").keys()].sort(),
    texts: [...doc.getMap("texts").entries()]
      .map(([id, text]) => `${id}:${text.toString()}`)
      .sort(),
    title: doc.getMap("meta").get("title") ?? "",
    kanbanCards: [...doc.getMap("kanbans").entries()]
      .map(([id, kanban]) => `${id}:${kanban.get("cards")?.size ?? 0}`)
      .sort(),
  };
}

suite("postgres store", () => {
  beforeAll(() => {
    if (!reachable) console.warn("skipping store tests: no database reachable");
  });

  afterAll(async () => {
    if (!store) return;
    // Best effort with a deadline: teardown must never hang the suite. Any room
    // still bound here is flushed by the tests themselves. The database itself is
    // thrown away with the run (ADR-131), so only the rows this suite named are cleared.
    const cleanup = (async () => {
      await store.pool.query("delete from boards where id like 'test-store-%'").catch(() => {});
      await store.close().catch(() => {});
    })();
    const deadline = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([cleanup, deadline]);
  }, 15000);

  it("rebuilds a room from the snapshot after the log is folded in", async () => {
    const live = new Y.Doc();
    await ensureBoard(store, BOARD);
    await store.bindState(BOARD, live);

    const widgets = live.getMap("widgets");
    const texts = live.getMap("texts");
    live.getMap("meta").set("title", "Durability");

    // Three separate edits, each logged as its own update.
    live.transact(() => {
      widgets.set("w1", { id: "w1", type: "sticky_note", x: 0, y: 0, width: 161, height: 185 });
      widgets.set("w2", { id: "w2", type: "card", parentId: null, x: 10, y: 10, width: 422, height: 79 });
    });
    const text = new Y.Text();
    text.insert(0, "hello");
    texts.set("w1", text);
    text.insert(5, " world");

    await store.writeState(BOARD, live);

    const { rows } = await store.pool.query(
      "select length(snapshot) as bytes, snapshot_through from boards where id = $1",
      [BOARD],
    );
    expect(rows[0].bytes).toBeGreaterThan(0);
    expect(Number(rows[0].snapshot_through)).toBeGreaterThan(0);

    // Compaction is what folds the log in; nothing may be lost by it.
    const { rows: left } = await store.pool.query(
      "select count(*)::int as n from board_updates where board_id = $1",
      [BOARD],
    );
    expect(left[0].n).toBe(0);

    expect(shape(live)).toEqual({
      widgets: ["w1", "w2"],
      texts: ["w1:hello world"],
      title: "Durability",
      kanbanCards: [],
    });
  });

  it("restores that room into a fresh document, as after a restart", async () => {
    const replica = new Y.Doc();
    const reopened = new PostgresStore({ connectionString: databaseUrl, log: { log() {}, error() {} } });
    await reopened.connect();
    try {
      await ensureBoard(reopened, BOARD);
      await reopened.bindState(BOARD, replica);
      expect(shape(replica)).toEqual({
        widgets: ["w1", "w2"],
        texts: ["w1:hello world"],
        title: "Durability",
        kanbanCards: [],
      });

      // The projection is reconciled on load, so it matches the document too.
      const { rows } = await reopened.pool.query(
        "select count(*)::int as n from widgets where board_id = $1",
        [BOARD],
      );
      expect(rows[0].n).toBe(2);
    } finally {
      await reopened.writeState(BOARD, replica).catch(() => {});
      await reopened.close().catch(() => {});
    }
  });

  it("keeps a stored board title when the document has none", async () => {
    // A board created through the API is a row with a title and an empty document:
    // nobody has renamed it inside the editor yet. Opening it schedules a projection
    // pass, and an empty `meta.title` must not be read as "the name was cleared".
    const room = `${BOARD}-named`;
    await store.pool.query("insert into boards (id, title) values ($1, $2)", [
      room,
      "Quarterly planning",
    ]);
    const doc = new Y.Doc();
    await store.bindState(room, doc);

    const stored = async () =>
      (await store.pool.query("select title from boards where id = $1", [room])).rows[0]?.title;

    await store.refreshProjection(store.rooms.get(room));
    expect(await stored()).toBe("Quarterly planning");

    // A deliberate rename does travel from the document to the row.
    doc.getMap("meta").set("title", "Renamed in the editor");
    await store.refreshProjection(store.rooms.get(room));
    expect(await stored()).toBe("Renamed in the editor");

    await store.writeState(room, doc);
    await store.pool.query("delete from boards where id = $1", [room]);
  }, 15000);

  it("shares one teardown between a closing socket and the next bind", async () => {
    // Every reload closes the last socket of the old document and immediately opens a
    // new one. y-websocket does not await `writeState` before publishing the new room, so
    // the bind and the closing socket can both ask for a teardown. Two teardowns compact
    // the old document twice: the late one reads a watermark that already covers the new
    // room's updates and deletes them, and it may remove the replacement room from the
    // map. One shared teardown makes the overlap order-safe without a timer.
    const room = `${BOARD}-overlap`;
    const oldDoc = new Y.Doc();
    await ensureBoard(store, room);
    await store.bindState(room, oldDoc);
    oldDoc.getMap("meta").set("title", "Overlap");
    oldDoc.getMap("widgets").set("w1", {
      id: "w1",
      type: "sticky_note",
      x: 0,
      y: 0,
      width: 161,
      height: 185,
    });
    await store.flushLog(store.rooms.get(room));

    const originalProjection = store.refreshProjection.bind(store);
    let projections = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    store.refreshProjection = async (target) => {
      projections += 1;
      if (projections === 1) await gate;
      return originalProjection(target);
    };

    // The closing socket starts a teardown and does not wait for it.
    const closing = store.writeState(room, oldDoc);
    // The next page load binds a fresh document while that teardown is mid-flight.
    const replica = new Y.Doc();
    const binding = store.bindState(room, replica);
    release();
    try {
      await Promise.all([closing, binding]);
    } finally {
      store.refreshProjection = originalProjection;
    }

    expect(projections).toBe(1);
    expect([...replica.getMap("widgets").keys()]).toEqual(["w1"]);
    expect(replica.getMap("meta").get("title")).toBe("Overlap");
    // The live room is the replacement, with its own timers intact.
    expect(store.rooms.get(room)?.ydoc).toBe(replica);

    await store.writeState(room, replica);
    await store.pool.query("delete from boards where id = $1", [room]);
  }, 15000);

  it("does not lose an update that lands while the snapshot is being written", async () => {
    // The dangerous window is between encoding the snapshot and reading the log
    // watermark: an update logged in there would be covered by `snapshot_through`
    // without being part of the snapshot, and the delete would discard it. The
    // update is injected deterministically, right after the watermark query returns,
    // so what is under test is the ordering, not the timing.
    const room = `${BOARD}-race`;
    const live = new Y.Doc();
    await ensureBoard(store, room);
    await store.bindState(room, live);
    live.getMap("widgets").set("a", { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10 });
    await store.flushLog(store.rooms.get(room));

    const arriving = new Y.Doc();
    arriving.getMap("widgets").set("b", { id: "b", type: "text", x: 1, y: 1, width: 10, height: 10 });
    const arrivingUpdate = Buffer.from(Y.encodeStateAsUpdate(arriving));

    // A dedicated connection: injecting through the pool would re-enter the code
    // path being intercepted.
    const { default: pg } = await import("pg");
    const injector = new pg.Client({ connectionString: databaseUrl });
    await injector.connect();

    const originalConnect = store.pool.connect.bind(store.pool);
    let injected = false;
    store.pool.connect = async () => {
      const client = await originalConnect();
      const clientQuery = client.query.bind(client);
      client.query = async (sql, params) => {
        if (!injected && /max\(id\)/.test(String(sql))) {
          // An edit arrives exactly here: applied to the document and logged, just
          // as flushLog would do it. This is the window that matters.
          injected = true;
          Y.applyUpdate(live, arrivingUpdate);
          await injector.query("insert into board_updates (board_id, update) values ($1, $2)", [
            room,
            arrivingUpdate,
          ]);
          store.rooms.get(room).pendingUpdates.length = 0;
        }
        return clientQuery(sql, params);
      };
      return client;
    };

    try {
      await store.compact(store.rooms.get(room));
    } finally {
      store.pool.connect = originalConnect;
      await injector.end().catch(() => {});
    }
    expect(injected).toBe(true);

    const reopened = new PostgresStore({ connectionString: databaseUrl, log: { log() {}, error() {} } });
    await reopened.connect();
    try {
      const replica = new Y.Doc();
      await reopened.bindState(room, replica);
      // "a" comes from the snapshot, "b" from the log entry the compaction kept.
      expect([...replica.getMap("widgets").keys()].sort()).toEqual(["a", "b"]);
    } finally {
      await reopened.pool.query("delete from boards where id = $1", [room]).catch(() => {});
      await reopened.close().catch(() => {});
      store.rooms.delete(room);
    }
  }, 15000);
});
