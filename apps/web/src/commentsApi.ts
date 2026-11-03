import { call } from "./api";

/**
 * Comments API (ADR-104/105).
 *
 * Kept beside the main API object rather than inside it: the object is already at the
 * 800-line budget, and comments are one domain with their own DTOs.
 */
export type CommentAnchor =
  | { kind: "widget"; widgetId: string }
  | { kind: "point"; x: number; y: number };

export interface CommentMessage {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** The shape a backup stores: display names and timestamps, no account ids. */
export interface BackupCommentThread {
  anchor: CommentAnchor;
  resolvedAt: string | null;
  createdByName: string;
  createdAt?: string;
  comments: Array<{
    authorName: string;
    body: string;
    createdAt?: string;
    editedAt?: string | null;
    deletedAt?: string | null;
  }>;
}

export interface CommentThread {
  id: string;
  boardId: string;
  anchor: CommentAnchor;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  unread: number;
  comments: CommentMessage[];
}

const board = (id: string) => `/boards/${encodeURIComponent(id)}/comments`;

export const commentsApi = {
  list: (boardId: string) => call<{ threads: CommentThread[] }>(board(boardId)),
  create: (boardId: string, anchor: CommentAnchor, body: string) =>
    call<{ thread: CommentThread }>(board(boardId), {
      method: "POST",
      body: { anchor, body },
    }),
  reply: (boardId: string, threadId: string, body: string) =>
    call<{ comment: CommentMessage }>(
      `${board(boardId)}/${encodeURIComponent(threadId)}/replies`,
      { method: "POST", body: { body } },
    ),
  resolve: (boardId: string, threadId: string, resolved: boolean) =>
    call<{ thread: CommentThread }>(
      `${board(boardId)}/${encodeURIComponent(threadId)}`,
      { method: "PATCH", body: { resolved } },
    ),
  read: (boardId: string, threadId: string) =>
    call<{ ok: true }>(`${board(boardId)}/${encodeURIComponent(threadId)}/read`, {
      method: "POST",
    }),
  edit: (boardId: string, commentId: string, body: string) =>
    call<{ comment: CommentMessage }>(
      `/boards/${encodeURIComponent(boardId)}/comment-messages/${encodeURIComponent(commentId)}`,
      { method: "PATCH", body: { body } },
    ),
  restore: (boardId: string, threads: BackupCommentThread[]) =>
    call<{ restored: number }>(`${board(boardId)}/restore`, {
      method: "POST",
      body: { threads },
    }),
  remove: (boardId: string, commentId: string) =>
    call<{ comment: CommentMessage }>(
      `/boards/${encodeURIComponent(boardId)}/comment-messages/${encodeURIComponent(commentId)}`,
      { method: "DELETE" },
    ),
};
