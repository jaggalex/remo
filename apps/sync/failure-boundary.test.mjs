/**
 * One failure stays one failure (ADR-160). No database or socket is needed: what is under
 * test is that the library's fire-and-forget calls can no longer reject.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { guardPersistence, installProcessGuards, isUnboundRoom } from "./failure-boundary.mjs";
import { PostgresStore } from "./postgres.mjs";
import { createConnections } from "./sync-connections.mjs";
import { Y } from "./y.mjs";

const silent = { log() {}, error() {} };
const metrics = () => ({ inc: vi.fn() });

function fakeSocket() {
  return { close: vi.fn() };
}

describe("persistence called by y-websocket", () => {
  it("closes the sockets of a room that failed to load and refuses to treat it as bound", async () => {
    const counter = metrics();
    const guarded = guardPersistence(
      { bindState: async () => { throw new Error("database down"); } },
      { metrics: counter, log: silent },
    );
    const socket = fakeSocket();
    const ydoc = { conns: new Map([[socket, new Set()]]) };

    await expect(guarded.bindState("board", ydoc)).resolves.toBeUndefined();

    expect(socket.close).toHaveBeenCalledWith(1011, "room unavailable");
    expect(isUnboundRoom(ydoc)).toBe(true);
    expect(counter.inc).toHaveBeenCalledWith("remo_store_write_errors_total");
  });

  it("leaves a room that loaded alone", async () => {
    const guarded = guardPersistence(
      { bindState: async () => {} },
      { metrics: metrics(), log: silent },
    );
    const socket = fakeSocket();
    const ydoc = { conns: new Map([[socket, new Set()]]) };

    await guarded.bindState("board", ydoc);

    expect(socket.close).not.toHaveBeenCalled();
    expect(isUnboundRoom(ydoc)).toBe(false);
  });

  it("starts the load synchronously, before y-websocket hands the document to a socket", () => {
    const bindState = vi.fn(async () => {});
    guardPersistence({ bindState }, { metrics: metrics(), log: silent }).bindState("board", {});
    expect(bindState).toHaveBeenCalledOnce();
  });

  it("resolves a failed flush, so y-websocket still destroys the document", async () => {
    const guarded = guardPersistence(
      { writeState: async () => { throw new Error("database down"); } },
      { metrics: metrics(), log: silent },
    );
    await expect(guarded.writeState("board", {})).resolves.toBeUndefined();
  });
});

describe("the process guards", () => {
  it("counts a rejection and keeps serving", () => {
    const target = new EventEmitter();
    const counter = metrics();
    const onFatal = vi.fn();
    installProcessGuards({ metrics: counter, onFatal, log: silent, target });

    target.emit("unhandledRejection", new Error("forgotten promise"));

    expect(counter.inc).toHaveBeenCalledWith("remo_background_failures_total");
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("treats an uncaught exception as fatal", () => {
    const target = new EventEmitter();
    const onFatal = vi.fn();
    installProcessGuards({ metrics: metrics(), onFatal, log: silent, target });

    target.emit("uncaughtException", new Error("half-finished change"));

    expect(onFatal).toHaveBeenCalledOnce();
  });
});

describe("a room while the database fails", () => {
  function storeWith(pool) {
    const store = new PostgresStore({ connectionString: "unused", log: silent });
    store.pool = pool;
    return store;
  }
  const noConnection = async () => { throw new Error("connection timeout"); };

  function openRoom(store, name = "board") {
    const ydoc = new Y.Doc();
    store.attachRoom(name, ydoc);
    const room = store.rooms.get(name);
    clearTimeout(room.projectionTimer);
    room.projectionTimer = null;
    return room;
  }

  it("still acknowledges a durable batch when the compaction check fails", async () => {
    const query = vi.fn(async (sql) => {
      if (sql.startsWith("select count")) throw new Error("connection lost");
      return { rows: [] };
    });
    const store = storeWith({ query });
    store.onPersisted = vi.fn();
    const room = openRoom(store);
    room.pendingUpdates.push(Buffer.from([1]));

    await expect(store.flushLog(room)).resolves.toBeUndefined();

    expect(store.onPersisted).toHaveBeenCalledWith("board");
  });

  it("releases the write flag when a projection cannot get a connection", async () => {
    const store = storeWith({ connect: noConnection });
    const room = openRoom(store);

    await expect(store.refreshProjection(room)).resolves.toBeUndefined();

    expect(room.writing).toBe(false);
  });

  it("survives a compaction that cannot get a connection", async () => {
    const store = storeWith({ connect: noConnection });
    await expect(store.compact(openRoom(store))).resolves.toBeUndefined();
  });

  it("writes a backlog in bounded batches instead of failing on the parameter limit", async () => {
    const query = vi.fn(async () => ({ rows: [{ pending: 0 }] }));
    const store = storeWith({ query });
    store.onPersisted = vi.fn();
    const room = openRoom(store);
    for (let index = 0; index < 1500; index += 1) room.pendingUpdates.push(Buffer.from([index % 255]));

    await store.flushLog(room);
    clearTimeout(room.logTimer);

    expect(query.mock.calls[0][1]).toHaveLength(1001);
    expect(room.pendingUpdates).toHaveLength(500);
    // The rest is not on disk yet, so nothing may be acknowledged.
    expect(store.onPersisted).not.toHaveBeenCalled();
  });

  it("opens a room whose document holds a value the mirror cannot read", () => {
    const store = storeWith({ connect: noConnection });
    const ydoc = new Y.Doc();
    ydoc.getMap("kanbans").set("x", 1);
    store.attachRoom("poisoned", ydoc);
    const room = store.rooms.get("poisoned");
    clearTimeout(room.projectionTimer);
    expect(room).toBeDefined();
  });
});

describe("the connection sweep", () => {
  it("does not reject when closing a socket throws", async () => {
    const connections = createConnections({
      store: {
        findSession: async () => null,
        getIamBoard: async () => null,
      },
      accessForBoard: async () => null,
      log: silent,
      sweepMs: 1_000_000,
    });
    connections.stopSweep();
    connections.registerConnection("board", {
      sessionHash: "hash",
      socket: { close() { throw new Error("socket is still connecting"); } },
    });

    await expect(connections.sweepOnce()).resolves.toBeUndefined();
  });
});
