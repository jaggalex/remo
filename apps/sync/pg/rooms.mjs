/**
 * Room lifecycle: bind, flush, project, compact (ADR-016, ADR-148).
 *
 * The log is the source of truth and the projection is a disposable mirror. A command's
 * 200 waits for `flushLog`, so these methods are also the durability boundary.
 */
import { Y } from "../y.mjs";
import { diffRows, projectBoard } from "../project.mjs";

const PROJECTION_DEBOUNCE_MS = 1500;
const LOG_FLUSH_MS = 800;
const COMPACT_AFTER_UPDATES = 200;
const WRITE_TIMEOUT_MS = 10_000;

export const roomMethods = {
/**
 * Serialize every operation that changes a board's room: load, teardown, replacement.
 *
 * A board is opened from two directions — the browser's socket and an HTTP route — and
 * a reload tears the old room down while the next one is being built. Each of those used
 * to read `rooms` and then `await` the database, so two callers could both decide the
 * room was missing and build rival documents, each with its own projection pass. The
 * queue is a promise chain per board id: the second caller waits for the first result
 * and then sees the room it created (ADR-148). No timer, no polling.
 */
withRoomLock(docName, run) {
  this.roomLocks ??= new Map();
  const previous = this.roomLocks.get(docName) ?? Promise.resolve();
  const result = previous.then(run, run);
  // The chain must survive a rejection: the next caller queued on it still has to run.
  const tail = result.then(
    () => {},
    () => {},
  );
  this.roomLocks.set(docName, tail);
  void tail.then(() => {
    if (this.roomLocks.get(docName) === tail) this.roomLocks.delete(docName);
  });
  return result;
},

/**
 * Bind the room a socket will edit. The socket's document owns the room; a concurrent
 * HTTP load waits for this one instead of building a rival (ADR-148).
 */
async bindState(docName, ydoc) {
  await this.loadRoom(docName, ydoc);
},

/**
 * The one load of a room. Returns the document that now owns the room: the caller's own
 * (`bindState`) or the one already bound (`roomDocument`). A second caller with no
 * document of its own gets the existing room instead of loading another copy.
 */
async loadRoom(docName, provided = null) {
  return this.withRoomLock(docName, async () => {
    const current = this.rooms.get(docName);
    if (current && (!provided || current.ydoc === provided)) return current.ydoc;

    if (current) {
      // A room can be torn down and rebuilt while a previous document instance still
      // has buffered updates. Flushing the old instance first keeps them from being
      // stranded — nothing else would ever write them.
      this.log.log(`[sync] ${docName}: new document instance, flushing the previous one`);
      await this.releaseRoom(current);
    }

    const ydoc = provided ?? new Y.Doc();
    await this.readBoardState(docName, ydoc);
    this.attachRoom(docName, ydoc);
    return ydoc;
  });
},

/** Read the snapshot and the log as one consistent state into a fresh document. */
async readBoardState(docName, ydoc) {
  const client = await this.pool.connect();
  try {
    // Snapshot and log must be read as one consistent state. A teardown of the previous
    // document (`writeState` after the last socket closes, which is every reload) folds
    // the log into the snapshot and deletes the folded rows; two separate reads could
    // take the old snapshot and then find the log already empty — an empty room that
    // projected itself over the stored board. One statement cannot straddle a commit.
    const { rows } = await client.query(
      `select b.snapshot, b.snapshot_through, u.id as update_id, u.update
         from boards b
         left join board_updates u
           on u.board_id = b.id and u.id > coalesce(b.snapshot_through, 0)
        where b.id = $1
        order by u.id asc`,
      [docName],
    );

    if (rows.length === 0) {
      await client.query("insert into boards (id) values ($1) on conflict do nothing", [
        docName,
      ]);
      this.log.log(`[sync] new room ${docName}`);
    } else {
      const snapshot = rows[0].snapshot;
      if (snapshot?.length) Y.applyUpdate(ydoc, new Uint8Array(snapshot));

      let updates = 0;
      for (const row of rows) {
        if (!row.update) continue;
        Y.applyUpdate(ydoc, new Uint8Array(row.update));
        updates += 1;
      }
      this.log.log(
        `[sync] loaded ${docName} (snapshot${snapshot?.length ? "" : ": none"}, ${updates} updates)`,
      );
    }
  } finally {
    client.release();
  }
},

/** Create the room object for a loaded document and start its timers. */
attachRoom(docName, ydoc) {
  const room = {
    docName,
    ydoc,
    pendingUpdates: [],
    writing: false,
    writingSince: 0,
    logTimer: null,
    projectionTimer: null,
    projection: { title: "", widgets: [], kanban: { columns: [], swimlanes: [], cards: [] } },
    logWriting: false,
    fullRefresh: true,
    /** Shared in-flight teardown, so a reload and the closing socket cannot run two. */
    teardown: null,
    /** A retired room may not write the mirror again (ADR-148). */
    retired: false,
    handlers: null,
  };
  this.rooms.set(docName, room);

  /**
   * The projection is a passive mirror, so it can be stale: a room may have been
   * written to the log or the snapshot after the last projection pass (for
   * example during a shutdown), and nothing would notice on load. The first
   * refresh after opening a room therefore rewrites it wholesale, which makes
   * "the database matches the document" true again. Subsequent refreshes diff.
   */
  room.projection = projectBoard(ydoc);
  room.fullRefresh = true;

  const onUpdate = (update, origin) => {
    if (process.env.REMO_DEBUG) {
      this.log.log(
        `[debug] update on ${docName}: ${update.length}B origin=${String(origin)} widgets=${ydoc.getMap("widgets").size} kanbans=${ydoc.getMap("kanbans").size}`,
      );
    }
    room.pendingUpdates.push(Buffer.from(update));
    this.scheduleLogFlush(room);
    this.scheduleProjection(room);
  };

  const onDestroy = () => {
    // `writeState` itself checks that this document still owns the room.
    void this.writeState(docName, ydoc);
  };

  room.handlers = { update: onUpdate, destroy: onDestroy };
  ydoc.on("update", onUpdate);
  ydoc.on("destroy", onDestroy);

  // Reconcile immediately: the mirror may have missed writes that only reached
  // the log or the snapshot, and nothing else would ever notice.
  this.scheduleProjection(room);
},

/** The room still owns the mirror and is not on its way out. */
isCurrentRoom(room) {
  return !room.retired && this.rooms.get(room.docName) === room;
},

scheduleLogFlush(room) {
  if (room.logTimer) return;
  room.logTimer = setTimeout(() => {
    room.logTimer = null;
    void this.flushLog(room);
  }, LOG_FLUSH_MS);
},

scheduleProjection(room) {
  if (room.projectionTimer) return;
  room.projectionTimer = setTimeout(() => {
    room.projectionTimer = null;
    void this.refreshProjection(room);
  }, PROJECTION_DEBOUNCE_MS);
},

async flushLog(room) {
  if (this.isBusy(room) || room.logWriting) {
    // A projection or an earlier flush is in progress; try again rather than
    // leaving the log timer empty and the save indicator stuck on `pending`.
    this.scheduleLogFlush(room);
    return;
  }
  if (!room.pendingUpdates.length) return;
  room.logWriting = true;
  const batch = room.pendingUpdates.splice(0, room.pendingUpdates.length);
  try {
    const values = [];
    const params = [];
    batch.forEach((update, index) => {
      values.push(`($1, $${index + 2})`);
      params.push(update);
    });
    await this.pool.query(
      `insert into board_updates (board_id, update) values ${values.join(", ")}`,
      [room.docName, ...params],
    );
    await this.pool.query("update boards set updated_at = now() where id = $1", [room.docName]);
  } catch (error) {
    // Put the batch back so a later flush can retry, and keep serving clients.
    room.pendingUpdates.unshift(...batch);
    this.metrics?.inc("remo_store_write_errors_total");
    this.log.error(`[sync] failed to log updates for ${room.docName}:`, error.message);
    this.scheduleLogFlush(room);
    return;
  } finally {
    room.logWriting = false;
  }

  this.metrics?.inc("remo_store_writes_total", undefined, batch.length);

  const { rows } = await this.pool.query(
    "select count(*)::int as pending from board_updates where board_id = $1",
    [room.docName],
  );
  if (rows[0].pending >= COMPACT_AFTER_UPDATES) await this.compact(room);

  if (room.pendingUpdates.length > 0) {
    // Updates arrived during the insert; keep them for the next batch instead of
    // acknowledging a write that is not on disk yet.
    this.scheduleLogFlush(room);
    return;
  }
  try {
    this.onPersisted?.(room.docName);
  } catch (error) {
    this.log.error(`[sync] persistence listener failed for ${room.docName}:`, error.message);
  }
},

beginWrite(room, what) {
  if (room.writing) {
    if (Date.now() - room.writingSince < WRITE_TIMEOUT_MS) return false;
    this.log.error(
      `[sync] ${what} for ${room.docName} was stuck for ${Date.now() - room.writingSince}ms; recovering`,
    );
  }
  room.writing = true;
  room.writingSince = Date.now();
  return true;
},

isBusy(room) {
  if (!room.writing) return false;
  if (Date.now() - room.writingSince < WRITE_TIMEOUT_MS) return true;
  this.log.error(`[sync] clearing a stuck write flag on ${room.docName}`);
  room.writing = false;
  return false;
},

async refreshProjection(room) {
  // A retired room (its reload replaced it) must not write the mirror: its document is
  // older than the one that owns the room now (ADR-148).
  if (!this.isCurrentRoom(room)) return;
  if (!this.beginWrite(room, "projection")) return;
  let next;
  let previous;
  try {
    next = projectBoard(room.ydoc);
    previous = room.projection;
  } catch (error) {
    room.writing = false;
    this.log.error(`[sync] projection read failed for ${room.docName}:`, error.message);
    return;
  }
  if (process.env.REMO_DEBUG) {
    this.log.log(
      `[debug] projecting ${room.docName}: widgets=${next.widgets.length} columns=${next.kanban.columns.length} cards=${next.kanban.cards.length} (doc widgets=${room.ydoc.getMap("widgets").size})`,
    );
  }

  if (room.fullRefresh) {
    // Drop and rewrite inside the same transaction, so the mirror cannot keep a
    // row the document no longer has.
    await this.fullProjection(room, next);
    return;
  }

  const widgetDiff = diffRows(previous.widgets, next.widgets, (row) => row.id);
  const columnDiff = diffRows(
    previous.kanban.columns,
    next.kanban.columns,
    (row) => `${row.kanbanId}|${row.id}`,
  );
  const swimlaneDiff = diffRows(
    previous.kanban.swimlanes,
    next.kanban.swimlanes,
    (row) => `${row.kanbanId}|${row.id}`,
  );
  const cardDiff = diffRows(
    previous.kanban.cards,
    next.kanban.cards,
    (row) => `${row.kanbanId}|${row.cardId}`,
  );

  let client;
  try {
    client = await this.pool.connect();
    await client.query("begin");

    for (const row of widgetDiff.removed) {
      await client.query("delete from widgets where board_id = $1 and id = $2", [
        room.docName,
        row.id,
      ]);
    }
    await this.upsertWidgets(client, room.docName, [...widgetDiff.inserted, ...widgetDiff.updated]);

    for (const row of columnDiff.removed) {
      await client.query(
        "delete from kanban_columns where board_id = $1 and kanban_id = $2 and id = $3",
        [room.docName, row.kanbanId, row.id],
      );
    }
    await this.upsertKanbanColumns(client, room.docName, [
      ...columnDiff.inserted,
      ...columnDiff.updated,
    ]);

    for (const row of swimlaneDiff.removed) {
      await client.query(
        "delete from kanban_swimlanes where board_id = $1 and kanban_id = $2 and id = $3",
        [room.docName, row.kanbanId, row.id],
      );
    }
    await this.upsertKanbanSwimlanes(client, room.docName, [
      ...swimlaneDiff.inserted,
      ...swimlaneDiff.updated,
    ]);

    for (const row of cardDiff.removed) {
      await client.query(
        "delete from kanban_cards where board_id = $1 and kanban_id = $2 and card_id = $3",
        [room.docName, row.kanbanId, row.cardId],
      );
    }
    await this.upsertKanbanCards(client, room.docName, [...cardDiff.inserted, ...cardDiff.updated]);

    // The document names the board, but an empty `meta.title` is not a statement that
    // the name was cleared: a board created through the API has a row title and an
    // untouched document. Writing `''` here made a named board look legacy, so the next
    // open dropped the guard and seeded a template over it (ADR: seed once, not on every
    // reload). Keep the stored name until the document has one of its own.
    await client.query(
      `update boards
          set title = coalesce(nullif($2, ''), title), updated_at = now()
        where id = $1`,
      [room.docName, next.title ?? ""],
    );
    // The room may have been replaced while this pass waited on the database. Its
    // document is older than the one that owns the mirror now, so drop the work
    // instead of writing it (ADR-148).
    if (!this.isCurrentRoom(room)) {
      await client.query("rollback");
      return;
    }
    await client.query("commit");

    room.projection = next;
    const changed =
      widgetDiff.inserted.length +
      widgetDiff.updated.length +
      widgetDiff.removed.length +
      cardDiff.inserted.length +
      cardDiff.updated.length +
      cardDiff.removed.length;
    if (changed > 0) {
      this.metrics?.inc("remo_store_projection_writes_total");
      this.log.log(`[sync] projected ${room.docName} (${changed} row change(s))`);
    }
  } catch (error) {
    await client?.query("rollback").catch(() => {});
    this.log.error(`[sync] projection failed for ${room.docName}:`, error.message);
  } finally {
    client?.release();
    room.writing = false;
  }
},

/**
 * Rewrite the mirror from the document (first pass after a load, and every teardown).
 *
 * Idempotent on purpose (ADR-148): rows the document no longer has are removed by
 * absence, and every other row is an upsert. Two writers of the same board — a rival
 * room, a second sync process, a replay after a crash — therefore converge on the
 * document instead of failing on `widgets_pkey` or on a partially rewritten table.
 */
async fullProjection(room, next) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");

    await client.query(
      "delete from widgets where board_id = $1 and not (id = any($2::text[]))",
      [room.docName, next.widgets.map((row) => row.id)],
    );
    await this.upsertWidgets(client, room.docName, next.widgets);

    await client.query(
      `delete from kanban_columns c
        where c.board_id = $1
          and not exists (
            select 1 from unnest($2::text[], $3::text[]) as keep(kanban_id, id)
             where keep.kanban_id = c.kanban_id and keep.id = c.id
          )`,
      [
        room.docName,
        next.kanban.columns.map((row) => row.kanbanId),
        next.kanban.columns.map((row) => row.id),
      ],
    );
    await this.upsertKanbanColumns(client, room.docName, next.kanban.columns);

    await client.query(
      `delete from kanban_swimlanes s
        where s.board_id = $1
          and not exists (
            select 1 from unnest($2::text[], $3::text[]) as keep(kanban_id, id)
             where keep.kanban_id = s.kanban_id and keep.id = s.id
          )`,
      [
        room.docName,
        next.kanban.swimlanes.map((row) => row.kanbanId),
        next.kanban.swimlanes.map((row) => row.id),
      ],
    );
    await this.upsertKanbanSwimlanes(client, room.docName, next.kanban.swimlanes);

    await client.query(
      `delete from kanban_cards c
        where c.board_id = $1
          and not exists (
            select 1 from unnest($2::text[], $3::text[]) as keep(kanban_id, card_id)
             where keep.kanban_id = c.kanban_id and keep.card_id = c.card_id
          )`,
      [
        room.docName,
        next.kanban.cards.map((row) => row.kanbanId),
        next.kanban.cards.map((row) => row.cardId),
      ],
    );
    await this.upsertKanbanCards(client, room.docName, next.kanban.cards);

    await client.query(
      `update boards
          set title = coalesce(nullif($2, ''), title), updated_at = now()
        where id = $1`,
      [room.docName, next.title ?? ""],
    );
    if (!this.isCurrentRoom(room)) {
      await client.query("rollback");
      return;
    }
    await client.query("commit");

    room.projection = next;
    room.fullRefresh = false;
    this.metrics?.inc("remo_store_projection_writes_total");
    this.log.log(
      `[sync] reconciled ${room.docName} with the database (${next.widgets.length} widgets)`,
    );
  } catch (error) {
    await client?.query("rollback").catch(() => {});
    this.log.error(`[sync] full projection failed for ${room.docName}:`, error.message);
  } finally {
    client?.release();
    room.writing = false;
  }
},

/** Rows of `widgets` for one board; every column the read path needs. */
async upsertWidgets(client, boardId, rows) {
  for (const row of rows) {
    await client.query(
      `insert into widgets (board_id, id, type, parent_id, x, y, width, height, title,
                            content, fill_color, card_theme, rotation, props, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       on conflict (board_id, id) do update set
         type = excluded.type, parent_id = excluded.parent_id, x = excluded.x, y = excluded.y,
         width = excluded.width, height = excluded.height, title = excluded.title,
         content = excluded.content, fill_color = excluded.fill_color,
         card_theme = excluded.card_theme, rotation = excluded.rotation,
         props = excluded.props, updated_at = now()`,
      [
        boardId,
        row.id,
        row.type,
        row.parentId,
        row.x,
        row.y,
        row.width,
        row.height,
        row.title,
        row.content,
        row.fillColor,
        row.cardTheme,
        row.rotation,
        row.props ? JSON.stringify(row.props) : null,
      ],
    );
  }
},

async upsertKanbanColumns(client, boardId, rows) {
  for (const row of rows) {
    await client.query(
      `insert into kanban_columns (board_id, kanban_id, id, title, accent, width, wip_limit, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (board_id, kanban_id, id) do update set
         title = excluded.title, accent = excluded.accent, width = excluded.width,
         wip_limit = excluded.wip_limit, position = excluded.position`,
      [boardId, row.kanbanId, row.id, row.title, row.accent, row.width, row.wipLimit, row.position],
    );
  }
},

async upsertKanbanSwimlanes(client, boardId, rows) {
  for (const row of rows) {
    await client.query(
      `insert into kanban_swimlanes (board_id, kanban_id, id, title, position)
       values ($1,$2,$3,$4,$5)
       on conflict (board_id, kanban_id, id) do update set
         title = excluded.title, position = excluded.position`,
      [boardId, row.kanbanId, row.id, row.title, row.position],
    );
  }
},

async upsertKanbanCards(client, boardId, rows) {
  for (const row of rows) {
    await client.query(
      `insert into kanban_cards (board_id, kanban_id, card_id, column_id, swimlane_id, order_key)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (board_id, kanban_id, card_id) do update set
         column_id = excluded.column_id, swimlane_id = excluded.swimlane_id,
         order_key = excluded.order_key`,
      [boardId, row.kanbanId, row.cardId, row.columnId, row.swimlaneId, row.orderKey],
    );
  }
},

async compact(room) {
  // A room that already lost the map is a retired document: its watermark would cover
  // updates that belong to the replacement room and delete them (ADR-128, ADR-148).
  if (!this.isCurrentRoom(room)) return;
  const client = await this.pool.connect();
  try {
    const { rows } = await client.query(
      "select coalesce(max(id), 0)::bigint as watermark from board_updates where board_id = $1",
      [room.docName],
    );
    const watermark = Number(rows[0].watermark);

    // Anything already applied to the document is in this state, including
    // updates that are still pending in memory.
    const state = Y.encodeStateAsUpdate(room.ydoc);

    await client.query("begin");
    await client.query(
      `update boards
          set snapshot = $2, snapshot_through = $3, updated_at = now()
        where id = $1`,
      [room.docName, Buffer.from(state), watermark],
    );
    await client.query(
      "delete from board_updates where board_id = $1 and id <= $2",
      [room.docName, watermark],
    );
    await client.query("commit");
    this.metrics?.inc("remo_store_compactions_total");
    this.log.log(
      `[sync] compacted ${room.docName} (${state.length} bytes, log through #${watermark})`,
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    this.log.error(`[sync] compaction failed for ${room.docName}:`, error.message);
  } finally {
    client.release();
  }
},

/**
 * Flush, project and compact a closing document, and retire its room.
 *
 * y-websocket calls this when the last socket of a document closes and does not await
 * it, so the next page load can bind a replacement meanwhile: the caller is serialized
 * by `withRoomLock`, and the teardown of a room that is no longer the map's own is a
 * no-op (ADR-128, ADR-148).
 */
async writeState(docName, ydoc) {
  return this.withRoomLock(docName, async () => {
    const room = this.rooms.get(docName);
    if (!room) return;
    // A document that is not the room's own was already replaced by its reload; tearing
    // the current room down here would drop a live room with open sockets.
    if (ydoc && room.ydoc !== ydoc) return;
    await this.releaseRoom(room);
  });
},

/** The teardown body; the caller already holds the room lock. */
async releaseRoom(room) {
  // A teardown starts when the last socket of a document closes, and the next page load
  // can bind its replacement before the teardown finishes. Both callers must share one
  // teardown: a second one would compact the old document after the replacement room has
  // already logged updates, and its watermark would then delete those updates.
  if (room.teardown) return room.teardown;
  room.teardown = (async () => {
    if (room.logTimer) clearTimeout(room.logTimer);
    if (room.projectionTimer) clearTimeout(room.projectionTimer);
    room.logTimer = null;
    room.projectionTimer = null;

    await this.flushLog(room);
    await this.refreshProjection(room);
    await this.compact(room);

    // Retire before removing: a projection of this document that is still in flight
    // must roll back instead of writing stale rows over the live mirror.
    room.retired = true;
    if (room.handlers) {
      room.ydoc.off("update", room.handlers.update);
      room.ydoc.off("destroy", room.handlers.destroy);
    }
    // Only remove the room this teardown owns; a replacement may already be in the map.
    if (this.rooms.get(room.docName) === room) this.rooms.delete(room.docName);
    this.log.log(`[sync] flushed ${room.docName}`);
  })();

  try {
    await room.teardown;
  } finally {
    room.teardown = null;
  }
},

async flushRoom(docName, deadlineMs = 5000) {
  const room = this.rooms.get(docName);
  if (!room) return false;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (room.logTimer) {
      clearTimeout(room.logTimer);
      room.logTimer = null;
    }
    await this.flushLog(room);
    if (!room.pendingUpdates.length && !room.logWriting) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
};
