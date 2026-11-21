import { call } from "./apiCall";

/**
 * Restore a backup on the server (ADR-249 §5.3).
 *
 * A version 3 bundle carries the room's pictures; the server re-processes them into the
 * target organisation and rewrites every `fileId`, so this call replaces the document,
 * the files and the discussion in one request. Versions without `assets` keep the local
 * path, because there is nothing to upload.
 */
export const backupApi = {
  importBackup: (boardId: string, bundle: unknown) =>
    call<{ imported: { widgets: number; assets: number; placeholders: number } }>(
      `/boards/${encodeURIComponent(boardId)}/backup/import`,
      { method: "POST", body: bundle },
    ),
};
