/**
 * The image HTTP surface (ADR-249, `spec/images.md` §4.1, §4.3, §5.1–5.2).
 *
 * Four routes, one rule: a file is reachable only through a room that may show it.
 * Uploads go through `sharp` on a bounded queue, land in the file store, write the
 * `files` row and then create the object with one command. Reads name a board (`?board=`)
 * because a file id alone does not say which room is asking, and a request that cannot
 * prove the room uses the file gets `404` — never `403`, which would confirm the file.
 *
 * Bytes are streamed from the store, never buffered whole: a 2048 px WebP and a 20 MiB
 * original both leave the process through `pipeline`.
 */
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { entitlementsFor } from "./billing.mjs";
import { planLimitResponse } from "./billing-guard.mjs";
import { reserveAttempt } from "./attempts.mjs";
import { applyBoardCommand } from "./commands-api.mjs";
import { CommandError } from "./commands.mjs";
import { fileKey, FILE_VARIANTS } from "./files-store.mjs";
import { DEFAULT_MAX_PIXELS, detectImageType, processImage, VARIANT_WIDTHS } from "./files-image.mjs";
import { filesQueue } from "./files-queue.mjs";
import { readMultipart } from "./http-multipart.mjs";
import { withoutTenant } from "./tenant.mjs";

/** §2.2 defaults; the environment may lower or raise them. */
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_PER_ROOM = 500;

/** The variants a read may ask for. `original` has its own route (§4.1). */
export const READ_VARIANTS = ["w256", "w1024", "w2048"];

/** A file id is a UUID; anything else is an unknown file, not a database error. */
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest side of a freshly created object, in board units (§3.2). */
const IMAGE_SIDE = 480;

function positive(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function fail(response, status, error, message) {
  json(response, status, { error, message });
}

/** A missing file and a forbidden one are the same answer (invariant 3, §1). */
function notFound(response) {
  fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
}

function multipartProblem(response, error) {
  if (error?.code === "too_large") {
    return fail(response, 413, "TOO_LARGE", "the upload exceeds the size limit");
  }
  if (error?.code === "bad_content_type") {
    return fail(response, 400, "BAD_CONTENT_TYPE", "expected multipart/form-data");
  }
  if (error?.code === "missing_file") {
    return fail(response, 400, "MISSING_FILE", "the form has no file field");
  }
  return fail(response, 400, "BAD_MULTIPART", "the multipart body is malformed");
}

/** The §8 upload outcome for a failure: one of the six documented labels. */
function uploadResult(error) {
  if (error?.code === "too_large" || error?.code === "too_many_pixels") return "too_large";
  if (error?.code === "bad_type" || error?.code === "bad_content_type") return "bad_type";
  if (error?.code === "missing_file") return "bad_type";
  if (error?.code === "busy") return "busy";
  return "error";
}

/** Map a processing or storage failure without ever echoing a key or a file name. */
function filesProblem(response, error, log) {
  if (error?.code === "too_large" || error?.code === "too_many_pixels") {
    return fail(response, 413, "TOO_LARGE", "the image is too large");
  }
  if (error?.code === "bad_type") {
    return fail(response, 415, "BAD_TYPE", "the file is not a supported image");
  }
  if (error?.code === "busy") {
    return fail(response, 503, "SERVER_BUSY", "the image queue is full; try again");
  }
  if (error?.code === "not_found") return notFound(response);
  if (error instanceof CommandError) {
    return fail(response, error.status, error.code, error.message);
  }
  log.error?.("[files] request failed:", error?.message ?? error);
  return fail(response, 500, "FILES_FAILED", "the image request failed");
}

/** The row as the upload response describes it (§4.1). */
function fileView(row) {
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    dominantColor: row.dominant_color,
    variants: row.variants,
  };
}

/** A new object never starts larger than the file and never longer than 480 units. */
function fitImage(width, height) {
  const longest = Math.max(width, height);
  const scale = longest > IMAGE_SIDE ? IMAGE_SIDE / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The variant to serve. A stored row normally carries all three, but a row written by an
 * older build or an interrupted variant may miss one: serve the nearest smaller width
 * instead of a 404 the client cannot recover from (§4.2).
 */
export function pickVariant(variants, name) {
  const wanted = VARIANT_WIDTHS[name];
  const entries = Object.entries(variants ?? {})
    .filter(([, entry]) => entry && Number(entry.w) > 0)
    .sort((a, b) => Number(a[1].w) - Number(b[1].w));
  if (!entries.length) return null;
  const exact = entries.find(([key]) => key === name);
  if (exact) return { name: exact[0], ...exact[1] };
  const smaller = entries.filter(([, entry]) => Number(entry.w) <= wanted);
  const chosen = smaller.length ? smaller[smaller.length - 1] : entries[0];
  return { name: chosen[0], ...chosen[1] };
}

/** The name may contain anything; only its last segment is shown, and only on download. */
function originalName(raw) {
  const name = String(raw ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return name || "image";
}

/** RFC 5987 `filename*` value: `encodeURIComponent` leaves four characters it must not. */
function encodeFilename(name) {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function disposition(name) {
  return `attachment; filename="image"; filename*=UTF-8''${encodeFilename(name)}`;
}

function numberField(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function altField(value) {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

/**
 * The quota refused an upload (§4.1 step 5, §7).
 *
 * It is an exception rather than a `null` so the one ingestion path can be used both by
 * the upload route and by a backup import, and the caller still receives the numbers the
 * `402` body needs.
 */
export class QuotaExceeded extends Error {
  constructor(problem) {
    super("the storage quota does not allow this image");
    this.name = "QuotaExceeded";
    this.code = "PLAN_LIMIT";
    this.problem = problem;
  }
}

export function createFilesApi({
  store,
  files,
  getDocument,
  sessionFromRequest,
  accessForBoard,
  linkUnlockToken,
  metrics = null,
  log = console,
  env = process.env,
}) {
  const maxBytes = positive(env.REMO_FILES_MAX_BYTES, DEFAULT_MAX_BYTES);
  const maxPixels = positive(env.REMO_FILES_MAX_PIXELS, DEFAULT_MAX_PIXELS);
  const perRoom = positive(env.REMO_FILES_PER_ROOM, DEFAULT_MAX_PER_ROOM);

  /** §8: every upload attempt ends in exactly one outcome; no org id, no file name. */
  function upload(result, bytes = 0) {
    metrics?.inc("remo_files_uploads_total", { result });
    if (bytes > 0) metrics?.inc("remo_files_upload_bytes_total", undefined, bytes);
  }

  /** Session or public link, resolved the same way the socket and the export routes do. */
  async function resolveAccess(request, boardId) {
    const session = await sessionFromRequest(request, store);
    const resolved = await accessForBoard({
      store,
      boardId,
      userId: session?.user?.id ?? null,
      unlockToken: linkUnlockToken(request),
    });
    if (!resolved?.access?.allowed) return null;
    return { session, resolved, board: resolved.facts.board };
  }

  function audit(event) {
    return store
      .recordAudit?.(event)
      .catch((error) => log.error?.("[files] audit failed:", error.message));
  }

  /**
   * The organisation of a file, for a path that never passed the tenant resolver.
   *
   * `/files/:id/...` is answered before a room — and therefore a tenant — is known, and
   * `FORCE ROW LEVEL SECURITY` hides the row from an unset tenant. `store.fileOrgId` is
   * the `security definer` lookup that answers it (schema 25), the same mechanism
   * `boardOrg` uses for a room; there is no second guess from the board, because the
   * later `fileById` under that organisation already proves the file belongs there.
   */
  async function fileOrg(fileId) {
    if (typeof store.fileOrgId !== "function") return null;
    return store.fileOrgId(fileId).catch(() => null);
  }

  /** Storage quota and the per-room image count (§4.1 step 5, §7). */
  async function quotaProblem(orgId, boardId, incomingBytes, { roomImages = true } = {}) {
    const entitlements = await entitlementsFor(store, orgId);
    const max = entitlements.limits.storageBytes;
    if (max !== null && max !== undefined) {
      const used = await store.storedBytesForOrg();
      if (used + incomingBytes > max) {
        return { limit: "storage", current: used, max, plan: entitlements.plan };
      }
    }
    if (roomImages && perRoom > 0) {
      const count = await store.imageCountForBoard(boardId);
      if (count >= perRoom) {
        return { limit: "room_images", current: count, max: perRoom, plan: entitlements.plan };
      }
    }
    return null;
  }

  /** Remove the keys of an upload that never became a row, or lost a dedup race. */
  async function removeFiles(orgId, fileId) {
    for (const variant of FILE_VARIANTS) {
      try {
        await files.delete(fileKey(orgId, fileId, variant));
      } catch {
        // Best effort: the collector removes a key without a row after a day (§5.4).
      }
    }
  }

  /**
   * One image through the whole pipeline (§4.2): signature, size, quota, decode,
   * variants, storage, row.
   *
   * The upload route and the backup import both end here. A backup asset is exactly an
   * upload with no file field: skipping a step here would let a restored room carry a
   * picture no upload could ever have produced.
   */
  async function ingestImage({
    orgId,
    boardId,
    userId,
    buffer,
    filename = "image",
    roomImages = true,
  }) {
    // The upload route's multipart reader applies the same ceiling; an import arrives as
    // JSON and must check it per asset before a decode.
    if (buffer.length > maxBytes) {
      const error = new Error("the image exceeds the size limit");
      error.code = "too_large";
      throw error;
    }
    // The signature, never the name or the browser's Content-Type.
    const mime = detectImageType(buffer, filename);

    // The quota is asked before the decode, as the order in §4.1 says. `stored_bytes` is
    // larger than the original; the difference is bounded by the variants of the same
    // picture, so the check stays honest at the limit.
    const problem = await quotaProblem(orgId, boardId, buffer.length, { roomImages });
    if (problem) throw new QuotaExceeded(problem);

    const processed = await filesQueue.withSlot(() => processImage(buffer, { maxPixels }));

    const fileId = randomUUID();
    const variants = {};
    let storedBytes = processed.bytes;
    for (const [name, entry] of Object.entries(processed.variants)) {
      variants[name] = {
        w: entry.w,
        h: entry.h,
        bytes: entry.bytes,
        // The read route answers an ETag; the original's sha256 covers its bytes, each
        // variant needs its own.
        sha256: createHash("sha256").update(entry.buffer).digest("hex"),
      };
      storedBytes += entry.bytes;
    }

    try {
      await files.put(fileKey(orgId, fileId, "original"), buffer, {
        contentType: mime,
      });
      for (const [name, entry] of Object.entries(processed.variants)) {
        await files.put(fileKey(orgId, fileId, name), entry.buffer, {
          contentType: "image/webp",
        });
      }
    } catch (error) {
      await removeFiles(orgId, fileId);
      throw error;
    }

    let row;
    try {
      row = await store.createFile({
        id: fileId,
        orgId,
        boardId,
        uploadedBy: userId,
        sha256: processed.sha256,
        mime,
        bytes: processed.bytes,
        storedBytes,
        width: processed.width,
        height: processed.height,
        dominantColor: processed.dominantColor,
        variants,
        originalName: originalName(filename),
      });
    } catch (error) {
      await removeFiles(orgId, fileId);
      throw error;
    }
    if (!row) {
      await removeFiles(orgId, fileId);
      const error = new Error("the image could not be recorded");
      error.code = "not_recorded";
      throw error;
    }
    // The same bytes already have a ready row in this organisation (§3.1): the existing
    // id is reused and the keys written for the rejected id are removed.
    if (row.id !== fileId) await removeFiles(orgId, fileId);
    return {
      row,
      // The id this upload asked the store for, not the deduplicated row id: it names
      // one attempt and is what the command's idempotency key must use.
      uploadId: fileId,
      mime,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
      dominantColor: processed.dominantColor,
    };
  }

  async function handleUpload(request, response, boardId) {
    if (request.method !== "POST") {
      return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST");
    }
    const access = await resolveAccess(request, boardId);
    const userId = access?.session?.user?.id ?? null;
    // A public link is view-only, and an unauthenticated answer must match a missing
    // room: no upload and no confirmation that the room exists.
    if (!access || !userId || !access.resolved.access.capabilities.includes("board.edit")) {
      return notFound(response);
    }
    const orgId = access.board?.orgId ?? null;
    if (!orgId) return notFound(response);

    // 60 uploads per person in ten minutes (§4.1). The same in-memory limiter as sign-in;
    // a restart forgetting the window is an accepted v1 limit.
    if (!reserveAttempt(`upload:${userId}`, { limit: 60, windowMs: 10 * 60_000 })) {
      upload("busy");
      return fail(response, 429, "RATE_LIMITED", "too many uploads; try again later");
    }

    let parsed;
    try {
      parsed = await readMultipart(request, { maxBytes });
    } catch (error) {
      upload(uploadResult(error));
      return multipartProblem(response, error);
    }
    if (!parsed.file) {
      upload("bad_type");
      return fail(response, 400, "MISSING_FILE", "the form has no file field");
    }

    // `replace` names the object whose file is being changed (`spec/images.md` §5.3).
    // A replacement adds no object, so it does not spend the room's image count.
    const replaceId =
      typeof parsed.fields.replace === "string" ? parsed.fields.replace.slice(0, 200) : "";

    let ingested;
    try {
      ingested = await ingestImage({
        orgId,
        boardId,
        userId,
        buffer: parsed.file.buffer,
        filename: parsed.file.filename,
        roomImages: !replaceId,
      });
    } catch (error) {
      if (error instanceof QuotaExceeded) {
        upload("quota");
        return planLimitResponse(response, error.problem);
      }
      upload(uploadResult(error));
      return filesProblem(response, error, log);
    }
    const { row, uploadId, mime, bytes, width, height, dominantColor } = ingested;

    const size = fitImage(width, height);
    const actor = { type: "user", id: userId, name: access.session.user.name ?? null };
    // A replacement ends in `board.image.replace`, not in a second object that the client
    // would have to delete (§5.3). Everything else still creates its object here (§5.1).
    const command = replaceId ? "board.image.replace" : "board.image.create";
    let outcome;
    try {
      // One command, after the bytes and the row exist: nobody else ever sees a
      // half-uploaded object (§5.1).
      outcome = await applyBoardCommand({
        store,
        boardId,
        orgId,
        actor,
        command,
        input: replaceId
          ? { boardId, widgetId: replaceId, fileId: row.id }
          : {
              fileId: row.id,
              naturalWidth: width,
              naturalHeight: height,
              dominantColor,
              alt: altField(parsed.fields.alt),
              x: numberField(parsed.fields.x),
              y: numberField(parsed.fields.y),
              width: size.width,
              height: size.height,
            },
        // The upload's own id, not the deduplicated file id: two deliberate uploads of
        // one picture are two objects, while a retried request replays one.
        idempotencyKey: `${replaceId ? "replace" : "upload"}:${uploadId}`,
        capabilities: access.resolved.access.capabilities,
        getDocument,
      });
    } catch (error) {
      upload("error");
      return filesProblem(response, error, log);
    }

    const actorId = userId;
    await audit({
      actorId,
      orgId,
      boardId,
      action: "file.uploaded",
      subject: row.id,
      after: { bytes, mime },
    });
    await audit({
      actorId,
      orgId,
      boardId,
      action: "board.command",
      subject: command,
      after: {
        resultId: outcome.result?.id ?? null,
        version: outcome.version,
        replayed: outcome.replayed === true,
      },
    });

    upload("ok", parsed.file.buffer.length);
    return json(response, 201, { file: fileView(row) });
  }

  async function handleVariant(request, response, fileId, variantName, url) {
    if (request.method !== "GET") {
      return fail(response, 405, "METHOD_NOT_ALLOWED", "use GET");
    }
    if (!READ_VARIANTS.includes(variantName)) return notFound(response);
    const boardId = url.searchParams.get("board");
    if (!boardId) return notFound(response);

    const orgId = await fileOrg(fileId);
    if (!orgId) return notFound(response);

    let prepared = null;
    try {
      prepared = await store.withTenant(orgId, async () => {
        const access = await resolveAccess(request, boardId);
        // The board must belong to the same organisation as the file; otherwise the
        // tenant below would already hide the row, but say it once and clearly.
        if (!access || access.board?.orgId !== orgId) return null;
        const row = await store.fileById(fileId);
        if (!row || row.status !== "ready") return null;
        // §4.3 point 2: the room must actually use the file, or every member of any room
        // in the organisation could read the rest of its files by guessing ids.
        if (!(await store.fileUsedInBoard(fileId, boardId))) return null;
        const choice = pickVariant(row.variants, variantName);
        if (!choice) return null;
        const stream = await files.get(fileKey(row.org_id, fileId, choice.name));
        return { stream, row, choice };
      });
    } catch (error) {
      return filesProblem(response, error, log);
    }
    if (!prepared) return notFound(response);

    const headers = {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // The bytes behind one id and variant never change (§4.3).
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: `"${prepared.choice.sha256 ?? prepared.row.sha256}"`,
    };
    if (prepared.choice.bytes !== undefined) {
      headers["Content-Length"] = String(prepared.choice.bytes);
    }
    response.writeHead(200, headers);
    try {
      await pipeline(prepared.stream, response);
    } catch (error) {
      // Headers are already sent; the only honest action is to break the response so the
      // client sees a failed image instead of a silent zero-byte one.
      log.error?.("[files] variant stream failed:", error?.message ?? error);
      response.destroy(error);
    }
    return true;
  }

  async function handleOriginal(request, response, fileId, url) {
    if (request.method !== "GET") {
      return fail(response, 405, "METHOD_NOT_ALLOWED", "use GET");
    }
    const boardId = url.searchParams.get("board");
    if (!boardId) return notFound(response);

    const orgId = await fileOrg(fileId);
    if (!orgId) return notFound(response);

    let prepared = null;
    try {
      prepared = await store.withTenant(orgId, async () => {
        const access = await resolveAccess(request, boardId);
        if (!access || access.board?.orgId !== orgId) return null;
        // The untouched original keeps its metadata, so only export may take it (§1.4–5).
        if (!access.resolved.access.capabilities.includes("board.export")) return null;
        const row = await store.fileById(fileId);
        if (!row || row.status !== "ready") return null;
        if (!(await store.fileUsedInBoard(fileId, boardId))) return null;
        const stream = await files.get(fileKey(row.org_id, fileId, "original"));
        return { stream, row };
      });
    } catch (error) {
      return filesProblem(response, error, log);
    }
    if (!prepared) return notFound(response);

    await audit({
      actorId: null,
      orgId,
      boardId,
      action: "file.downloaded_original",
      subject: fileId,
    });

    response.writeHead(200, {
      "Content-Type": prepared.row.mime,
      "Content-Length": String(prepared.row.bytes),
      "Content-Disposition": disposition(originalName(prepared.row.original_name)),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // An original is personal data; no shared cache may keep it.
      "Cache-Control": "private, no-store",
      ETag: `"${prepared.row.sha256}"`,
    });
    try {
      await pipeline(prepared.stream, response);
    } catch (error) {
      log.error?.("[files] original stream failed:", error?.message ?? error);
      response.destroy(error);
    }
    return true;
  }

  async function handleCopy(request, response, targetBoardId, fileId) {
    if (request.method !== "POST") {
      return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST");
    }
    const target = await resolveAccess(request, targetBoardId);
    const userId = target?.session?.user?.id ?? null;
    if (!target || !userId || !target.resolved.access.capabilities.includes("board.edit")) {
      return notFound(response);
    }
    const targetOrgId = target.board?.orgId ?? null;
    if (!targetOrgId) return notFound(response);

    const sourceOrgId = await fileOrg(fileId);
    if (!sourceOrgId) return notFound(response);

    // Two rooms, two tenants: leave the request's organisation, read the source under its
    // own, and come back. A plain cross-tenant read would be the wrong boundary.
    const source = await withoutTenant(() =>
      store.withTenant(sourceOrgId, () => store.fileById(fileId)),
    );
    if (!source || source.status !== "ready" || !source.board_id) {
      return notFound(response);
    }
    const sourceAccess = await withoutTenant(() =>
      store.withTenant(sourceOrgId, () => resolveAccess(request, source.board_id)),
    );
    if (!sourceAccess) return notFound(response);

    // Inside one organisation the same fileId is reused and nothing is copied (§5.2).
    if (sourceOrgId === targetOrgId) {
      return json(response, 200, { file: fileView(source) });
    }

    const problem = await quotaProblem(targetOrgId, targetBoardId, Number(source.stored_bytes), {
      roomImages: false,
    });
    if (problem) return planLimitResponse(response, problem);

    const newId = randomUUID();
    try {
      for (const variant of FILE_VARIANTS) {
        const stream = await files.get(fileKey(sourceOrgId, fileId, variant));
        await files.put(fileKey(targetOrgId, newId, variant), stream, {
          contentType: variant === "original" ? source.mime : "image/webp",
        });
      }
    } catch (error) {
      await removeFiles(targetOrgId, newId);
      return filesProblem(response, error, log);
    }

    let row;
    try {
      row = await store.copyFileForBoard({
        fileId,
        targetOrgId,
        boardId: targetBoardId,
        uploadedBy: userId,
        // The route owns the id so the keys above and the row below cannot disagree.
        id: newId,
      });
    } catch (error) {
      await removeFiles(targetOrgId, newId);
      return filesProblem(response, error, log);
    }
    if (!row) {
      await removeFiles(targetOrgId, newId);
      return notFound(response);
    }
    // The target organisation already had these bytes: its row is the answer and the
    // keys we wrote are duplicates.
    if (row.id !== newId) await removeFiles(targetOrgId, newId);

    await audit({
      actorId: userId,
      orgId: targetOrgId,
      boardId: targetBoardId,
      action: "file.copied",
      subject: row.id,
      after: { sourceFileId: fileId },
    });
    return json(response, 201, { file: fileView(row) });
  }

  /**
   * @returns {Promise<boolean>} true when the request was one of the image routes.
   */
  async function handleFilesRoutes({ request, response, url }) {
    const upload = /^\/boards\/([^/]+)\/files$/.exec(url.pathname);
    const copy = /^\/boards\/([^/]+)\/files\/([^/]+)\/copy$/.exec(url.pathname);
    const read = /^\/files\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!upload && !copy && !read) return false;

    // A disk-only service has no `files` row and no command log; say so once instead of
    // pretending an upload was stored.
    if (typeof store.fileById !== "function" || !files) {
      if (read) notFound(response);
      else fail(response, 501, "FILES_UNAVAILABLE", "files need the postgres store");
      return true;
    }

    if (upload) {
      await handleUpload(request, response, decodeURIComponent(upload[1]));
      return true;
    }
    if (copy) {
      await handleCopy(
        request,
        response,
        decodeURIComponent(copy[1]),
        decodeURIComponent(copy[2]),
      );
      return true;
    }

    const fileId = decodeURIComponent(read[1]);
    const variant = decodeURIComponent(read[2]);
    if (!FILE_ID.test(fileId)) {
      notFound(response);
      return true;
    }
    if (variant === "original") {
      await handleOriginal(request, response, fileId, url);
    } else {
      await handleVariant(request, response, fileId, variant, url);
    }
    return true;
  }

  // A backup import stores its pictures through the same pipeline; the export route gets
  // this function rather than a second copy of the upload steps.
  return { handleFilesRoutes, ingestImage };
}
