/**
 * Comments API (ADR-104/105).
 *
 * All routes live under `/boards/:id/comments` so the board is the unit of access. A
 * commenter has `board.comment` but no document write; a link visitor has no account and
 * is refused. Threads are rows; resolve is a column; a reply reopens.
 */
import { accessForBoard, fail, json, linkUnlockToken, readBody } from "./iam-http.mjs";

const MAX_BODY = 4000;

function commentDto(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.deleted_at ? "" : row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

function threadDto(row) {
  return {
    id: row.id,
    boardId: row.board_id,
    anchor:
      row.anchor_kind === "widget"
        ? { kind: "widget", widgetId: row.widget_id }
        : { kind: "point", x: row.x, y: row.y },
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unread: row.unread ?? 0,
    comments: (row.comments ?? []).map(commentDto),
  };
}

function textBody(body) {
  if (typeof body !== "string") return null;
  const value = body.trim();
  return value && value.length <= MAX_BODY ? value : null;
}

function anchorOf(body) {
  const anchor = body?.anchor;
  if (!anchor) return null;
  if (anchor.kind === "widget" && typeof anchor.widgetId === "string" && anchor.widgetId) {
    return { kind: "widget", widgetId: anchor.widgetId };
  }
  if (
    anchor.kind === "point" &&
    Number.isFinite(anchor.x) &&
    Number.isFinite(anchor.y)
  ) {
    return { kind: "point", x: Number(anchor.x), y: Number(anchor.y) };
  }
  return null;
}

export async function handleComments(ctx) {
  const { request, response, url, store, method, parts, user, audit, onCommentsChanged } = ctx;
  if (parts[0] !== "boards" || !["comments", "comment-messages"].includes(parts[2])) {
    return false;
  }

  const boardId = parts[1];
  const threadId = parts[2] === "comments" ? parts[3] : null;
  const leaf = parts[2] === "comments" ? parts[4] : null;
  const messageId = parts[2] === "comment-messages" ? parts[3] : null;

  const sessionUser = user;
  if (!sessionUser) {
    fail(response, 401, "AUTH_REQUIRED", "sign in to use comments");
    return true;
  }

  const resolved = await accessForBoard({
    store,
    boardId,
    userId: sessionUser.id,
    unlockToken: linkUnlockToken(request),
  });
  const access = resolved?.access;

  // A public link is a viewing grant, not an invitation to the discussion.
  const linkOnly =
    access?.sources?.length === 1 && access.sources[0] === "link";
  if (!access?.allowed || linkOnly) {
    fail(response, 403, "ACCOUNT_REQUIRED", "comments need an account with board access");
    return true;
  }
  const canComment = access.capabilities.includes("board.comment");
  const canManage = access.capabilities.includes("board.manage");
  /** Comments are not document state, so peers learn about a change on the socket. */
  const announce = () => void onCommentsChanged?.(boardId);

  // Restoring the discussion is part of replacing the board, so it needs the stronger
  // backup grant, not merely the right to comment (ADR-071, ADR-104 amendment).
  if (method === "POST" && parts[3] === "restore" && parts.length === 4) {
    if (!access.capabilities.includes("board.backup")) {
      return fail(response, 403, "BACKUP_REQUIRED", "restoring a board needs the backup grant"), true;
    }
    const body = await readBody(request);
    if (!Array.isArray(body?.threads)) {
      return fail(response, 422, "COMMENT_THREADS_REQUIRED", "threads are required"), true;
    }
    const restored = await store.replaceCommentsFromBackup(boardId, body.threads);
    await audit({
      actorId: sessionUser.id,
      boardId,
      action: "comment.restored",
      after: { threads: restored },
    });
    announce();
    json(response, 200, { restored });
    return true;
  }

  if (method === "GET" && !threadId) {
    const threads = await store.listCommentThreads(boardId, `user:${sessionUser.id}`);
    json(response, 200, { threads: threads.map(threadDto) });
    return true;
  }

  if (method === "POST" && !threadId) {
    if (!canComment) return fail(response, 403, "COMMENT_FORBIDDEN", "you cannot comment"), true;
    const body = await readBody(request);
    const text = textBody(body?.body);
    const anchor = anchorOf(body);
    if (!text) return fail(response, 422, "COMMENT_BODY_REQUIRED", "write a comment"), true;
    if (!anchor) return fail(response, 422, "COMMENT_ANCHOR_REQUIRED", "anchor a comment"), true;
    const created = await store.createCommentThread({
      boardId,
      anchor,
      authorId: sessionUser.id,
      authorName: sessionUser.name,
      body: text,
    });
    await audit({
      actorId: sessionUser.id,
      boardId,
      action: "comment.created",
      subject: created.thread.id,
      after: { anchor: anchor.kind },
    });
    announce();
    json(response, 201, { thread: threadDto({ ...created.thread, comments: [created.comment], unread: 0 }) });
    return true;
  }

  if (method === "POST" && threadId && leaf === "replies") {
    if (!canComment) return fail(response, 403, "COMMENT_FORBIDDEN", "you cannot comment"), true;
    const body = await readBody(request);
    const text = textBody(body?.body);
    if (!text) return fail(response, 422, "COMMENT_BODY_REQUIRED", "write a comment"), true;
    const comment = await store.addComment(
      threadId,
      boardId,
      sessionUser.id,
      sessionUser.name,
      text,
    );
    if (!comment) return fail(response, 404, "THREAD_NOT_FOUND", "thread not found"), true;
    await audit({
      actorId: sessionUser.id,
      boardId,
      action: "comment.created",
      subject: threadId,
      after: { reply: true },
    });
    announce();
    json(response, 201, { comment: commentDto(comment) });
    return true;
  }

  if (method === "POST" && threadId && leaf === "read") {
    const ok = await store.markCommentRead(
      threadId,
      boardId,
      `user:${sessionUser.id}`,
    );
    if (!ok) return fail(response, 404, "THREAD_NOT_FOUND", "thread not found"), true;
    json(response, 200, { ok: true });
    return true;
  }

  if (method === "PATCH" && threadId && !leaf) {
    if (!canComment) return fail(response, 403, "COMMENT_FORBIDDEN", "you cannot comment"), true;
    const body = await readBody(request);
    if (typeof body?.resolved !== "boolean") {
      return fail(response, 422, "COMMENT_RESOLVE_REQUIRED", "resolved is required"), true;
    }
    const thread = await store.resolveCommentThread(
      threadId,
      boardId,
      body.resolved,
      sessionUser.id,
    );
    if (!thread) return fail(response, 404, "THREAD_NOT_FOUND", "thread not found"), true;
    await audit({
      actorId: sessionUser.id,
      boardId,
      action: body.resolved ? "comment.resolved" : "comment.reopened",
      subject: threadId,
    });
    announce();
    json(response, 200, { thread: threadDto({ ...thread, comments: [], unread: 0 }) });
    return true;
  }

  if (messageId) {
    const comment = await store.getComment(messageId, boardId);
    if (!comment) return fail(response, 404, "COMMENT_NOT_FOUND", "comment not found"), true;
    if (method === "PATCH") {
      if (comment.author_id !== sessionUser.id) {
        return fail(response, 403, "COMMENT_AUTHOR_ONLY", "only the author can edit"), true;
      }
      const body = await readBody(request);
      const text = textBody(body?.body);
      if (!text) return fail(response, 422, "COMMENT_BODY_REQUIRED", "write a comment"), true;
      const edited = await store.editComment(messageId, boardId, text);
      await audit({
        actorId: sessionUser.id,
        boardId,
        action: "comment.edited",
        subject: messageId,
      });
      announce();
      json(response, 200, { comment: commentDto(edited) });
      return true;
    }
    if (method === "DELETE") {
      if (comment.author_id !== sessionUser.id && !canManage) {
        return fail(response, 403, "COMMENT_FORBIDDEN", "only the author or a manager can delete"), true;
      }
      const deleted = await store.deleteComment(messageId, boardId);
      await audit({
        actorId: sessionUser.id,
        boardId,
        action: "comment.deleted",
        subject: messageId,
      });
      announce();
      json(response, 200, { comment: commentDto(deleted) });
      return true;
    }
  }

  return false;
}
