/**
 * Board read paths and projections (ADR-016).
 *
 * Queryable reads do not need the live room: they answer from the projection, which is
 * rebuilt from the log when a room opens. These methods are mixed into PostgresStore so
 * the store's public API stays the same.
 */
import { Y } from "../y.mjs";

export const boardMethods = {
async listBoards() {
  const { rows } = await this.pool.query(
    `select b.id,
            b.title,
            b.updated_at,
            b.snapshot_through,
            coalesce(w.count, 0)::int as widgets,
            coalesce(u.count, 0)::int as pending_updates
       from boards b
       left join (select board_id, count(*) from widgets group by board_id) w on w.board_id = b.id
       left join (select board_id, count(*) from board_updates group by board_id) u on u.board_id = b.id
      order by b.updated_at desc
      limit 100`,
  );
  return rows;
},

async listReadableBoards(userId) {
  const { rows } = await this.pool.query(
    `select distinct b.id, b.title, b.updated_at, b.snapshot_through,
            b.visibility, b.archived_at as "archivedAt",
            (b.owner_id = $1) as "canDelete",
            (b.owner_id = $1 or exists (
              select 1 from board_grants g
               where g.board_id = b.id and g.subject_type = 'user'
                 and g.subject_id = $1 and g.role = 'coowner'
            )) as "canDuplicate",
            coalesce(w.count, 0)::int as widgets,
            coalesce(u.count, 0)::int as pending_updates,
            coalesce(g.count, 0)::int as grants
       from boards b
       join org_memberships m
         on m.org_id = b.org_id and m.user_id = $1 and m.state = 'active'
       left join (select board_id, count(*) from widgets group by board_id) w
         on w.board_id = b.id
       left join (select board_id, count(*) from board_updates group by board_id) u
         on u.board_id = b.id
       left join (select board_id, count(*) from board_grants group by board_id) g
         on g.board_id = b.id
      where b.owner_id is not null
        and (
          b.archived_at is null
          or b.owner_id = $1
          or exists (
            select 1 from board_grants g
             where g.board_id = b.id and g.subject_type = 'user'
               and g.subject_id = $1 and g.role = 'coowner')
        )
        and (
          b.owner_id = $1
          or exists (
            select 1 from board_grants g
             where g.board_id = b.id and g.subject_type = 'user' and g.subject_id = $1)
          or exists (
            select 1
              from board_grants g
              join team_memberships tm
                on tm.team_id = g.subject_id and tm.user_id = $1
             where g.board_id = b.id and g.subject_type = 'team')
          or (m.relation = 'member' and exists (
            select 1 from board_grants g
             where g.board_id = b.id and g.subject_type = 'org' and g.subject_id = b.org_id))
        )
      order by b.updated_at desc
      limit 100`,
    [userId],
  );
  return rows;
},

async readBoardState(boardId) {
  const { rows } = await this.pool.query(
    "select snapshot, snapshot_through from boards where id = $1",
    [boardId],
  );
  if (!rows[0]) return null;
  const doc = new Y.Doc();
  try {
    if (rows[0].snapshot?.length) {
      Y.applyUpdate(doc, new Uint8Array(rows[0].snapshot));
    }
    const updates = await this.pool.query(
      `select update from board_updates
        where board_id = $1 and id > $2 order by id asc`,
      [boardId, rows[0].snapshot_through ?? 0],
    );
    for (const row of updates.rows) {
      Y.applyUpdate(doc, new Uint8Array(row.update));
    }
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
},

async getBoard(boardId) {
  const { rows } = await this.pool.query(
    `select b.id, b.title, b.updated_at, b.snapshot_through,
            (select count(*)::int from widgets w where w.board_id = b.id) as widgets,
            (select count(*)::int from board_updates u where u.board_id = b.id) as pending_updates
       from boards b
      where b.id = $1`,
    [boardId],
  );
  if (rows.length === 0) return null;

  const columns = await this.pool.query(
    `select kanban_id, id, title, accent, width, wip_limit, position
       from kanban_columns where board_id = $1 order by kanban_id, position`,
    [boardId],
  );
  const swimlanes = await this.pool.query(
    `select kanban_id, id, title, position
       from kanban_swimlanes where board_id = $1 order by kanban_id, position`,
    [boardId],
  );
  const cards = await this.pool.query(
    `select kc.kanban_id, kc.card_id, kc.column_id, kc.swimlane_id, kc.order_key,
            w.title, w.card_theme
       from kanban_cards kc
       left join widgets w on w.board_id = kc.board_id and w.id = kc.card_id
      where kc.board_id = $1
      order by kc.kanban_id, kc.column_id, kc.order_key`,
    [boardId],
  );

  return {
    ...rows[0],
    kanban: { columns: columns.rows, swimlanes: swimlanes.rows, cards: cards.rows },
  };
},

async listWidgets(boardId, { type, q, limit = 200 } = {}) {
  const { rows } = await this.pool.query(
    `select id, type, parent_id, x, y, width, height, title, content, props, updated_at
       from widgets
      where board_id = $1
        and ($2::text is null or type = $2)
        and ($3::text is null
             or title ilike '%' || $3 || '%'
             or content ilike '%' || $3 || '%'
             or props ->> 'name' ilike '%' || $3 || '%')
      order by updated_at desc
      limit $4`,
    [boardId, type ?? null, q ?? null, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
},

async search(q, { limit = 50, type, boardIds = null } = {}) {
  if (!q || q.trim().length < 2) return [];
  if (boardIds && boardIds.length === 0) return [];
  const { rows } = await this.pool.query(
    // Ranking by match position rather than trigram similarity: the server runs in
    // the C collation, where pg_trgm scores non-ASCII text as 0. The filter itself
    // still benefits from the trigram index.
    // The filter also looks into a sticker or lane caption and the object name
    // (ADR-165). Only title/content have trigram indexes; at this scale the extra OR
    // costs nothing measurable.
    `select w.board_id, w.id, w.type, w.title, w.content, w.props, w.updated_at,
            left(coalesce(nullif(w.props ->> 'name', ''), nullif(w.title, ''), w.content,
                          w.props ->> 'label'), 140) as snippet,
            position(lower($1) in lower(coalesce(w.props ->> 'name', w.title, ''))) as title_position
       from widgets w
      where (w.title ilike '%' || $1 || '%'
             or w.content ilike '%' || $1 || '%'
             or w.props ->> 'label' ilike '%' || $1 || '%'
             or w.props ->> 'name' ilike '%' || $1 || '%')
        and ($2::text is null or w.type = $2)
        and ($4::text[] is null or w.board_id = any($4::text[]))
      order by (lower(coalesce(w.props ->> 'name', w.title, '')) = lower($1)) desc,
               (lower(coalesce(w.props ->> 'name', w.title, '')) like lower($1) || '%') desc,
               (case when position(lower($1) in lower(coalesce(w.props ->> 'name', w.title, ''))) = 0 then 1 else 0 end),
               position(lower($1) in lower(coalesce(w.props ->> 'name', w.title, ''))),
               w.updated_at desc
      limit $3`,
    [q.trim(), type ?? null, Math.min(Math.max(limit, 1), 200), boardIds],
  );
  return rows;
}
};
