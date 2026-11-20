/**
 * The image garbage collector (ADR-249, `spec/images.md` §5.4).
 *
 * A file is used while at least one `image` widget points at it — including rooms in the
 * trash, because restoring a room must also restore its pictures. Deleting the object
 * therefore never deletes the file: the file waits, marked, and only a month without a
 * reference removes it. The window is longer than any plan's undo and trash, so an
 * accidental delete is still recoverable for the whole time it can be undone.
 *
 * One pass is one read of every `ready` row across the installation, then a per-file
 * decision under that file's own organisation. The read spans tenants (a background job
 * has no request), so it uses the owner connection once; every write goes through the
 * ordinary tenant methods, so the policy is still the second wall.
 *
 * The keys go first and the row second. A crash between them leaves a row whose keys are
 * gone, which a retry finishes; the opposite order would leave bytes nothing can name.
 */
import { fileKey, FILE_VARIANTS } from "./files-store.mjs";

/** A daily pass is enough: the grace window is measured in weeks. */
export const FILES_GC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** A month without a reference; longer than the undo and trash windows (§5.4 point 3). */
export const FILES_GC_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** Boot must not wait for a full scan, and five minutes is soon enough to matter. */
export const FILES_GC_FIRST_DELAY_MS = 5 * 60 * 1000;

function timeOf(value) {
  return new Date(value).getTime();
}

export function createFilesGc({
  store,
  fileStore,
  log = console,
  metrics = null,
  now = () => new Date(),
  intervalMs = FILES_GC_INTERVAL_MS,
  graceMs = FILES_GC_GRACE_MS,
  firstDelayMs = FILES_GC_FIRST_DELAY_MS,
}) {
  let timer = null;
  let firstTimer = null;
  let running = false;

  /** Best effort: a missing key is already gone, and one failure must not stop the row. */
  async function removeKeys(orgId, fileId) {
    for (const variant of FILE_VARIANTS) {
      try {
        await fileStore.delete(fileKey(orgId, fileId, variant));
      } catch (error) {
        log.error?.(
          `[files-gc] key ${variant} for ${fileId}: ${error?.code ?? error?.message ?? "ERROR"}`,
        );
      }
    }
  }

  /** Delete one expired file: keys first, then the soft delete, then the audit row. */
  async function remove(row) {
    await removeKeys(row.org_id, row.id);
    const deleted = await store.withTenant(row.org_id, async () => {
      const file = await store.deleteFile(row.id);
      if (!file) return null;
      try {
        await store.recordAudit?.({
          actorType: "system",
          actorId: null,
          orgId: row.org_id,
          boardId: file.board_id ?? null,
          action: "file.deleted_by_gc",
          subject: row.id,
          // Never the name: only the id and the size the quota stops counting.
          after: { bytes: Number(file.stored_bytes ?? 0) },
        });
      } catch (error) {
        // The deletion stands; an audit failure is reported by its own metric elsewhere.
        log.error?.(`[files-gc] audit for ${row.id}: ${error?.message ?? error}`);
      }
      return file;
    });
    if (!deleted) return false;
    metrics?.inc("remo_files_gc_deleted_total");
    return true;
  }

  /**
   * One collection pass.
   *
   * A file that becomes unreferenced is only marked here, so its first eligible deletion
   * is at least `graceMs` later: a pass right after a restart can never remove a file it
   * has just found unused.
   */
  async function runOnce() {
    if (running) return { scanned: 0, marked: 0, cleared: 0, deleted: 0, skipped: true };
    if (typeof store.filesForCollection !== "function") {
      return { scanned: 0, marked: 0, cleared: 0, deleted: 0 };
    }
    running = true;
    try {
      const rows = (await store.filesForCollection()) ?? [];
      const cutoff = timeOf(now()) - graceMs;
      let marked = 0;
      let cleared = 0;
      let deleted = 0;

      for (const row of rows) {
        try {
          if (row.referenced) {
            if (row.unreferenced_since !== null && row.unreferenced_since !== undefined) {
              const done = await store.withTenant(row.org_id, () =>
                store.clearUnreferenced(row.id),
              );
              if (done) cleared += 1;
            }
            continue;
          }

          // Unused for the first time in this pass: mark, never delete.
          if (row.unreferenced_since === null || row.unreferenced_since === undefined) {
            const done = await store.withTenant(row.org_id, () =>
              store.touchUnreferenced(row.id),
            );
            if (done) marked += 1;
            continue;
          }

          if (timeOf(row.unreferenced_since) >= cutoff) continue;
          if (await remove(row)) deleted += 1;
        } catch (error) {
          // One bad row must not abort the pass; the next one repeats the same step.
          log.error?.(`[files-gc] ${row.id}: ${error?.code ?? error?.message ?? "ERROR"}`);
        }
      }

      if (marked || cleared || deleted) {
        log.log?.(
          `[files-gc] scanned ${rows.length}: ${marked} marked, ${cleared} cleared, ${deleted} deleted`,
        );
      }
      return { scanned: rows.length, marked, cleared, deleted };
    } catch (error) {
      log.error?.(`[files-gc] pass failed: ${error?.code ?? error?.message ?? "ERROR"}`);
      return { scanned: 0, marked: 0, cleared: 0, deleted: 0 };
    } finally {
      running = false;
    }
  }

  /** Called on listen; the first pass waits so the boot path stays free. */
  function start() {
    if (timer || firstTimer) return;
    firstTimer = setTimeout(() => {
      firstTimer = null;
      void runOnce();
    }, firstDelayMs);
    firstTimer.unref?.();
    timer = setInterval(() => void runOnce(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
  }

  return { runOnce, start, stop };
}
