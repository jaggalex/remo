/**
 * Export HTTP surface (ADR-071, ADR-085).
 *
 * A visible artefact is one grant, a whole-board backup is another; both leave an audit
 * trail. The actual PNG/PDF rendering is client-side, so the job only owns the
 * request/completion records, kept in memory and pruned on the next request.
 */
import { randomUUID } from "node:crypto";
import { readJsonBody } from "./http-body.mjs";
import { buildBoardBackup } from "./backup.mjs";
import { Y } from "./y.mjs";

export function createExportRoutes({
  store,
  docs,
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

  function exportFilename(title, format) {
    const slug =
      String(title || "board")
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "board";
    return `${slug}.${format === "backup" ? "remo-backup.json" : format}`;
  }

  async function handleExportRoutes({ request, response, url }) {
    const jobMatch = url.pathname.match(/^\/boards\/([^/]+)\/export-jobs$/);
    const completeMatch = url.pathname.match(
      /^\/boards\/([^/]+)\/export-jobs\/([^/]+)\/complete$/,
    );
    const backupMatch = url.pathname.match(/^\/boards\/([^/]+)\/backup$/);
    if (!jobMatch && !completeMatch && !backupMatch) return false;
    // Disk mode is a development fallback without IAM; there is no role to check an
    // export grant against, so the route does not exist there.
    if (typeof store.accessFacts !== "function") return false;

    const boardId = decodeURIComponent((jobMatch ?? completeMatch ?? backupMatch)[1]);
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
      const bundle = buildBoardBackup({ state, boardId, title, comments });
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
        "Content-Disposition": `attachment; filename="${exportFilename(title, "backup")}"`,
      });
      response.end(body);
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
