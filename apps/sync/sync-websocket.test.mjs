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

async function listen(bound) {
  setPersistence({
    bindState: (docName) => {
      bound.push(docName);
    },
    writeState: async () => {},
  });

  server = createServer();
  ({ wss } = attachWebSocket({
    server,
    store: { getIamBoard: async () => null },
    metrics: { inc() {} },
    sessionFromRequest: async () => null,
    accessForBoard: async () => ({ access: { allowed: true } }),
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

function connect(port, room) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${encodeURIComponent(room)}`);
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
