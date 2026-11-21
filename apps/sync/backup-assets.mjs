/**
 * The files a board backup carries (ADR-249 §5.3, `spec/images.md` §5.3).
 *
 * A room document holds only `fileId`s, so a backup without bytes would restore a room
 * full of placeholders. This module turns the ids the document uses into the `assets`
 * array of version 3: the original bytes as base64, plus the few facts a reader needs to
 * rebuild the `image` object before the import pipeline has re-processed them.
 *
 * Two decisions live here and nowhere else:
 * - **200 MiB is the limit of one backup.** It is measured on the bytes that go into
 *   base64, and crossing it raises `BackupTooLarge` instead of growing an archive nobody
 *   can open. The route turns that into `413 BACKUP_TOO_LARGE` and offers the backup
 *   without images — the same array, metadata only.
 * - **A file the store cannot serve does not fail the export.** Its metadata still names
 *   the file, so the restored object shows the "unavailable" placeholder (`spec §9.6`)
 *   instead of an empty room.
 */
import { usedImageFiles } from "./backup.mjs";
import { fileKey } from "./files-store.mjs";

/** §5.3: one backup with images stops at 200 MiB. */
export const BACKUP_ASSET_LIMIT = 200 * 1024 * 1024;

export class BackupTooLarge extends Error {
  constructor(limit = BACKUP_ASSET_LIMIT) {
    super(`a backup with images cannot exceed ${limit} bytes`);
    this.name = "BackupTooLarge";
    this.code = "BACKUP_TOO_LARGE";
    this.limit = limit;
  }
}

/** The store hands out a stream; a backup needs the bytes to base64 them anyway. */
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * @param {{
 *   store: { fileById?: (id: string) => Promise<any> },
 *   files: { get: (key: string) => Promise<AsyncIterable<Uint8Array>> },
 *   orgId: string,
 *   widgets: Record<string, any>,
 *   withData?: boolean,
 *   limit?: number,
 * }} input
 * @returns {Promise<Array<{ fileId: string, sha256: string, mime: string, width: number,
 *   height: number, alt?: string, data?: string }>>}
 */
export async function collectBackupAssets({
  store,
  files,
  orgId,
  widgets,
  withData = true,
  limit = BACKUP_ASSET_LIMIT,
}) {
  const assets = [];
  let total = 0;
  for (const [fileId, alt] of usedImageFiles(widgets)) {
    // `fileById` reads under the room's tenant (ADR-178), so a reference to another
    // organisation's file can only be a row that no longer exists.
    const row = store.fileById ? await store.fileById(fileId).catch(() => null) : null;
    if (!row || row.status !== "ready") continue;
    const asset = {
      fileId,
      sha256: row.sha256,
      mime: row.mime,
      width: Number(row.width),
      height: Number(row.height),
      ...(alt ? { alt } : {}),
    };
    if (withData) {
      let bytes = null;
      try {
        bytes = await readAll(await files.get(fileKey(row.org_id ?? orgId, fileId, "original")));
      } catch {
        // The row is ready but the key is gone: the metadata still tells the restore what
        // the picture was, and the placeholder says it is unavailable.
      }
      if (bytes) {
        total += bytes.length;
        if (total > limit) throw new BackupTooLarge(limit);
        asset.data = bytes.toString("base64");
      }
    }
    assets.push(asset);
  }
  return assets;
}
