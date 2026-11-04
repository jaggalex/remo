/**
 * Save acknowledgements (ADR-084, ADR-082).
 *
 * A client that sends an update wants to know when the server has it — not when the
 * server has received the frame, but when the bytes are durable in the store. The client
 * asks with a sequence number; this module remembers the highest number per socket and
 * answers only after the store reports the write landed.
 */
import { encodeSaveAck } from "./save-ack.mjs";

export function createSaveAcks({ store, getYDoc, authBySocket, emitMetric }) {
  /** Pending save acknowledgements per room: socket → highest local sequence. */
  const saveAckQueues = new Map();
  /**
   * Sockets that have sent their sync step 2. A client asks for an ack as soon as the
   * socket opens, which can be before its offline updates arrive; acknowledging then
   * says "saved" for bytes the server has not seen.
   */
  const syncReady = new WeakSet();

  function queueSaveAck(docName, socket, sequence) {
    let queue = saveAckQueues.get(docName);
    if (!queue) {
      queue = new Map();
      saveAckQueues.set(docName, queue);
    }
    queue.set(socket, Math.max(queue.get(socket) ?? 0, sequence));
    if (process.env.REMO_DEBUG) {
      console.log(
        `[sync] ack request ${docName} seq=${sequence} pending=${store.hasPendingWrites?.(docName)}`,
      );
    }
    // Wait for the client's sync step 2: it carries the offline updates the ack is
    // supposed to cover.
    if (!syncReady.has(socket)) return;
    // Nothing is waiting for the store: the update was already persisted (for example
    // an ack request after reconnect), so answer now instead of waiting for a flush
    // that will never come.
    if (!store.hasPendingWrites?.(docName)) flushSaveAcks(docName);
  }

  function flushSaveAcks(docName) {
    const queue = saveAckQueues.get(docName);
    if (!queue?.size) return;
    const remaining = new Map();
    const acknowledged = [];
    for (const [socket, sequence] of queue) {
      if (socket.readyState !== 1) continue;
      if (!syncReady.has(socket)) {
        remaining.set(socket, sequence);
        continue;
      }
      try {
        socket.send(encodeSaveAck(sequence));
        acknowledged.push(socket);
        if (process.env.REMO_DEBUG) console.log(`[sync] ack sent ${docName} seq=${sequence}`);
      } catch {
        /* the client is gone; the next connection will start a new sequence */
      }
    }
    if (remaining.size) saveAckQueues.set(docName, remaining);
    else saveAckQueues.delete(docName);
    if (acknowledged.length) void recordSavedAcks(docName, acknowledged);
  }

  /** The client has answered the server's sync step 1; its updates are in the room. */
  function markSyncReady(socket) {
    syncReady.add(socket);
  }

  /** One `board.saved` per person whose acknowledgement was sent (ADR-082). */
  async function recordSavedAcks(docName, sockets) {
    try {
      const iam = await store.getIamBoard?.(docName);
      if (!iam?.org_id) return;
      const objectCount = getYDoc(docName).getMap("widgets").size;
      for (const socket of sockets) {
        const auth = authBySocket.get(socket);
        const actorId = auth?.session?.user?.id;
        if (!actorId) continue;
        emitMetric({
          name: "board.saved",
          orgId: iam.org_id,
          actorId,
          boardId: docName,
          props: { objectCount },
        });
        if (objectCount >= 3) {
          // The partial unique index in the metrics database keeps this once per
          // workspace even when several boards save at nearly the same time.
          emitMetric({
            name: "activation.first_value",
            orgId: iam.org_id,
            actorId,
            boardId: docName,
            props: { kind: "solo" },
          });
        }
      }
    } catch {
      /* metrics are best-effort and must never delay the acknowledgement */
    }
  }

  /** A closed socket must not be acknowledged on the next flush. */
  function dropSocket(socket) {
    for (const queue of saveAckQueues.values()) queue.delete(socket);
  }

  return { queueSaveAck, flushSaveAcks, markSyncReady, dropSocket };
}
