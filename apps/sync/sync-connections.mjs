/**
 * Who is connected right now, and whether they still may be (ADR-062).
 *
 * Sharing a board while somebody is connected must not leave them with the old rights
 * until they happen to reload. A mutation calls `refreshBoardAccess`; the 30-second sweep
 * is the backstop for session expiry and suspensions. Closing rather than downgrading in
 * place is deliberate: the client reconnects, gets a fresh handshake and therefore the
 * right mode. A socket that kept its old mode would be the bug this file prevents.
 */
/** How long a revoked socket may take to answer the close frame before it is cut. */
const REVOKE_GRACE_MS = 1_000;

/**
 * Close a socket that lost access, then terminate it if it does not finish the
 * handshake. `ws.close` leaves the message listener alive while the socket is CLOSING,
 * so a client that ignores the close frame can keep writing for the close timeout.
 */
export function revokeSocket(socket, code, reason) {
  if (socket.readyState !== 1) return;
  socket.close(code, reason);
  const timer = setTimeout(() => socket.terminate(), REVOKE_GRACE_MS);
  timer.unref?.();
}

export function createConnections({ store, accessForBoard, log = console, sweepMs = 30_000 }) {
  /** boardId → Set<{ socket, userId, sessionHash, unlockToken, role, capabilities }> */
  const liveConnections = new Map();
  /** The decision taken at upgrade time, so the connection handler does not query twice. */
  const authBySocket = new WeakMap();

  function registerConnection(boardId, record) {
    if (!boardId) return;
    const set = liveConnections.get(boardId) ?? new Set();
    set.add(record);
    liveConnections.set(boardId, set);
  }

  function unregisterConnection(boardId, record) {
    const set = liveConnections.get(boardId);
    if (!set) return;
    set.delete(record);
    if (!set.size) liveConnections.delete(boardId);
  }

  /** Re-evaluate every open socket of a board and close the ones whose access changed. */
  async function refreshBoardAccess(boardId) {
    const records = liveConnections.get(boardId);
    if (!records?.size || !store.getIamBoard) return;

    const iam = await store.getIamBoard(boardId).catch(() => null);
    if (!iam) return;
    // Unclaimed rooms keep the legacy rule; there is no access decision to refresh.
    if (!iam.owner_id) return;

    for (const record of [...records]) {
      try {
        const resolved = await accessForBoard({
          store,
          boardId,
          userId: record.userId,
          unlockToken: record.unlockToken,
        });
        const allowed = resolved?.access.allowed ?? false;
        const role = resolved?.access.role ?? null;
        const capabilities = resolved?.access.capabilities ?? [];
        const sameCapabilities =
          capabilities.length === record.capabilities.length &&
          capabilities.every((capability) => record.capabilities.includes(capability));
        // A trashed board keeps the same role but loses every write capability, so a
        // role-only check would leave an open editor socket alive (ADR-073).
        if (!allowed || role !== record.role || !sameCapabilities) {
          revokeSocket(record.socket, 4403, "access changed");
        }
      } catch (error) {
        log.error(`[sync] access refresh failed for ${boardId}:`, error.message);
        revokeSocket(record.socket, 1011, "access check failed");
      }
    }
  }

  /** Tell everyone in a board's room that its comments changed (ADR-104 amendment). */
  function notifyBoard(boardId, frame) {
    const records = liveConnections.get(boardId);
    if (!records?.size) return 0;
    let sent = 0;
    for (const record of records) {
      if (record.socket.readyState !== 1) continue;
      try {
        record.socket.send(frame);
        sent += 1;
      } catch {
        /* a dead socket is cleaned up by its own close handler */
      }
    }
    return sent;
  }

  /** Suspend/remove closes every socket of that person at once. */
  function closeUserConnections(userId) {
    for (const records of liveConnections.values()) {
      for (const record of [...records]) {
        if (record.userId === userId) revokeSocket(record.socket, 4403, "access revoked");
      }
    }
  }

  let sweeping = false;
  async function sweepOnce() {
    // A slow database must not stack passes on top of each other.
    if (sweeping) return;
    sweeping = true;
    try {
      for (const [boardId, records] of [...liveConnections]) {
        for (const record of [...records]) {
          if (!record.sessionHash) continue;
          const session = await store.findSession(record.sessionHash).catch(() => null);
          if (!session) revokeSocket(record.socket, 4401, "session ended");
        }
        await refreshBoardAccess(boardId);
      }
    } catch (error) {
      // `setInterval` ignores the promise, so this would be an unhandled rejection.
      log.error("[sync] connection sweep failed:", error.message);
    } finally {
      sweeping = false;
    }
  }

  const sweep = setInterval(() => void sweepOnce(), sweepMs);
  sweep.unref();

  function stopSweep() {
    clearInterval(sweep);
  }

  return {
    sweepOnce,
    authBySocket,
    registerConnection,
    unregisterConnection,
    refreshBoardAccess,
    notifyBoard,
    closeUserConnections,
    stopSweep,
  };
}
