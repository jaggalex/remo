/**
 * Comments are rows beside the document (ADR-104/105), not Yjs state.
 *
 * A thread has one anchor and a flat list of messages; resolve is a column, not a delete.
 * The read marker is per subject so unread is a query, not a counter that can drift.
 */
export const commentMethods = {
  async createCommentThread({ boardId, anchor, authorId, authorName, body }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: threads } = await client.query(
        `insert into comment_threads
           (board_id, anchor_kind, widget_id, x, y, created_by, created_by_name)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          boardId,
          anchor.kind,
          anchor.kind === "widget" ? anchor.widgetId : null,
          anchor.kind === "point" ? anchor.x : null,
          anchor.kind === "point" ? anchor.y : null,
          authorId,
          authorName,
        ],
      );
      const thread = threads[0];
      const { rows: comments } = await client.query(
        `insert into comments (thread_id, board_id, author_id, author_name, body)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [thread.id, boardId, authorId, authorName, body],
      );
      await client.query("commit");
      return { thread, comment: comments[0] };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async listCommentThreads(boardId, subjectId = null) {
    const [threads, comments, reads] = await Promise.all([
      this.pool.query(
        `select * from comment_threads
          where board_id = $1
          order by (resolved_at is null) desc, updated_at desc`,
        [boardId],
      ),
      this.pool.query(
        `select * from comments where board_id = $1 order by created_at asc`,
        [boardId],
      ),
      subjectId
        ? this.pool.query(
            `select thread_id, last_read_at from comment_reads where subject_id = $1`,
            [subjectId],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const byThread = new Map();
    for (const comment of comments.rows) {
      const list = byThread.get(comment.thread_id) ?? [];
      list.push(comment);
      byThread.set(comment.thread_id, list);
    }
    const readAt = new Map(reads.rows.map((row) => [row.thread_id, row.last_read_at]));

    return threads.rows.map((thread) => {
      const list = byThread.get(thread.id) ?? [];
      const last = readAt.get(thread.id);
      const unread = list.filter(
        (comment) =>
          !comment.deleted_at &&
          comment.author_id !== subjectId &&
          (!last || new Date(comment.created_at) > new Date(last)),
      ).length;
      return { ...thread, comments: list, unread };
    });
  },

  async addComment(threadId, boardId, authorId, authorName, body) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const found = await client.query(
        "select id from comment_threads where id = $1 and board_id = $2",
        [threadId, boardId],
      );
      if (!found.rows[0]) {
        await client.query("rollback");
        return null;
      }
      const { rows } = await client.query(
        `insert into comments (thread_id, board_id, author_id, author_name, body)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [threadId, boardId, authorId, authorName, body],
      );
      await client.query(
        `update comment_threads
            set updated_at = now(), resolved_at = null, resolved_by = null
          where id = $1`,
        [threadId],
      );
      await client.query("commit");
      return rows[0];
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async resolveCommentThread(threadId, boardId, resolved, userId) {
    const { rows } = await this.pool.query(
      `update comment_threads
          set resolved_at = case when $3 then now() else null end,
              resolved_by = case when $3 then $4::uuid else null end,
              updated_at = now()
        where id = $1 and board_id = $2
        returning *`,
      [threadId, boardId, resolved, userId],
    );
    return rows[0] ?? null;
  },

  async getComment(commentId, boardId) {
    const { rows } = await this.pool.query(
      "select * from comments where id = $1 and board_id = $2 and deleted_at is null",
      [commentId, boardId],
    );
    return rows[0] ?? null;
  },

  async editComment(commentId, boardId, body) {
    const { rows } = await this.pool.query(
      `update comments set body = $3, edited_at = now()
        where id = $1 and board_id = $2 and deleted_at is null
        returning *`,
      [commentId, boardId, body],
    );
    return rows[0] ?? null;
  },

  async deleteComment(commentId, boardId) {
    const { rows } = await this.pool.query(
      `update comments set deleted_at = now()
        where id = $1 and board_id = $2 and deleted_at is null
        returning *`,
      [commentId, boardId],
    );
    return rows[0] ?? null;
  },

  async markCommentRead(threadId, boardId, subjectId) {
    const found = await this.pool.query(
      "select id from comment_threads where id = $1 and board_id = $2",
      [threadId, boardId],
    );
    if (!found.rows[0]) return false;
    await this.pool.query(
      `insert into comment_reads (thread_id, subject_id, last_read_at)
       values ($1, $2, now())
       on conflict (thread_id, subject_id) do update set last_read_at = now()`,
      [threadId, subjectId],
    );
    return true;
  },

  /**
   * Replace every comment on a board with the threads from a verified backup (ADR-071).
   *
   * Import already replaces the document, so the discussion follows it: the old rows are
   * deleted and the backup's threads recreated. Author ids are not in a backup, so the
   * display name is kept and the account link is dropped — a restored thread is history,
   * not an invitation to impersonate.
   */
  async replaceCommentsFromBackup(boardId, threads) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from comment_threads where board_id = $1", [boardId]);
      let restored = 0;
      for (const thread of Array.isArray(threads) ? threads : []) {
        const anchor = thread?.anchor;
        const isWidget =
          anchor?.kind === "widget" &&
          typeof anchor.widgetId === "string" &&
          anchor.widgetId.length > 0;
        const isPoint =
          anchor?.kind === "point" &&
          Number.isFinite(anchor.x) &&
          Number.isFinite(anchor.y);
        if (!isWidget && !isPoint) continue;
        const { rows } = await client.query(
          `insert into comment_threads
             (board_id, anchor_kind, widget_id, x, y, resolved_at,
              created_by_name, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7,
                   coalesce($8::timestamptz, now()), coalesce($8::timestamptz, now()))
           returning id`,
          [
            boardId,
            isWidget ? "widget" : "point",
            isWidget ? anchor.widgetId : null,
            isPoint ? anchor.x : null,
            isPoint ? anchor.y : null,
            typeof thread.resolvedAt === "string" ? thread.resolvedAt : null,
            typeof thread.createdByName === "string" ? thread.createdByName : "",
            typeof thread.createdAt === "string" ? thread.createdAt : null,
          ],
        );
        const threadId = rows[0].id;
        for (const comment of Array.isArray(thread.comments) ? thread.comments : []) {
          const body = typeof comment?.body === "string" ? comment.body.trim() : "";
          if (!body || body.length > 4000) continue;
          await client.query(
            `insert into comments
               (thread_id, board_id, author_id, author_name, body,
                created_at, edited_at, deleted_at)
             values ($1, $2, null, $3, $4,
                     coalesce($5::timestamptz, now()), $6, $7)`,
            [
              threadId,
              boardId,
              typeof comment.authorName === "string" ? comment.authorName : "",
              body,
              typeof comment.createdAt === "string" ? comment.createdAt : null,
              typeof comment.editedAt === "string" ? comment.editedAt : null,
              typeof comment.deletedAt === "string" ? comment.deletedAt : null,
            ],
          );
        }
        await client.query(
          `update comment_threads
              set updated_at = coalesce(
                    (select max(created_at) from comments where thread_id = $1),
                    created_at)
            where id = $1`,
          [threadId],
        );
        restored += 1;
      }
      await client.query("commit");
      return restored;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async commentsForBackup(boardId) {
    const threads = await this.listCommentThreads(boardId, null);
    return threads.map((thread) => ({
      anchor:
        thread.anchor_kind === "widget"
          ? { kind: "widget", widgetId: thread.widget_id }
          : { kind: "point", x: thread.x, y: thread.y },
      resolvedAt: thread.resolved_at,
      createdByName: thread.created_by_name,
      comments: thread.comments.map((comment) => ({
        authorName: comment.author_name,
        // A deleted comment's text stays in the row for moderation, but a backup is
        // not a moderation surface: the DTO already hides it, and so must this.
        body: comment.deleted_at ? "" : comment.body,
        createdAt: comment.created_at,
        editedAt: comment.edited_at,
        deletedAt: comment.deleted_at,
      })),
    }));
  },
};
