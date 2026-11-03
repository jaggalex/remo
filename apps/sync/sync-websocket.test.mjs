/**
 * The socket's room name is the board id, decoded exactly once (ADR-148).
 *
 * `setupWSConnection` takes the room from the raw request path. For a board with a
 * non-ASCII name the browser sends `%D0%B7…`, so the socket used to persist a room named
 * `%D0%B7…` while every HTTP route and the access check used `запуск…`. One board became
 * two rows with two sets of widgets, and the encoded twin was projected into
 * `boards`/`widgets` as a phantom board.
 *
 * No database is needed: what is under test is which name reaches `bindState`.
 */
import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachWebSocket } from "./sync-websocket.mjs";
import { websocketUtils } from "./y.mjs";

const { docs, setPersistence } = websocketUtils;

let server = null;
let wss = null;
const cleanups = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => {});
  setPersistence(null);
  for (const name of [...docs.keys()]) {
    if (name.startsWith("test-") || name.startsWith("запуск")) {
      docs.get(name)?.destroy();
      docs.delete(name);
    }
  }
  if (wss) await new Promise((resolve) => wss.close(resolve));
  if (server) await new Promise((resolve) => server.close(resolve));
  wss = null;
  server = null;
});

async function listen(bound, options = {}) {
  setPersistence({
    bindState: (docName) => {
      bound.push(docName);
    },
    writeState: async () => {},
  });

  server = createServer();
  ({ wss } = attachWebSocket({
    server,
    // By default the room exists as a legacy unclaimed board: the repair path must
    // still open it. A test that wants an unknown room passes its own store.
    store: options.store ?? { getIamBoard: async (id) => ({ id, owner_id: null }) },
    metrics: { inc() {} },
    sessionFromRequest: async () => null,
    accessForBoard: options.accessForBoard ?? (async () => ({ access: { allowed: true } })),
    linkUnlockToken: () => null,
    connections: {
      authBySocket: new WeakMap(),
      registerConnection() {},
      unregisterConnection() {},
    },
    saveAcks: { queueSaveAck() {}, dropSocket() {} },
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

function connect(port, room, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${encodeURIComponent(room)}`, {
      headers,
    });
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

it("binds one room, named by the decoded board id", async () => {
  const bound = [];
  const port = await listen(bound);
  const room = "запуск-продукта-c49e0f86";

  const socket = await connect(port, room);
  cleanups.push(() => new Promise((resolve) => {
    socket.on("close", resolve);
    socket.close();
  }));

  // One room, under the id every other route uses — not the percent-encoded path.
  expect(bound).toEqual([room]);
  expect([...docs.keys()]).toEqual([room]);
  expect(docs.has(encodeURIComponent(room))).toBe(false);
});

it("keeps an ASCII board id untouched", async () => {
  const bound = [];
  const port = await listen(bound);
  const room = "test-plain-board-1234";

  const socket = await connect(port, room);
  cleanups.push(() => new Promise((resolve) => {
    socket.on("close", resolve);
    socket.close();
  }));

  expect(bound).toEqual([room]);
});

it("refuses an unknown room instead of creating it", async () => {
  const bound = [];
  const port = await listen(bound, { store: { getIamBoard: async () => null } });

  await expect(connect(port, "test-unknown-room")).rejects.toThrow(/404/);
  expect(bound).toEqual([]);
});

it("refuses an oversized room id before looking it up", async () => {
  const bound = [];
  const port = await listen(bound);

  await expect(connect(port, "x".repeat(201))).rejects.toThrow(/400/);
  expect(bound).toEqual([]);
});

it("still opens an existing unclaimed legacy board", async () => {
  const bound = [];
  const port = await listen(bound, {
    store: { getIamBoard: async (id) => ({ id, owner_id: null }) },
  });

  const socket = await connect(port, "test-legacy-unclaimed");
  cleanups.push(() => new Promise((resolve) => {
    socket.on("close", resolve);
    socket.close();
  }));
  expect(bound).toEqual(["test-legacy-unclaimed"]);
});

it("refuses an upgrade from another origin", async () => {
  // A socket opened by a hostile page would otherwise ride the session cookie; the
  // browser cannot forge Origin, so the handshake is the place to stop it (ADR-062).
  const bound = [];
  const port = await listen(bound);

  await expect(
    connect(port, "test-foreign-origin", { Origin: "https://evil.example" }),
  ).rejects.toThrow(/403/);
  expect(bound).toEqual([]);
});

it("checks access even when a board has no organisation", async () => {
  // The HTTP route keys on `owner_id`; the socket used to require `org_id` too, so a
  // board without one skipped the check and every room was open.
  const bound = [];
  let asked = false;
  const port = await listen(bound, {
    store: { getIamBoard: async () => ({ owner_id: "user-1", org_id: null }) },
    accessForBoard: async () => {
      asked = true;
      return { access: { allowed: false, reason: "AUTH_REQUIRED" } };
    },
  });

  await expect(connect(port, "test-no-org")).rejects.toThrow(/401/);
  expect(asked).toBe(true);
  expect(bound).toEqual([]);
});
