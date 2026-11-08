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
import { afterEach, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { guardPersistence } from "./failure-boundary.mjs";
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
    // Every room here is claimed: an unowned room is closed (ADR-174), so the default
    // must not accidentally test that path. A test for it passes its own store.
    store: options.store ?? { getIamBoard: async (id) => ({ id, owner_id: "owner-1" }) },
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

it("refuses an unowned legacy board before access is even asked", async () => {
  const bound = [];
  let accessAsked = false;
  const port = await listen(bound, {
    store: { getIamBoard: async (id) => ({ id, owner_id: null }) },
    accessForBoard: async () => {
      accessAsked = true;
      return { access: { allowed: true } };
    },
  });

  await expect(connect(port, "test-legacy-unclaimed")).rejects.toThrow(/403/);
  expect(accessAsked).toBe(false);
  expect(bound).toEqual([]);
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

/** A frame ws refuses: reserved bits set on a masked, empty frame. */
const INVALID_FRAME = Buffer.from([0xff, 0x80, 0, 0, 0, 0]);

function closed(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) resolve();
    socket.on("close", resolve);
    socket.on("error", () => {});
  });
}

async function expectStillServing(port) {
  const next = await connect(port, "test-still-serving");
  await new Promise((resolve) => {
    next.on("close", resolve);
    next.close();
  });
}

it("drops only the socket that sent an invalid frame", async () => {
  const port = await listen([]);
  const socket = await connect(port, "test-bad-frame");
  socket._socket.write(INVALID_FRAME);
  await closed(socket);
  await expectStillServing(port);
});

it("refuses a frame above the limit from its header, before reading it", async () => {
  const port = await listen([]);
  const socket = await connect(port, "test-big-frame");
  // A binary frame announcing 17 MiB; ws must refuse it without waiting for the bytes.
  const header = Buffer.alloc(14);
  header[0] = 0x82;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(17 * 1024 * 1024), 2);
  socket._socket.write(header);
  const code = await new Promise((resolve) => {
    socket.on("error", () => {});
    socket.on("close", resolve);
  });
  expect(code).toBe(1009);
  await expectStillServing(port);
});

it("survives frames that decode to nothing", async () => {
  const port = await listen([]);
  // y-websocket logs each frame it cannot decode, and that is the expected path here.
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanups.push(async () => logged.mockRestore());
  const socket = await connect(port, "test-junk-frame");
  for (const frame of [[], [0x80], [0, 0x80], [0, 1, 0xff], [1, 0xff], [10, 0xff], [99]]) {
    socket.send(Buffer.from(frame));
  }
  await new Promise((resolve) => {
    socket.on("close", resolve);
    socket.close();
  });
  await expectStillServing(port);
});

it("survives a connection reset during the access check", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const port = await listen([], {
    store: {
      getIamBoard: async (id) => {
        await gate;
        return { id, owner_id: null };
      },
    },
  });
  let serverSocket;
  server.prependListener("upgrade", (_request, socket) => {
    serverSocket = socket;
  });

  const client = new WebSocket(`ws://127.0.0.1:${port}/test-reset`);
  client.on("error", () => {});
  await vi.waitFor(() => expect(serverSocket).toBeDefined());

  // The real ECONNRESET depends on timing; the event it produces does not. Node removed
  // its own listener before `upgrade`, so without one here this emit throws.
  expect(() => serverSocket.emit("error", new Error("read ECONNRESET"))).not.toThrow();
  serverSocket.destroy();
  release();
  await closed(client);
});

it("closes a socket that joins a room which failed to load", async () => {
  const port = await listen([]);
  setPersistence({
    bindState: guardPersistence(
      { bindState: async () => { throw new Error("database down"); } },
      { metrics: { inc() {} }, log: { error() {} } },
    ).bindState,
    writeState: async () => {},
  });
  const socket = await connect(port, "test-unbound");
  const code = await new Promise((resolve) => socket.on("close", resolve));
  expect(code).toBe(1011);
});
