/**
 * Room mirror for the no-database fallback (ADR-016, ADR-087).
 *
 * Local development runs without Postgres, so each room is kept in one `.yjs` file under
 * the data directory. Writes are debounced and generation-counted, which is what lets the
 * socket layer acknowledge a client only once the bytes it sent have actually landed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Y } from "./y.mjs";

export function createDiskStore({ dataDir, metrics, roomCount }) {
  /** Room names come from the URL, so keep them filesystem-safe. */
  function fileFor(docName) {
    const safe = docName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(dataDir, `${safe}.yjs`);
  }

  /** Per-room disk write generation, so an ack is only sent after the latest bytes land. */
  const diskWrites = new Map();

  function makeWriter(docName, ydoc, state) {
    let timer = null;

    const arm = () => {
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        if (state.writing) {
          arm();
          return;
        }
        state.writing = true;
        const writingVersion = state.dirty;
        try {
          await writeFile(fileFor(docName), Y.encodeStateAsUpdate(ydoc));
          state.written = writingVersion;
          metrics.inc("remo_store_writes_total");
          if (state.dirty === writingVersion) diskStore.onPersisted?.(docName);
        } catch (error) {
          metrics.inc("remo_store_write_errors_total");
          console.error(`[sync] failed to persist ${docName}:`, error.message);
        } finally {
          state.writing = false;
          if (state.dirty > state.written) arm();
        }
      }, 500);
    };

    return arm;
  }

  const diskStore = {
    kind: "disk",
    /** Set by the sync service to acknowledge clients after a successful write. */
    onPersisted: null,
    /** Rooms are kept in the shared y-websocket registry, so that map is the census. */
    get roomCount() {
      return roomCount();
    },
    hasPendingWrites(docName) {
      const state = diskWrites.get(docName);
      return Boolean(state && (state.dirty > state.written || state.writing));
    },
    async health() {
      return { ok: true, store: "disk", dataDir };
    },
    async listBoards() {
      return [];
    },
    // The disk fallback has no tenants and no RLS; the context is a no-op there.
    async withTenant(_orgId, fn) {
      return fn();
    },
    async bindState(docName, ydoc) {
      try {
        const data = await readFile(fileFor(docName));
        Y.applyUpdate(ydoc, new Uint8Array(data));
        console.log(`[sync] loaded ${docName}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        console.log(`[sync] new room ${docName}`);
      }

      const state = { dirty: 0, written: 0, writing: false };
      diskWrites.set(docName, state);
      const schedule = makeWriter(docName, ydoc, state);
      ydoc.on("update", () => {
        state.dirty += 1;
        schedule();
      });
      ydoc.on("destroy", async () => {
        try {
          await writeFile(fileFor(docName), Y.encodeStateAsUpdate(ydoc));
        } catch {
          /* best effort on shutdown */
        }
      });
    },
    async writeState(docName, ydoc) {
      try {
        await writeFile(fileFor(docName), Y.encodeStateAsUpdate(ydoc));
        const state = diskWrites.get(docName);
        if (state) state.written = state.dirty;
        metrics.inc("remo_store_writes_total");
        console.log(`[sync] flushed ${docName}`);
      } catch (error) {
        metrics.inc("remo_store_write_errors_total");
        console.error(`[sync] failed to flush ${docName}:`, error.message);
      }
    },
    async readBoardState(docName) {
      try {
        return new Uint8Array(await readFile(fileFor(docName)));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async close() {},
  };

  return diskStore;
}
