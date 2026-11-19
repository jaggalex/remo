/**
 * What keeps one failure from becoming an outage for every board (ADR-160).
 *
 * All rooms share this process. y-websocket calls persistence without handling a
 * rejection, so a database failure there would end the service; the guards below turn
 * that into one closed room, and a failure nobody foresaw into a counted log line.
 */

/** How long an uncaught exception may spend flushing rooms before the process exits. */
export const FATAL_FLUSH_MS = 5000;

/** Documents whose load failed. Their edits could never reach the log. */
const unboundRooms = new WeakSet();

export function isUnboundRoom(ydoc) {
  return unboundRooms.has(ydoc);
}

/**
 * Persistence for y-websocket. Both methods start synchronously, as the library expects,
 * and neither rejects.
 */
export function guardPersistence(store, { metrics, log = console }) {
  return {
    async bindState(docName, ydoc) {
      try {
        await store.bindState(docName, ydoc);
      } catch (error) {
        metrics.inc("remo_store_write_errors_total");
        log.error(`[sync] room ${docName} failed to load:`, error.message);
        unboundRooms.add(ydoc);
        // The clients reconnect, and the last close here frees the document, so the next
        // connection loads the room again.
        for (const socket of ydoc.conns.keys()) socket.close(1011, "room unavailable");
      }
    },
    async writeState(docName, ydoc) {
      try {
        await store.writeState(docName, ydoc);
      } catch (error) {
        metrics.inc("remo_store_write_errors_total");
        log.error(`[sync] room ${docName} failed to flush:`, error.message);
      }
    },
  };
}

/**
 * The last line, not the mechanism: each path that can fail handles its own failure.
 * A rejected promise leaves the stack intact, so serving continues. An uncaught exception
 * may have stopped halfway through a change, so `onFatal` flushes and exits.
 */
export function installProcessGuards({ metrics, onFatal, log = console, target = process }) {
  target.on("unhandledRejection", (reason) => {
    metrics.inc("remo_background_failures_total");
    log.error("[sync] unhandled rejection:", reason);
  });
  target.on("uncaughtException", (error) => {
    metrics.inc("remo_background_failures_total");
    log.error("[sync] uncaught exception:", error);
    onFatal(error);
  });
}
