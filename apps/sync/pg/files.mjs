/**
 * The `files` rows behind image objects (ADR-249, `spec/images.md` §3.1, §5).
 *
 * Every method runs under the request's tenant (`app.org_id`, ADR-178), so the policy on
 * `files` is the second wall behind the route's own access check. The two deliberate
 * exceptions happen before a tenant exists: the read route must learn a file's
 * organisation, and a copy into another organisation must see the source row. Neither
 * may be a plain read — `FORCE ROW LEVEL SECURITY` answers `null` for an unset tenant —
 * so both ask `remo_file_org` (schema 25) for the organisation and then read the row
 * under it.
 */
import { randomUUID } from "node:crypto";
import { withoutTenant } from "../tenant.mjs";

/** The columns the API needs, in one place: `select *` would grow with the schema. */
const COLUMNS = `id, org_id, board_id, uploaded_by, sha256, mime, bytes, stored_bytes,
                 width, height, dominant_color, variants, original_name, status,
                 created_at, unreferenced_since, deleted_at`;

export const fileMethods = {
  /**
   * Insert one uploaded file, or return the ready row that already holds the same bytes.
   *
   * The conflict target repeats the partial index predicate because Postgres cannot
   * infer a partial unique index without it. A duplicate upload writes no row and the
   * caller removes the storage keys it wrote for the rejected id.
   */
  async createFile({
    id,
    orgId,
    boardId,
    uploadedBy,
    sha256,
    mime,
    bytes,
    storedBytes,
    width,
    height,
    dominantColor = null,
    variants,
    originalName = null,
  }) {
    const { rows } = await this.pool.query(
      `insert into files
         (id, org_id, board_id, uploaded_by, sha256, mime, bytes, stored_bytes,
          width, height, dominant_color, variants, original_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       on conflict (org_id, sha256) where status = 'ready' do nothing
       returning ${COLUMNS}`,
      [
        id,
        orgId,
        boardId ?? null,
        uploadedBy ?? null,
        sha256,
        mime,
        bytes,
        storedBytes,
        width,
        height,
        dominantColor,
        JSON.stringify(variants ?? {}),
        originalName,
      ],
    );
    if (rows[0]) return rows[0];
    // The duplicate case: the existing row is the answer, inside this organisation only.
    const existing = await this.pool.query(
      `select ${COLUMNS} from files
        where org_id = $1 and sha256 = $2 and status = 'ready'`,
      [orgId, sha256],
    );
    return existing.rows[0] ?? null;
  },

  async fileById(id) {
    const { rows } = await this.pool.query(
      `select ${COLUMNS} from files where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /**
   * Cross-tenant boundary: `/files/:id/...` is answered without `app.org_id`, so the
   * organisation has to come from the row itself. `FORCE ROW LEVEL SECURITY` hides that
   * row from the app role, so the answer comes from the `security definer` lookup that
   * owns the read (schema 25) — the same mechanism `boardOrg` uses for a room. The row
   * is then read again under this organisation, so a stale answer proves nothing.
   */
  async fileOrgId(id) {
    const { rows } = await this.pool.query("select remo_file_org($1) as org_id", [id]);
    return rows[0]?.org_id ?? null;
  },

  /**
   * May this room show the file? Either an `image` object in its projection points at
   * it, or the file was uploaded here and the object is about to be created (§4.3).
   * Both halves are tenant rows, so a file from another organisation can never match.
   */
  async fileUsedInBoard(fileId, boardId) {
    const { rows } = await this.pool.query(
      `select exists (
                select 1 from widgets
                 where board_id = $2 and type = 'image' and props->>'fileId' = $1
              ) or exists (
                select 1 from files where id = $1::uuid and board_id = $2
              ) as used`,
      [fileId, boardId],
    );
    return Boolean(rows[0]?.used);
  },

  /** Storage the quota counts: originals plus variants of ready rows (§7). */
  async storedBytesForOrg() {
    const { rows } = await this.pool.query(
      "select coalesce(sum(stored_bytes), 0)::bigint as bytes from files where status = 'ready'",
    );
    return Number(rows[0]?.bytes ?? 0);
  },

  /** Image objects currently in the room, for `REMO_FILES_PER_ROOM`. */
  async imageCountForBoard(boardId) {
    const { rows } = await this.pool.query(
      "select count(*)::int as count from widgets where board_id = $1 and type = 'image'",
      [boardId],
    );
    return Number(rows[0]?.count ?? 0);
  },

  /** The garbage collector's soft delete: keys go first, the row stays for audit (§5.4). */
  async deleteFile(id) {
    const { rows } = await this.pool.query(
      `update files
          set status = 'deleted', deleted_at = now()
        where id = $1 and status = 'ready'
        returning ${COLUMNS}`,
      [id],
    );
    return rows[0] ?? null;
  },

  async touchUnreferenced(id) {
    const { rows } = await this.pool.query(
      `update files
          set unreferenced_since = coalesce(unreferenced_since, now())
        where id = $1 and status = 'ready'
        returning id, unreferenced_since`,
      [id],
    );
    return rows[0] ?? null;
  },

  async clearUnreferenced(id) {
    const { rows } = await this.pool.query(
      `update files
          set unreferenced_since = null
        where id = $1 and unreferenced_since is not null
        returning id`,
      [id],
    );
    return rows[0] ?? null;
  },

  /**
   * Copy a file into another organisation (§5.2). The source organisation comes from the
   * same `security definer` lookup `fileOrgId` uses, and the source row is read under it;
   * the insert then runs under the target tenant.
   *
   * `id` is supplied by the route so the storage keys can be written before the row and
   * removed if the insert loses to a concurrent duplicate. Without it the database
   * generates one, which is still correct but leaves the caller unable to clean up.
   */
  async copyFileForBoard({ fileId, targetOrgId, boardId, uploadedBy, id = null }) {
    const sourceOrgId = await this.fileOrgId(fileId);
    if (!sourceOrgId) return null;
    // The caller is inside the target tenant; leave it for the source read, because
    // `withTenant` refuses to switch an existing one.
    const source = await withoutTenant(() =>
      this.withTenant(sourceOrgId, async () => {
        const { rows } = await this.pool.query(
          `select ${COLUMNS} from files where id = $1 and status = 'ready'`,
          [fileId],
        );
        return rows[0] ?? null;
      }),
    );
    if (!source) return null;
    // Inside one organisation the object reuses the same fileId, so there is nothing to
    // copy (§5.2).
    if (source.org_id === targetOrgId) return source;

    const targetId = id ?? randomUUID();
    const inserted = await this.pool.query(
      `insert into files
         (id, org_id, board_id, uploaded_by, sha256, mime, bytes, stored_bytes,
          width, height, dominant_color, variants, original_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       on conflict (org_id, sha256) where status = 'ready' do nothing
       returning ${COLUMNS}`,
      [
        targetId,
        targetOrgId,
        boardId ?? null,
        uploadedBy ?? null,
        source.sha256,
        source.mime,
        source.bytes,
        source.stored_bytes,
        source.width,
        source.height,
        source.dominant_color,
        JSON.stringify(source.variants ?? {}),
        source.original_name,
      ],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await this.pool.query(
      `select ${COLUMNS} from files
        where org_id = $1 and sha256 = $2 and status = 'ready'`,
      [targetOrgId, source.sha256],
    );
    return existing.rows[0] ?? null;
  },
};
