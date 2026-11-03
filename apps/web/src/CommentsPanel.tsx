import { useCallback, useEffect, useState } from "react";
import type { BoardConnection, Presence } from "@remo/doc";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { commentsApi, type CommentAnchor, type CommentMessage, type CommentThread } from "./commentsApi";
import { currentRoom } from "./identity";
import { threadInFrame } from "./commentScope";
import { CommentPlacementLayer } from "./CommentPlacementLayer";
import { ConfirmDialog as UiConfirmDialog, Icon } from "@remo/ui";
import { formatMoment } from "./format";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";

/**
 * Discussion beside the board (ADR-104/105).
 *
 * Threads are server rows, so the panel can be opened by a commenter who has no document
 * write. The canvas stays visible, and a pin marks the place a thread belongs to. New
 * threads arrive as a socket nudge (message 11), not as a document update and not as a
 * timer: one mechanism for one job.
 */
export function CommentsPanel({
  connection,
  presence,
  widgets,
  camera,
  viewport,
  layouts,
  selectedIds,
  meId,
  canComment,
  canManage,
  commentRequest,
  onSelectWidget,
  open,
  onOpen,
  onUnread,
}: {
  connection: BoardConnection | null;
  presence: Presence[];
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  layouts: Map<string, KanbanLayout>;
  selectedIds: readonly string[];
  meId: string | null;
  canComment: boolean;
  canManage: boolean;
  /** Increments when the rail asks for placement; the panel owns the mode. */
  commentRequest: number;
  onSelectWidget: (ids: string[]) => void;
  /** The header owns whether the panel is open; the rail can still ask for placement. */
  open: boolean;
  onOpen: (value: boolean) => void;
  /** Unread count for the header button; a badge the panel already computes. */
  onUnread: (value: number) => void;
}) {
  const { t, lang } = useI18n();
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CommentMessage | null>(null);
  const [online, setOnline] = useState(() => connection?.status() === "connected");
  const boardId = currentRoom();
  const unread = threads.reduce((total, thread) => total + thread.unread, 0);
  const activeThread = threads.find((thread) => thread.id === active) ?? null;
  // A presenter sees the discussion of the slide being shown, not the whole board.
  const presentingFrameId =
    presence.find((peer) => peer.presenting)?.presenting?.frameId ?? null;
  useEffect(() => {
    onUnread(unread);
  }, [onUnread, unread]);

  const visibleThreads = threads.filter(
    (thread) =>
      (showResolved || !thread.resolvedAt) &&
      threadInFrame(thread, presentingFrameId, widgets),
  );

  const load = useCallback(async () => {
    try {
      const result = await commentsApi.list(boardId);
      setThreads(result.threads);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [boardId]);

  useEffect(() => {
    void load();
    if (!connection) return;
    const offComments = connection.onCommentsChanged(() => void load());
    // A missed nudge while disconnected is recovered here, so the frame needs no queue.
    const offStatus = connection.onStatus((status) => {
      setOnline(status === "connected");
      if (status === "connected") void load();
    });
    return () => {
      offComments();
      offStatus();
    };
  }, [connection, load]);

  // The rail asks for placement with a counter: same mode as the panel's own button.
  useEffect(() => {
    if (!commentRequest) return;
    onOpen(true);
    setPlacing(true);
  }, [commentRequest]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const anchorLabel = (thread: CommentThread) => {
    const anchor = thread.anchor;
    if (anchor.kind === "point") return t("comments.point");
    const widget = widgets.find((entry) => entry.id === anchor.widgetId);
    if (!widget) return t("comments.orphan");
    return widget.title || widget.content || widget.id;
  };

  /**
   * The pin follows the anchor, not a stored screen position: a widget may be moved and
   * the camera moves all the time, so the place is recomputed from world coordinates.
   */
  const pinAt = (thread: CommentThread) => {
    let world: { x: number; y: number } | null = null;
    const anchor = thread.anchor;
    if (anchor.kind === "point") {
      world = { x: anchor.x, y: anchor.y };
    } else {
      const widget = widgets.find((entry) => entry.id === anchor.widgetId);
      if (widget) world = { x: widget.x + widget.width / 2, y: widget.y };
    }
    if (!world) return null;
    return {
      x: viewport.width / 2 + (world.x - camera.x) * camera.zoom,
      y: viewport.height / 2 + (world.y - camera.y) * camera.zoom,
    };
  };

  const startPlacing = () => {
    if (!canComment || !online) return;
    onOpen(true);
    setPlacing(true);
  };

  const anchorLabelOf = (anchor: CommentAnchor) => {
    if (anchor.kind === "point") return t("comments.point");
    const widget = widgets.find((entry) => entry.id === anchor.widgetId);
    return widget?.title || widget?.content || t("comments.orphan");
  };

  const submitComment = () => {
    if (!pendingAnchor || !draft.trim() || !online) return;
    void run(async () => {
      const created = await commentsApi.create(boardId, pendingAnchor, draft.trim());
      setActive(created.thread.id);
      setPendingAnchor(null);
      setDraft("");
      onOpen(true);
    });
  };

  const sendReply = () => {
    if (!activeThread || !reply.trim() || !online) return;
    void run(async () => {
      await commentsApi.reply(boardId, activeThread.id, reply.trim());
      setReply("");
    });
  };

  const openThread = (thread: CommentThread) => {
    setActive(thread.id);
    setReply("");
    if (thread.anchor.kind === "widget") onSelectWidget([thread.anchor.widgetId]);
    if (thread.unread) void commentsApi.read(boardId, thread.id).then(load).catch(() => {});
  };

  const remove = (comment: CommentMessage) => setPendingDelete(comment);

  return (
    <>
      <div className="comment-pins">
        {visibleThreads.map((thread) => {
          const point = pinAt(thread);
          if (!point) return null;
          return (
            <button
              key={thread.id}
              type="button"
              className={`comment-pin${thread.id === active ? " active" : ""}${
                thread.unread ? " unread" : ""
              }`}
              style={{ left: point.x, top: point.y }}
              title={anchorLabel(thread)}
              aria-label={t("comments.openThread", { anchor: anchorLabel(thread) })}
              onClick={() => {
                onOpen(true);
                openThread(thread);
              }}
            >
              {thread.unread ? (
                <span className="comment-pin-count">{thread.unread}</span>
              ) : (
                <Icon name="comment" size={14} />
              )}
            </button>
          );
        })}
      </div>

      {placing && (
        <CommentPlacementLayer
          camera={camera}
          viewport={viewport}
          widgets={widgets}
          layouts={layouts}
          onPick={(anchor) => {
            setPlacing(false);
            setPendingAnchor(anchor);
            setDraft("");
          }}
          onCancel={() => setPlacing(false)}
        />
      )}

      {pendingAnchor && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setPendingAnchor(null)}>
          <div
            className="auth-dialog comment-composer"
            role="dialog"
            aria-modal="true"
            aria-label={t("comments.new")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2>{t("comments.new")}</h2>
            <p className="muted">{t("comments.anchor", { anchor: anchorLabelOf(pendingAnchor) })}</p>
            <textarea
              autoFocus
              maxLength={4000}
              value={draft}
              placeholder={t("comments.prompt")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitComment();
              }}
            />
            <div className="auth-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingAnchor(null)}>
                {t("comments.cancel")}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!draft.trim() || busy}
                onClick={submitComment}
              >
                {t("comments.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <UiConfirmDialog
          title={t("comments.deleteTitle")}
          confirmLabel={t("delete.confirm")}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(() => commentsApi.remove(boardId, target.id));
          }}
        >
          {t("comments.deleteConfirm")}
        </UiConfirmDialog>
      )}

      {open && (
        <aside className="comments-panel" aria-label={t("comments.title")}>
          <header>
            <b>
              {t("comments.title")} <HelpLink topicId="comments.thread" />
            </b>
            <button type="button" onClick={() => onOpen(false)} aria-label={t("comments.close")}>
              ✕
            </button>
          </header>
          <div className="comments-actions">
            <button type="button" disabled={!canComment || !online || busy} onClick={startPlacing}>
              {t("comments.new")}
            </button>
            <label className="comments-toggle">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(event) => setShowResolved(event.target.checked)}
              />
              {t("comments.showResolved")}
            </label>
          </div>
          {presentingFrameId && <p className="muted">{t("comments.slide")}</p>}
          {!online && <p className="comments-offline">{t("comments.offline")}</p>}
          {error && <p className="auth-error">{error}</p>}
          <ul className="comments-list">
            {visibleThreads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className={thread.id === active ? "active" : undefined}
                  onClick={() => openThread(thread)}
                >
                  <b>{anchorLabel(thread)}</b>
                  <span className="muted">
                    {thread.resolvedAt ? t("comments.resolved") : t("comments.open")}
                    {thread.unread ? ` · ${t("comments.unread", { count: thread.unread })}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!visibleThreads.length && <p className="muted">{t("comments.empty")}</p>}
          {activeThread && (
            <section className="comments-thread">
              <div className="comments-thread-head">
                <span>{anchorLabel(activeThread)}</span>
                <button
                  type="button"
                  disabled={!canComment || !online || busy}
                  onClick={() =>
                    void run(() =>
                      commentsApi.resolve(boardId, activeThread.id, !activeThread.resolvedAt),
                    )
                  }
                >
                  {activeThread.resolvedAt ? t("comments.reopen") : t("comments.resolve")}
                </button>
              </div>
              {activeThread.comments.map((comment) => (
                <article key={comment.id} className="comment-message">
                  <div className="comment-meta">
                    <b>{comment.authorName}</b>
                    <span>{formatMoment(comment.createdAt, lang)}</span>
                    {comment.editedAt && <span>{t("comments.edited")}</span>}
                  </div>
                  <p>{comment.deletedAt ? t("comments.deleted") : comment.body}</p>
                  {!comment.deletedAt &&
                    (comment.authorId === meId || canManage) && (
                      <button
                        type="button"
                        className="link-button danger"
                        disabled={busy}
                        onClick={() => remove(comment)}
                      >
                        {t("comments.delete")}
                      </button>
                    )}
                </article>
              ))}
              {canComment && !activeThread.resolvedAt && (
                <div className="comment-reply">
                  <textarea
                    value={reply}
                    maxLength={4000}
                    placeholder={
                      online ? t("comments.replyPlaceholder") : t("comments.replyOffline")
                    }
                    onChange={(event) => setReply(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !online || !reply.trim()}
                    onClick={sendReply}
                  >
                    {t("comments.send")}
                  </button>
                </div>
              )}
            </section>
          )}
        </aside>
      )}
    </>
  );
}
