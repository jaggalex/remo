/**
 * The board socket (ADR-016, ADR-062).
 *
 * y-websocket carries the room; the access decision taken at upgrade time decides what
 * the socket may do. A viewer or a public link is read-only: it receives the document and
 * sends cursors, nothing else. One extra step over y-websocket's default is needed — the
 * server must ask a reconnecting client for its state, or updates made while offline
 * would never arrive.
 */
import { WebSocketServer } from "ws";
import { guardReadOnly } from "./readonly.mjs";
import { createWsQuota, guardQuota, quotaSettings } from "./ws-quota.mjs";
import { decodeSaveAck, isSyncStep1, isSyncStep2, SAVE_ACK_MESSAGE } from "./save-ack.mjs";
import { Y, encoding, websocketUtils } from "./y.mjs";
import { failUpgrade, roomFromRequestUrl } from "./http-boundary.mjs";
import { originAllowed } from "./csrf.mjs";
import { isUnboundRoom } from "./failure-boundary.mjs";

const { getYDoc, setupWSConnection } = websocketUtils;

/** A room id is a board slug; anything longer is not a board this service created. */
const MAX_ROOM_ID = 200;

/**
 * The largest frame a client may send (ADR-160). ws buffers a frame in full before
 * anyone sees it, and awareness is parsed synchronously, so its default of 100 MiB is a
 * memory and event-loop problem rather than a limit.
 */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** ws gives Buffers or typed arrays depending on framing; normalise to bytes. */
function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return null;
}

export function attachWebSocket({
  server,
  store,
  metrics,
  sessionFromRequest,
  accessForBoard,
  linkUnlockToken,
  connections,
  saveAcks,
  log = console,
}) {
  const {
    authBySocket,
    registerConnection,
    unregisterConnection,
  } = connections;
  const { queueSaveAck, dropSocket } = saveAcks;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  // Write budgets per socket, per organisation and per room (ADR-173). Measuring a room
  // encodes its document; the quota does that only on first use and near the ceiling.
  const quota = createWsQuota({
    settings: quotaSettings(process.env, { maxFrameBytes: MAX_FRAME_BYTES }),
    measure: (doc) => Y.encodeStateAsUpdate(doc).length,
  });

  wss.on("connection", (socket, request) => {
    // An invalid or oversized frame makes ws emit `error`, and neither this file nor
    // y-websocket listened: one frame was an uncaught exception for every room (ADR-160).
    // ws closes the socket itself; there is nothing to do but record it.
    socket.on("error", (error) => {
      metrics.inc("remo_ws_protocol_errors_total");
      log.error?.("[sync] socket error:", error.message);
    });
    metrics.inc("remo_ws_connections_total");
    socket.on("close", () => metrics.inc("remo_ws_disconnections_total"));

    const auth = authBySocket.get(socket);
    // No capability to edit means read-only: viewers and public links can receive the
    // document and send cursors, and nothing else (ADR-062).
    const readOnly = Boolean(auth?.access && !auth.access.capabilities.includes("board.edit"));

    if (readOnly) {
      const state = { readOnly: true, initialRequestUsed: false };
      guardReadOnly(socket, state, () => metrics.inc("remo_ws_readonly_write_attempt"));
    }

    // Installed after the read-only guard so it sees every frame first (ADR-173).
    if (auth?.boardId) {
      const room = auth.boardId;
      guardQuota(socket, {
        quota,
        state: quota.open({ orgKey: auth.orgId ?? `room:${room}` }),
        room: () => getYDoc(room),
        onLimit: (reason) => {
          metrics.inc("remo_ws_quota_closed_total", { reason });
          log.warn?.(`[sync] closed a socket on ${room}: ${reason}`);
        },
      });
    }

    if (auth?.boardId) {
      const record = {
        socket,
        userId: auth.session?.user.id ?? null,
        sessionHash: auth.session?.tokenHash ?? null,
        unlockToken: auth.unlockToken ?? null,
        role: auth.access?.role ?? null,
        capabilities: auth.access?.capabilities ?? [],
      };
      registerConnection(auth.boardId, record);
      socket.on("close", () => unregisterConnection(auth.boardId, record));
    }

    // y-websocket reads the room name off the raw request path, which is still
    // percent-encoded for a non-ASCII board id. That made the socket persist a second
    // room (`%D0%B7…`) beside the one every HTTP route and the access check use
    // (`запуск…`): two documents, two sets of widgets, a phantom board row. The room is
    // named by the id decoded exactly once at the upgrade, and nowhere else (ADR-148).
    setupWSConnection(socket, request, {
      docName: auth?.boardId || roomFromRequestUrl(request.url),
    });

    if (auth?.boardId) {
      const docName = auth.boardId;
      const roomDoc = getYDoc(docName);
      // The document is only replaced after its last socket closes, so a socket can
      // still join a room that failed to load; its edits would never be saved.
      if (isUnboundRoom(roomDoc)) socket.close(1011, "room unavailable");
      socket.on("message", (message) => {
        const bytes = bytesOf(message);
        if (!bytes) return;
        if (isSyncStep1(bytes)) {
          // A read-only client has nothing to contribute; asking for its state would
          // only make the guard drop the reply and count a fake write attempt.
          if (readOnly) return;
          // The y-websocket server replies with its own state but does not ask the
          // client for its state. Without this extra step, updates made while offline
          // would never reach the server on reconnect.
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          encoding.writeVarUint(encoder, 0);
          encoding.writeVarUint8Array(encoder, Y.encodeStateVector(roomDoc));
          if (socket.readyState === 1) socket.send(encoding.toUint8Array(encoder));
          return;
        }
        if (isSyncStep2(bytes)) {
          saveAcks.markSyncReady?.(socket);
          if (!store.hasPendingWrites?.(docName)) saveAcks.flushSaveAcks?.(docName);
          return;
        }
        if (bytes[0] === SAVE_ACK_MESSAGE) {
          const sequence = decodeSaveAck(bytes);
          if (sequence !== null) queueSaveAck(docName, socket, sequence);
        }
      });
      socket.on("close", () => dropSocket(socket));
    }
  });

  server.on("upgrade", async (request, socket, head) => {
    // Node removes its own socket listener before this event and ws adds one only in
    // `handleUpgrade`, so a reset during the awaits below had none (ADR-160).
    const ignoreReset = () => {};
    socket.on("error", ignoreReset);

    let session = null;
    let upgradeAccess = null;
    let orgId = null;
    let docName = "";

    try {
      // A browser handshake carries `Origin`; a socket opened by another site would
      // otherwise ride the session cookie, which `SameSite` does not stop for a
      // same-site sibling such as the docs host (ADR-062).
      if (!originAllowed(request)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        metrics.inc("remo_ws_rejected_total");
        return;
      }

      // y-websocket takes the room from the request path; the same name decides access.
      // A malformed URL or percent sequence is the client's error: answer 400, keep the
      // process alive.
      docName = roomFromRequestUrl(request.url);
      if (docName.length > MAX_ROOM_ID) {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        metrics.inc("remo_ws_rejected_total");
        return;
      }
      if (store.getIamBoard) {
        const iam = await store.getIamBoard(docName);
        // An unknown room would be created by bindState on first load. Refusing it here
        // keeps an anonymous socket from growing the database with arbitrary ids; 404
        // also avoids disclosing which ids exist (ADR-062/ADR-064).
        if (!iam) {
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          socket.destroy();
          metrics.inc("remo_ws_rejected_total");
          return;
        }
        // The HTTP route decides access from `owner_id`; requiring `org_id` here let a
        // board without an organisation skip the check entirely.
        if (iam.owner_id) {
          session = await sessionFromRequest(request, store);
          const resolved = await accessForBoard({
            store,
            boardId: docName,
            userId: session?.user.id ?? null,
            unlockToken: linkUnlockToken(request),
          });
          upgradeAccess = resolved?.access ?? null;
          orgId = resolved?.facts?.board?.orgId ?? null;
          if (!resolved?.access.allowed) {
            // 4403 is the app's "no access" close code; the socket never reaches Yjs.
            socket.write(
              `HTTP/1.1 ${resolved?.access.reason === "AUTH_REQUIRED" ? 401 : 403} Unauthorized\r\nConnection: close\r\n\r\n`,
            );
            socket.destroy();
            metrics.inc("remo_ws_rejected_total");
            return;
          }
        }
      }
    } catch (error) {
      failUpgrade(socket, error);
      return;
    }

    socket.removeListener("error", ignoreReset);
    try {
      wss.handleUpgrade(request, socket, head, (websocket) => {
        authBySocket.set(websocket, {
          boardId: docName,
          access: upgradeAccess,
          orgId,
          session,
          unlockToken: linkUnlockToken(request),
        });
        wss.emit("connection", websocket, request);
      });
    } catch (error) {
      // The handshake may already be answered, so an HTTP status is no longer possible.
      log.error?.("[sync] connection setup failed:", error.message);
      socket.destroy();
    }
  });

  return { wss };
}
