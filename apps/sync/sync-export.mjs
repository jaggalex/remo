/**
 * Export HTTP surface (ADR-071, ADR-085).
 *
 * A visible artefact is one grant, a whole-board backup is another; both leave an audit
 * trail. The actual PNG/PDF rendering is client-side, so the job only owns the
 * request/completion records, kept in memory and pruned on the next request.
 */
import { randomUUID } from "node:crypto";
import { featureLimit, planFeatureResponse } from "./billing-guard.mjs";
import { readJsonBody, readJsonBodyResult } from "./http-body.mjs";
import { buildBoardBackup, verifyBoardBackup } from "./backup.mjs";
import { BACKUP_ASSET_LIMIT, BackupTooLarge, collectBackupAssets } from "./backup-assets.mjs";
import { applyBoardBackup, assetOutcome } from "./backup-restore.mjs";
import { Y } from "./y.mjs";

/**
 * The request body of a backup with images (§5.3).
 *
 * The 200 MiB ceiling is measured on the bytes themselves, and base64 adds a third:
 * 200 MiB becomes ~267 MiB inside the JSON. The slack covers the rest of the bundle
 * (widgets, comments, the manifest) without becoming a second, larger limit.
 */
export const BACKUP_IMPORT_BODY_LIMIT =
  Math.ceil((BACKUP_ASSET_LIMIT * 4) / 3) + 16 * 1024 * 1024;

export function createExportRoutes({
  store,
  docs,
  files,
  getDocument = (boardId) => docs.get(boardId),
  ingestImage = null,
  sessionFromRequest,
  accessForBoard,
  linkUnlockToken,
  emitMetric,
}) {
  /** Export jobs are in-memory: they die with the process, like a download prompt. */
  const exportJobs = new Map();

  function pruneExportJobs() {
    const cutoff = Date.now() - 60 * 60_000;
    for (const [id, job] of exportJobs) {
      if (job.createdAt < cutoff) exportJobs.delete(id);
    }
  }

  /**
   * Board access for a request. `caller` is set when the command route already resolved
   * who is asking (a session or an integration token, ADR-096); export routes call this
   * without one, which keeps them session-only.
   */
  async function boardAccessForRequest(request, boardId, caller = null) {
    const session = caller ? null : await sessionFromRequest(request, store);
    const resolved = await accessForBoard({
      store,
      boardId,
      userId: caller?.user?.id ?? session?.user?.id ?? null,
      unlockToken: linkUnlockToken(request),
    });
    if (!resolved?.access?.allowed) return null;
    return {
      session,
      caller,
      resolved,
      board: resolved.facts.board,
      iam: await store.getIamBoard?.(boardId),
    };
  }

  function backupDisposition(title) {
    const slug =
      String(title || "board")
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "board";
    const filename = `${slug}.remo-backup.json`;
    if (/^[a-z0-9-]+$/.test(slug)) return `attachment; filename="${filename}"`;
    return `attachment; filename="board.remo-backup.json"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }

  async function handleExportRoutes({ request, response, url }) {
    const jobMatch = url.pathname.match(/^\/boards\/([^/]+)\/export-jobs$/);
    const completeMatch = url.pathname.match(
      /^\/boards\/([^/]+)\/export-jobs\/([^/]+)\/complete$/,
    );
    const backupMatch = url.pathname.match(/^\/boards\/([^/]+)\/backup$/);
    const importMatch = url.pathname.match(/^\/boards\/([^/]+)\/backup\/import$/);
    if (!jobMatch && !completeMatch && !backupMatch && !importMatch) return false;
    // Disk mode is a development fallback without IAM; there is no role to check an
    // export grant against, so the route does not exist there.
    if (typeof store.accessFacts !== "function") return false;

    const boardId = decodeURIComponent(
      (jobMatch ?? completeMatch ?? backupMatch ?? importMatch)[1],
    );
    const access = await boardAccessForRequest(request, boardId);
    if (!access) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE" }));
      return true;
    }
    const actorId = access.session?.user?.id ?? null;
    const orgId = access.iam?.org_id ?? access.board.orgId ?? null;
    const title = access.iam?.title ?? "";

    if (backupMatch && request.method === "GET") {
      if (!access.resolved.access.capabilities.includes("board.backup")) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "FORBIDDEN" }));
        return true;
      }
      const live = docs.get(boardId);
      const state = live ? Y.encodeStateAsUpdate(live) : await store.readBoardState?.(boardId);
      const comments = await store.commentsForBackup?.(boardId);
      // `?assets=none` is the explicit backup without images (§5.3, §9.9): the same
      // bundle, the same checksum, metadata only. It is never the silent result of the
      // 200 MiB ceiling — that one is a `413` with an offer.
      const withImages = url.searchParams.get("assets") !== "none";
      // Two passes over one state: the first names the files the document uses, the
      // second carries their bytes. Reading ids from the finished bundle means the
      // archive can never name a file the widgets do not.
      const draft = buildBoardBackup({ state, boardId, title, comments });
      let assets = [];
      try {
        assets = await collectBackupAssets({
          store,
          files,
          orgId,
          widgets: draft.widgets,
          withData: withImages,
        });
      } catch (error) {
        if (!(error instanceof BackupTooLarge)) throw error;
        response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            error: error.code,
            message: "this room is too large for a backup with images",
            limit: error.limit,
          }),
        );
        return true;
      }
      const bundle = assets.length
        ? buildBoardBackup({ state, boardId, title, comments, assets })
        : draft;
      const body = JSON.stringify(bundle);
      await store.recordAudit?.({
        actorId,
        orgId,
        boardId,
        action: "export.requested",
        subject: "backup",
        after: { format: "backup", counts: bundle.manifest.counts },
      });
      await store.recordAudit?.({
        actorId,
        orgId,
        boardId,
        action: "export.completed",
        subject: "backup",
        after: { format: "backup", bytes: Buffer.byteLength(body) },
      });
      emitMetric({
        name: "export.requested",
        orgId,
        actorId,
        boardId,
        props: { scope: "board", format: "backup", objectCount: bundle.manifest.counts.widgets },
      });
      emitMetric({
        name: "export.completed",
        orgId,
        actorId,
        boardId,
        props: { scope: "board", format: "backup", bytes: Buffer.byteLength(body) },
      });
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": backupDisposition(title),
      });
      response.end(body);
      return true;
    }

    if (importMatch && request.method === "POST") {
      if (!access.resolved.access.capabilities.includes("board.edit")) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "FORBIDDEN" }));
        return true;
      }
      const userId = actorId;
      if (!userId) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "ACCOUNT_REQUIRED" }));
        return true;
      }
      if (!ingestImage) {
        response.writeHead(501, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "FILES_UNAVAILABLE" }));
        return true;
      }

      const body = await readJsonBodyResult(request, BACKUP_IMPORT_BODY_LIMIT);
      if (!body.ok) {
        const status = body.error === "TOO_LARGE" ? 413 : 422;
        response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            error: body.error,
            message:
              body.error === "TOO_LARGE"
                ? "this backup exceeds the import limit; use a backup without images"
                : "the request is not a JSON backup",
          }),
        );
        return true;
      }
      const bundle = body.value;
      // The checksum is verified on the server too: the browser's check protects the
      // person who chose the file, this one protects the room from any other caller.
      if (!verifyBoardBackup(bundle)) {
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "BAD_BACKUP" }));
        return true;
      }

      // Assets with bytes become rows in the target organisation through the upload
      // pipeline (§4.2); the imports keep their new ids. An asset without `data` keeps
      // the old id and shows the unavailable placeholder (§9.6).
      const fileIds = new Map();
      for (const asset of Array.isArray(bundle.assets) ? bundle.assets : []) {
        if (typeof asset?.data !== "string" || !asset.data) continue;
        if (typeof asset.fileId !== "string" || !asset.fileId) continue;
        let ingested;
        try {
          ingested = await ingestImage({
            orgId,
            boardId,
            userId,
            buffer: Buffer.from(asset.data, "base64"),
            // The backup does not carry the user's file name; the type is what the
            // pipeline reads from the bytes anyway.
            filename: "image",
            // The room is replaced, not added to: its old pictures are removed by the
            // same operation, so the per-room count starts from the backup itself.
            roomImages: false,
          });
        } catch (error) {
          if (error?.code === "PLAN_LIMIT" && error.problem) {
            planLimitResponse(response, error.problem);
            return true;
          }
          const status =
            error?.code === "too_large" || error?.code === "too_many_pixels"
              ? 413
              : error?.code === "bad_type"
                ? 415
                : error?.code === "busy"
                  ? 503
                  : 500;
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              error:
                status === 413
                  ? "TOO_LARGE"
                  : status === 415
                    ? "BAD_TYPE"
                    : status === 503
                      ? "SERVER_BUSY"
                      : "IMPORT_FAILED",
              message: "one image in this backup could not be stored",
            }),
          );
          return true;
        }
        fileIds.set(asset.fileId, ingested.row.id);
        await store.recordAudit?.({
          actorId,
          orgId,
          boardId,
          action: "file.imported",
          subject: ingested.row.id,
          after: { sourceFileId: asset.fileId, bytes: ingested.bytes },
        });
      }

      // One document replacement, the same result the browser import produced before
      // pictures moved to the server (ADR-071, ADR-249 §5.3).
      const doc = await getDocument(boardId);
      if (!doc) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE" }));
        return true;
      }
      const applied = applyBoardBackup(doc, bundle, { fileIds });
      const persisted = await store.flushRoom?.(boardId);
      if (store.flushRoom && !persisted) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "NOT_PERSISTED" }));
        return true;
      }

      // A discussion is separately governed (`board.manage`, ADR-161): an editor may
      // replace the document, but an import must not become a way to erase comments.
      const canManage = access.resolved.access.capabilities.includes("board.manage");
      if (canManage && Array.isArray(bundle.comments)) {
        await store.replaceCommentsFromBackup?.(boardId, bundle.comments);
        await store.recordAudit?.({
          actorId,
          orgId,
          boardId,
          action: "comment.restored",
          after: { threads: bundle.comments.length },
        });
      }

      const outcome = assetOutcome(bundle);
      await store.recordAudit?.({
        actorId,
        orgId,
        boardId,
        action: "board.imported",
        subject: "backup",
        after: {
          version: bundle.manifest.version,
          widgets: applied.widgets,
          assets: outcome.restored,
          placeholders: outcome.placeholders,
          comments: canManage && Array.isArray(bundle.comments),
        },
      });
      emitMetric({
        name: "board.imported",
        orgId,
        actorId,
        boardId,
        props: { assets: outcome.restored, placeholders: outcome.placeholders },
      });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          imported: {
            widgets: applied.widgets,
            assets: outcome.restored,
            placeholders: outcome.placeholders,
          },
        }),
      );
      return true;
    }

    if (jobMatch && request.method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const scope = String(body.scope ?? "");
      const format = String(body.format ?? "");
      if (!["selection", "frame", "board"].includes(scope)) {
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "BAD_SCOPE" }));
        return true;
      }
      if (!["png", "pdf"].includes(format)) {
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "BAD_FORMAT" }));
        return true;
      }
      if (!access.resolved.access.capabilities.includes("board.export")) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "FORBIDDEN" }));
        return true;
      }
      // PDF is a paid export (§2.2). PNG stays available on every plan; the watermark is
      // the client's other, softer reminder.
      if (format === "pdf") {
        const problem = await featureLimit(store, orgId, "export.pdf");
        if (problem) {
          planFeatureResponse(response, problem);
          return true;
        }
      }
      pruneExportJobs();
      const jobId = randomUUID();
      const objectCount = Number(body.objectCount ?? 0);
      exportJobs.set(jobId, {
        boardId,
        orgId,
        userId: actorId,
        scope,
        format,
        objectCount,
        createdAt: Date.now(),
      });
      await store.recordAudit?.({
        actorId,
        orgId,
        boardId,
        action: "export.requested",
        subject: format,
        after: { scope, format, objectCount },
      });
      emitMetric({
        name: "export.requested",
        orgId,
        actorId,
        boardId,
        props: { scope, format, objectCount },
      });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jobId }));
      return true;
    }

    if (completeMatch && request.method === "POST") {
      const jobId = decodeURIComponent(completeMatch[2]);
      const job = exportJobs.get(jobId);
      if (!job || job.boardId !== boardId || job.userId !== actorId) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "JOB_NOT_FOUND" }));
        return true;
      }
      const body = (await readJsonBody(request)) ?? {};
      const bytes = Number(body.bytes ?? 0);
      exportJobs.delete(jobId);
      await store.recordAudit?.({
        actorId,
        orgId,
        boardId,
        action: "export.completed",
        subject: job.format,
        after: { scope: job.scope, format: job.format, bytes },
      });
      emitMetric({
        name: "export.completed",
        orgId,
        actorId,
        boardId,
        props: { scope: job.scope, format: job.format, bytes },
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return true;
    }

    return false;
  }

  return { handleExportRoutes, boardAccessForRequest };
}
