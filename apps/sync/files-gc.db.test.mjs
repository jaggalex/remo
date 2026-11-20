/**
 * The image collector against a real database and a real disk store (ADR-249,
 * `spec/images.md` §5.4).
 *
 * What the unit suite cannot prove: one read of every `ready` row across organisations
 * sees references from every room, the per-file writes still run under that file's own
 * organisation, a month-old mark removes the keys and then the row, and a file belonging
 * to another organisation is never touched by mistake.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFilesGc, FILES_GC_GRACE_MS } from "./files-gc.mjs";
import { createFileStore, fileKey, FILE_VARIANTS } from "./files-store.mjs";
import { Metrics } from "./metrics.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("files GC");
const store = opened?.store ?? null;
const suite = store ? describe : describe.skip;

let directory = "";
let fileStore = null;

const stamp = Date.now();

beforeAll(async () => {
  if (!store) return;
  directory = await mkdtemp(join(tmpdir(), "remo-files-gc-"));
  fileStore = await createFileStore({ REMO_FILES_DRIVER: "disk", REMO_FILES_DIR: directory });
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  if (store) await store.close();
});

async function createOrg(name) {
  const id = randomUUID();
  await store.pool.query("insert into orgs (id, name, slug) values ($1, $2, $3)", [
    id,
    name,
    `gc-${stamp}-${id.slice(0, 8)}`,
  ]);
  return id;
}

async function createRoom(orgId, tag) {
  const id = `gc-${stamp}-${tag}-${randomUUID().slice(0, 8)}`;
  await store.pool.query("insert into boards (id, org_id, title) values ($1, $2, $3)", [
    id,
    orgId,
    tag,
  ]);
  return id;
}

async function createFile(orgId, boardId, { unreferencedSince = null } = {}) {
  const id = randomUUID();
  await store.pool.query(
    `insert into files
       (id, org_id, board_id, sha256, mime, bytes, stored_bytes, width, height,
        variants, status, unreferenced_since)
     values ($1, $2, $3, $4, 'image/png', 100, 400, 10, 10, $5::jsonb, 'ready', $6)`,
    [
      id,
      orgId,
      boardId,
      randomUUID(),
      JSON.stringify({ w256: { w: 10, h: 10, bytes: 10 } }),
      unreferencedSince,
    ],
  );
  return id;
}

async function addImage(boardId, fileId) {
  await store.pool.query(
    "insert into widgets (board_id, id, type, props) values ($1, $2, 'image', $3::jsonb)",
    [boardId, randomUUID(), JSON.stringify({ fileId })],
  );
}

async function putKeys(orgId, fileId) {
  for (const variant of FILE_VARIANTS) {
    await fileStore.put(fileKey(orgId, fileId, variant), Buffer.from("bytes"), {
      contentType: "image/png",
    });
  }
}

async function rows(ids) {
  const { rows: found } = await store.pool.query(
    "select id, status, unreferenced_since from files where id = any($1::uuid[])",
    [ids],
  );
  return new Map(found.map((row) => [row.id, row]));
}

suite("files GC (ADR-249 §5.4)", () => {
  it("marks unused files, deletes expired ones and leaves the other organisation alone", async () => {
    const orgA = await createOrg("GC A");
    const orgB = await createOrg("GC B");
    const roomA = await createRoom(orgA, "a");
    const roomB = await createRoom(orgB, "b");

    const referencedA = await createFile(orgA, roomA);
    const unusedA = await createFile(orgA, roomA);
    const expiredA = await createFile(orgA, roomA, {
      unreferencedSince: new Date(Date.now() - FILES_GC_GRACE_MS - 24 * 3600_000),
    });
    const referencedB = await createFile(orgB, roomB);
    const unusedB = await createFile(orgB, roomB);

    await addImage(roomA, referencedA);
    await addImage(roomB, referencedB);
    // A room in the trash still counts as a reference: restoring it must restore its
    // pictures, so its widgets keep the file alive (§5.4 point 1).
    await store.pool.query("update boards set archived_at = now() where id = $1", [roomA]);
    await putKeys(orgA, expiredA);
    await putKeys(orgA, unusedA);

    const metrics = new Metrics();
    const gc = createFilesGc({
      store,
      fileStore,
      metrics,
      log: { log() {}, error() {} },
    });

    const result = await gc.runOnce();

    // Other suites share the run database, so only the three outcomes that concern the
    // rows below are asserted; the row-level checks are the proof.
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.marked).toBeGreaterThanOrEqual(2);

    const state = await rows([referencedA, unusedA, expiredA, referencedB, unusedB]);
    // A reference from either organisation clears or prevents the mark.
    expect(state.get(referencedA)).toMatchObject({ status: "ready", unreferenced_since: null });
    expect(state.get(referencedB)).toMatchObject({ status: "ready", unreferenced_since: null });
    // The first unused pass only marks, in both organisations.
    expect(state.get(unusedA).status).toBe("ready");
    expect(state.get(unusedA).unreferenced_since).not.toBeNull();
    expect(state.get(unusedB).status).toBe("ready");
    expect(state.get(unusedB).unreferenced_since).not.toBeNull();
    // The expired file is gone; the other organisation's files were not touched.
    expect(state.get(expiredA).status).toBe("deleted");

    expect(await fileStore.list(`orgs/${orgA}/files/${expiredA}/`)).toEqual([]);
    expect(await fileStore.list(`orgs/${orgA}/files/${unusedA}/`)).toHaveLength(
      FILE_VARIANTS.length,
    );

    expect(metrics.render()).toContain("remo_files_gc_deleted_total 1");

    const { rows: audit } = await store.pool.query(
      `select action, subject, actor_type, after
         from audit_events
        where action = 'file.deleted_by_gc' and subject = $1`,
      [expiredA],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "file.deleted_by_gc",
      subject: expiredA,
      actor_type: "system",
    });
    // The audit carries the id and the size, never the user's file name.
    expect(audit[0].after).toEqual({ bytes: 400 });
  });

  it("clears the mark once a room shows the file again", async () => {
    const orgId = await createOrg("GC clear");
    const roomId = await createRoom(orgId, "clear");
    const fileId = await createFile(orgId, roomId, {
      unreferencedSince: new Date(Date.now() - 10 * 24 * 3600_000),
    });
    await addImage(roomId, fileId);

    const gc = createFilesGc({ store, fileStore, log: { log() {}, error() {} } });
    const result = await gc.runOnce();

    expect(result.cleared).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBe(0);
    expect((await rows([fileId])).get(fileId)).toMatchObject({
      status: "ready",
      unreferenced_since: null,
    });
  });

  it("is idempotent across two passes", async () => {
    const orgId = await createOrg("GC again");
    const roomId = await createRoom(orgId, "again");
    const fileId = await createFile(orgId, roomId);

    const gc = createFilesGc({ store, fileStore, log: { log() {}, error() {} } });
    await gc.runOnce();
    const first = (await rows([fileId])).get(fileId);

    const second = await gc.runOnce();
    const after = (await rows([fileId])).get(fileId);

    expect(second).toMatchObject({ deleted: 0 });
    expect(after.unreferenced_since).toEqual(first.unreferenced_since);
    expect(after.status).toBe("ready");
  });
});
