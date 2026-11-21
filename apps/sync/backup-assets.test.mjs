import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackupTooLarge, collectBackupAssets } from "./backup-assets.mjs";
import { buildBoardBackup } from "./backup.mjs";
import { createFileStore, fileKey } from "./files-store.mjs";
import { Y } from "./y.mjs";

/**
 * The pictures a backup carries (ADR-249 §5.3, `spec/images.md` §5.3).
 *
 * No database: the collector reads a row through the store interface and the bytes
 * through the file store, so a temporary disk directory proves the whole path — the
 * round trip, the 200 MiB refusal and the metadata-only mode.
 */

const orgId = "org-backup";
const fileId = "11111111-1111-4111-8111-111111111111";
const missingId = "22222222-2222-4222-8222-222222222222";
/** Not a real PNG: the collector moves bytes and never looks inside them. */
const bytes = Buffer.from("\x89PNG\r\n\x1a\nbackup bytes");

let files = null;
let directory = "";

const store = {
  async fileById(id) {
    if (id === fileId) {
      return {
        id: fileId,
        org_id: orgId,
        status: "ready",
        sha256: "a".repeat(64),
        mime: "image/png",
        width: 1200,
        height: 800,
      };
    }
    return null;
  },
};

function docState() {
  const doc = new Y.Doc();
  const widgets = doc.getMap("widgets");
  const image = new Y.Map();
  image.set("id", "img-1");
  image.set("type", "image");
  image.set("fileId", fileId);
  image.set("alt", "Sales funnel");
  widgets.set("img-1", image);
  const note = new Y.Map();
  note.set("id", "note-1");
  note.set("type", "sticky_note");
  widgets.set("note-1", note);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "remo-backup-assets-"));
  files = await createFileStore({ REMO_FILES_DRIVER: "disk", REMO_FILES_DIR: directory });
  await files.put(fileKey(orgId, fileId, "original"), bytes, { contentType: "image/png" });
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("backup assets (ADR-249 §5.3)", () => {
  it("round-trips one picture: the same bytes and the same fileId", async () => {
    const draft = buildBoardBackup({ state: docState(), boardId: "board-1" });
    const assets = await collectBackupAssets({
      store,
      files,
      orgId,
      widgets: draft.widgets,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      fileId,
      sha256: "a".repeat(64),
      mime: "image/png",
      width: 1200,
      height: 800,
      alt: "Sales funnel",
    });
    expect(Buffer.from(assets[0].data, "base64").equals(bytes)).toBe(true);

    // The bundle the route would send carries them under the same checksum rule.
    const bundle = buildBoardBackup({
      state: docState(),
      boardId: "board-1",
      assets,
    });
    expect(bundle.manifest.counts.assets).toBe(1);
    expect(bundle.assets[0].fileId).toBe(fileId);
  });

  it("keeps the metadata and drops the bytes in the backup without images", async () => {
    const draft = buildBoardBackup({ state: docState(), boardId: "board-1" });
    const assets = await collectBackupAssets({
      store,
      files,
      orgId,
      widgets: draft.widgets,
      withData: false,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).not.toHaveProperty("data");
    expect(assets[0].fileId).toBe(fileId);
    // The shape stays a version 3 bundle: same keys, an empty or metadata-only array.
    const bundle = buildBoardBackup({ state: docState(), boardId: "board-1", assets });
    expect(bundle.version).toBe(3);
    expect(bundle.widgets["img-1"].fileId).toBe(fileId);
  });

  it("refuses a backup over the limit instead of growing one nobody can open", async () => {
    const draft = buildBoardBackup({ state: docState(), boardId: "board-1" });
    await expect(
      collectBackupAssets({ store, files, orgId, widgets: draft.widgets, limit: bytes.length - 1 }),
    ).rejects.toBeInstanceOf(BackupTooLarge);
    // The refusal has the code the route maps to `413 BACKUP_TOO_LARGE`.
    await expect(
      collectBackupAssets({ store, files, orgId, widgets: draft.widgets, limit: 1 }),
    ).rejects.toMatchObject({ code: "BACKUP_TOO_LARGE" });
  });

  it("skips a file the organisation no longer has a row for", async () => {
    const assets = await collectBackupAssets({
      store,
      files,
      orgId,
      widgets: {
        "img-2": { type: "image", fileId: missingId },
        "img-1": { type: "image", fileId },
      },
    });
    expect(assets.map((asset) => asset.fileId)).toEqual([fileId]);
  });
});
