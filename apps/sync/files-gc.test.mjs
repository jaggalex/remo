/**
 * The image garbage collector (ADR-249, `spec/images.md` §5.4).
 *
 * These tests read the decisions, not the SQL: the database suite proves the selection
 * across organisations. Here a fake store makes the four outcomes of one pass visible —
 * a reference clears the mark, the first unused pass only marks, an expired mark removes
 * the keys and then the row, and a store error cannot keep a row alive.
 */
import { describe, expect, it } from "vitest";
import { createFilesGc, FILES_GC_GRACE_MS } from "./files-gc.mjs";
import { fileKey, FILE_VARIANTS } from "./files-store.mjs";
import { Metrics } from "./metrics.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-11-20T12:00:00.000Z");

function fileRow(id, extra = {}) {
  return {
    id,
    org_id: ORG,
    board_id: "room-1",
    status: "ready",
    stored_bytes: 4096,
    unreferenced_since: null,
    ...extra,
  };
}

/** An in-memory store with the five methods the collector is allowed to use. */
function fakeStore(rows, references = new Set(), clock = { value: START }) {
  const files = new Map(rows.map((row) => [row.id, { ...row }]));
  const audit = [];
  const ledger = { tenants: [], touched: [], cleared: [], deleted: [] };

  return {
    files,
    audit,
    ledger,
    async filesForCollection() {
      return [...files.values()]
        .filter((row) => row.status === "ready")
        .map((row) => ({
          id: row.id,
          org_id: row.org_id,
          unreferenced_since: row.unreferenced_since,
          referenced: references.has(row.id),
        }));
    },
    withTenant(orgId, fn) {
      ledger.tenants.push(orgId);
      return fn();
    },
    async touchUnreferenced(id) {
      const row = files.get(id);
      if (!row || row.status !== "ready") return null;
      row.unreferenced_since ??= clock.value;
      ledger.touched.push(id);
      return { id, unreferenced_since: row.unreferenced_since };
    },
    async clearUnreferenced(id) {
      const row = files.get(id);
      if (!row || row.unreferenced_since === null) return null;
      row.unreferenced_since = null;
      ledger.cleared.push(id);
      return { id };
    },
    async deleteFile(id) {
      const row = files.get(id);
      if (!row || row.status !== "ready") return null;
      row.status = "deleted";
      ledger.deleted.push(id);
      return { ...row };
    },
    async recordAudit(event) {
      audit.push(event);
    },
  };
}

function fakeFileStore({ fail = () => false } = {}) {
  const deleted = [];
  return {
    deleted,
    async delete(key) {
      if (fail(key)) throw Object.assign(new Error("the store is down"), { code: "EIO" });
      deleted.push(key);
    },
  };
}

function collector({ rows, references, store: given, files = fakeFileStore(), clock, metrics = null }) {
  const clockRef = clock ?? { value: START };
  const store = given ?? fakeStore(rows ?? [], references, clockRef);
  return {
    store,
    files,
    clock: clockRef,
    metrics,
    gc: createFilesGc({
      store,
      fileStore: files,
      metrics,
      log: { log() {}, error() {} },
      now: () => clockRef.value,
    }),
  };
}

describe("files GC (ADR-249 §5.4)", () => {
  it("clears the mark when an image widget references the file again", async () => {
    const row = fileRow("file-a", { unreferenced_since: new Date(START.getTime() - 10 * DAY) });
    const { gc, store, files } = collector({ rows: [row], references: new Set(["file-a"]) });

    const result = await gc.runOnce();

    expect(result).toMatchObject({ scanned: 1, marked: 0, cleared: 1, deleted: 0 });
    expect(store.files.get("file-a").unreferenced_since).toBeNull();
    expect(store.ledger.cleared).toEqual(["file-a"]);
    expect(store.ledger.deleted).toEqual([]);
    expect(files.deleted).toEqual([]);
  });

  it("marks an unreferenced file and deletes nothing in the same pass", async () => {
    const { gc, store, files } = collector({ rows: [fileRow("file-b")] });

    const result = await gc.runOnce();

    expect(result).toMatchObject({ scanned: 1, marked: 1, cleared: 0, deleted: 0 });
    expect(store.files.get("file-b")).toMatchObject({
      status: "ready",
      unreferenced_since: START,
    });
    expect(store.ledger.deleted).toEqual([]);
    expect(files.deleted).toEqual([]);
  });

  it("does not delete a file that only became unused in this pass, even a month later", async () => {
    const clock = { value: START };
    const { gc, store, files } = collector({ rows: [fileRow("file-c")], clock });

    await gc.runOnce();
    expect(store.files.get("file-c").unreferenced_since).toEqual(START);

    // The mark is the pass's own clock, so the next eligible deletion is a month away.
    clock.value = new Date(START.getTime() + FILES_GC_GRACE_MS + DAY);
    const later = await gc.runOnce();

    expect(later).toMatchObject({ marked: 0, deleted: 1 });
    expect(store.files.get("file-c").status).toBe("deleted");
    expect(files.deleted).toHaveLength(FILE_VARIANTS.length);
  });

  it("deletes a file marked for longer than the grace window, keys before the row", async () => {
    const marked = new Date(START.getTime() - FILES_GC_GRACE_MS - DAY);
    const metrics = new Metrics();
    const { gc, store, files } = collector({
      rows: [fileRow("file-d", { unreferenced_since: marked })],
      metrics,
    });

    const result = await gc.runOnce();

    expect(result).toMatchObject({ deleted: 1, marked: 0, cleared: 0 });
    expect(store.files.get("file-d").status).toBe("deleted");
    // Every variant, in a known order, before the row stops being `ready`.
    expect(files.deleted).toEqual(FILE_VARIANTS.map((variant) => fileKey(ORG, "file-d", variant)));
    expect(metrics.render()).toContain("remo_files_gc_deleted_total 1");
    // §8: the audit names the id, never the file.
    expect(store.audit).toEqual([
      expect.objectContaining({
        actorType: "system",
        action: "file.deleted_by_gc",
        subject: "file-d",
      }),
    ]);
    expect(JSON.stringify(store.audit)).not.toContain("name");
  });

  it("keeps a file whose mark is younger than the grace window", async () => {
    const marked = new Date(START.getTime() - FILES_GC_GRACE_MS + DAY);
    const { gc, store, files } = collector({
      rows: [fileRow("file-e", { unreferenced_since: marked })],
    });

    const result = await gc.runOnce();

    expect(result).toMatchObject({ deleted: 0 });
    expect(store.files.get("file-e")).toMatchObject({
      status: "ready",
      unreferenced_since: marked,
    });
    expect(files.deleted).toEqual([]);
  });

  it("treats a failing key delete as best effort and still removes the row", async () => {
    const marked = new Date(START.getTime() - FILES_GC_GRACE_MS - DAY);
    const metrics = new Metrics();
    const failing = new Set([fileKey(ORG, "file-f", "w1024")]);
    const files = fakeFileStore({ fail: (key) => failing.has(key) });
    const { gc, store } = collector({
      rows: [fileRow("file-f", { unreferenced_since: marked })],
      files,
      metrics,
    });

    const result = await gc.runOnce();

    expect(result).toMatchObject({ deleted: 1 });
    expect(store.files.get("file-f").status).toBe("deleted");
    // The other three keys were still removed and the failure was counted once.
    expect(files.deleted).toHaveLength(3);
    expect(metrics.render()).toContain("remo_files_gc_deleted_total 1");
  });

  it("is idempotent: a second pass over the same rows changes nothing", async () => {
    const marked = new Date(START.getTime() - FILES_GC_GRACE_MS - DAY);
    const { gc, store, files } = collector({
      rows: [
        fileRow("file-g", { unreferenced_since: marked }),
        fileRow("file-h"),
      ],
      references: new Set(["file-h"]),
    });

    await gc.runOnce();
    const second = await gc.runOnce();

    expect(second).toMatchObject({ scanned: 1, marked: 0, cleared: 0, deleted: 0 });
    expect(files.deleted).toHaveLength(FILE_VARIANTS.length);
    expect(store.files.get("file-g").status).toBe("deleted");
    expect(store.files.get("file-h").unreferenced_since).toBeNull();
  });
});
