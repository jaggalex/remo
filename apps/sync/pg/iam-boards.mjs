/**
 * Boards as the unit of authorisation: links, grants, claim, lifecycle (ADR-061/069/083).
 *
 * The public link is a board property, not a token; a grant is one row per subject; the
 * archived flag is checked before ACL so a trashed board cannot be opened through a link.
 */
import { Y } from "../y.mjs";

export const iamBoardMethods = {
async getBoardLink(boardId) {
  const { rows } = await this.pool.query(
    `select enabled, version, role, created_at, password_hash,
            password_hash is not null as has_password,
            password_version, expires_at
       from board_links where board_id = $1`,
    [boardId],
  );
  return rows[0] ?? null;
},

async enableBoardLink({ boardId, role = "viewer", createdBy }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `insert into board_links (board_id, role, enabled, created_by)
       values ($1, $2, true, $3)
       on conflict (board_id) do update set enabled = true, role = excluded.role
       returning enabled, version, role, password_hash is not null as has_password,
                 password_version, expires_at`,
      [boardId, role, createdBy],
    );
    await client.query(`update boards set visibility = 'link' where id = $1`, [boardId]);
    await client.query(
      `update boards set acl_version = acl_version + 1 where id = $1`,
      [boardId],
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

async disableBoardLink(boardId) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    await client.query(`update board_links set enabled = false where board_id = $1`, [boardId]);
    await client.query(`update boards set visibility = 'private' where id = $1`, [boardId]);
    await client.query(
      `update boards set acl_version = acl_version + 1 where id = $1`,
      [boardId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async setBoardLinkPassword(boardId, passwordHash) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `update board_links
          set password_hash = $2,
              password_version = password_version + 1
        where board_id = $1
        returning password_hash is not null as has_password, password_version`,
      [boardId, passwordHash],
    );
    await client.query(`delete from board_link_unlocks where board_id = $1`, [boardId]);
    await client.query(
      `update boards set acl_version = acl_version + 1 where id = $1`,
      [boardId],
    );
    await client.query("commit");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async setBoardLinkExpiry(boardId, expiresAt) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `update board_links set expires_at = $2 where board_id = $1 returning expires_at`,
      [boardId, expiresAt],
    );
    await client.query(
      `update boards set acl_version = acl_version + 1 where id = $1`,
      [boardId],
    );
    await client.query("commit");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async createLinkUnlock({ tokenHash, boardId, passwordVersion, expiresAt }) {
  await this.pool.query(
    `insert into board_link_unlocks (token_hash, board_id, password_version, expires_at)
     values ($1, $2, $3, $4)`,
    [tokenHash, boardId, passwordVersion, expiresAt],
  );
},

async validLinkUnlock({ boardId, tokenHash, passwordVersion }) {
  const { rows } = await this.pool.query(
    `select 1 from board_link_unlocks
      where token_hash = $1 and board_id = $2 and password_version = $3
        and expires_at > now()`,
    [tokenHash, boardId, passwordVersion],
  );
  return rows.length > 0;
},

async createIamBoard({ id, orgId, teamId, ownerId, title }) {
  const { rows } = await this.pool.query(
    `insert into boards (id, title, org_id, team_id, owner_id)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set title = excluded.title
     returning id, title, org_id, team_id, owner_id, visibility, acl_version`,
    [id, title ?? "", orgId, teamId, ownerId],
  );
  return rows[0];
},

async getIamBoard(boardId) {
  const { rows } = await this.pool.query(
    `select id, title, org_id, team_id, owner_id, visibility, acl_version,
            archived_at, agents_enabled, claim_token_hash is not null as has_claim_token,
            updated_at
       from boards where id = $1`,
    [boardId],
  );
  return rows[0] ?? null;
},

async setClaimToken(boardId, tokenHash) {
  await this.pool.query(
    `update boards set claim_token_hash = $2 where id = $1 and owner_id is null`,
    [boardId, tokenHash],
  );
},

async claimBoard({ boardId, userId, orgId, teamId, tokenHash }) {
  const { rows } = await this.pool.query(
    `update boards
        set owner_id = $2, org_id = $3, team_id = $4, claimed_at = now(),
            acl_version = acl_version + 1
      where id = $1 and owner_id is null
        and (claim_token_hash is null or claim_token_hash = $5)
      returning id, title, org_id, team_id, owner_id, visibility, acl_version`,
    [boardId, userId, orgId, teamId, tokenHash ?? null],
  );
  return rows[0] ?? null;
},

async bumpAclVersion(boardId) {
  const { rows } = await this.pool.query(
    `update boards set acl_version = acl_version + 1 where id = $1 returning acl_version`,
    [boardId],
  );
  return rows[0]?.acl_version ?? null;
},

async accessFacts(boardId, userId) {
  const board = await this.getIamBoard(boardId);
  if (!board) return null;

  const [{ rows: grants }, { rows: policies }] = await Promise.all([
    this.pool.query(
      `select subject_type, subject_id, role
         from board_grants
        where board_id = $1 and (expires_at is null or expires_at > now())`,
      [boardId],
    ),
    board.org_id
      ? this.pool.query(
          `select can_share, public_links from org_policies where org_id = $1`,
          [board.org_id],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  let viewer = null;
  if (userId && board.org_id) {
    const { rows } = await this.pool.query(
      `select m.relation, m.state,
              (select tm.role from team_memberships tm
                where tm.team_id = $3 and tm.user_id = $2 limit 1) as team_role
         from org_memberships m
        where m.org_id = $1 and m.user_id = $2`,
      [board.org_id, userId, board.team_id],
    );
    if (rows[0]) {
      viewer = {
        userId,
        org: { relation: rows[0].relation, state: rows[0].state },
        teamRole: rows[0].team_role ?? null,
      };
    } else {
      viewer = { userId, org: null, teamRole: null };
    }
  }

  return {
    board: {
      id: board.id,
      ownerId: board.owner_id,
      orgId: board.org_id,
      teamId: board.team_id,
      visibility: board.visibility,
      archivedAt: board.archived_at,
      aclVersion: Number(board.acl_version),
    },
    viewer,
    grants: grants.map((grant) => ({
      subjectType: grant.subject_type,
      subjectId: grant.subject_id,
      role: grant.role,
    })),
    policy: policies[0]
      ? { canShare: policies[0].can_share, publicLinks: policies[0].public_links }
      : {},
  };
},

async putGrant({ boardId, subjectType, subjectId, role, grantedBy }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into board_grants (board_id, subject_type, subject_id, role, granted_by)
       values ($1, $2, $3, $4, $5)
       on conflict (board_id, subject_type, subject_id)
       do update set role = excluded.role, granted_by = excluded.granted_by`,
      [boardId, subjectType, subjectId, role, grantedBy],
    );
    const { rows } = await client.query(
      `update boards set acl_version = acl_version + 1 where id = $1 returning acl_version`,
      [boardId],
    );
    await client.query("commit");
    return { aclVersion: Number(rows[0]?.acl_version ?? 0) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async deleteGrant({ boardId, subjectType, subjectId }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from board_grants where board_id = $1 and subject_type = $2 and subject_id = $3`,
      [boardId, subjectType, subjectId],
    );
    const { rows } = await client.query(
      `update boards set acl_version = acl_version + 1 where id = $1 returning acl_version`,
      [boardId],
    );
    await client.query("commit");
    return { aclVersion: Number(rows[0]?.acl_version ?? 0) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async listGrants(boardId) {
  // Names travel with the grants: the sharing dialog is read by people, and a uuid
  // would only send them looking for the directory in another window.
  const { rows } = await this.pool.query(
    `select g.subject_type, g.subject_id, g.role, g.granted_by, g.created_at,
            case g.subject_type when 'user' then 'direct' when 'team' then 'team' else 'org' end as source,
            case g.subject_type
              when 'user' then u.name
              when 'team' then t.name
              when 'org' then o.name
            end as subject_name,
            case g.subject_type when 'user' then u.email end as subject_email
       from board_grants g
       left join users u on g.subject_type = 'user' and u.id = g.subject_id
       left join teams t on g.subject_type = 'team' and t.id = g.subject_id
       left join orgs o on g.subject_type = 'org' and o.id = g.subject_id
      where g.board_id = $1
      order by g.created_at`,
    [boardId],
  );
  return rows;
},

/**
 * People who can be assigned to a card (ADR-106 amendment).
 *
 * The owner, direct user grants, members of team grants and members of organisation
 * grants. Only id and name travel: the inspector needs a picker, not an address book.
 * Suspended users are omitted.
 */
async listBoardPeople(boardId) {
  const { rows } = await this.pool.query(
    `select distinct u.id, u.name
       from (
         select b.owner_id as user_id from boards b where b.id = $1 and b.owner_id is not null
         union
         select g.subject_id from board_grants g
          where g.board_id = $1 and g.subject_type = 'user'
         union
         select tm.user_id from board_grants g
           join team_memberships tm on tm.team_id = g.subject_id
          where g.board_id = $1 and g.subject_type = 'team'
         union
         select om.user_id from board_grants g
           join org_memberships om on om.org_id = g.subject_id
          where g.board_id = $1 and g.subject_type = 'org' and om.state = 'active'
       ) p
       join users u on u.id = p.user_id
      where u.state = 'active'
      order by u.name`,
    [boardId],
  );
  return rows;
},

async listBoardsForOrg(orgId, userId) {
  const { rows } = await this.pool.query(
    `select distinct b.id, b.title, b.owner_id, b.team_id, b.updated_at
       from boards b
       left join board_grants g on g.board_id = b.id
      where b.org_id = $1 and b.owner_id is not null
        and (
          b.owner_id = $2
          or (g.subject_type = 'user' and g.subject_id = $2)
          or (g.subject_type = 'team' and exists (
                select 1 from team_memberships tm
                 where tm.team_id = b.team_id and tm.user_id = $2))
          or (g.subject_type = 'org' and exists (
                select 1 from org_memberships m
                 where m.org_id = b.org_id and m.user_id = $2
                   and m.state = 'active' and m.relation = 'member'))
        )
      order by b.updated_at desc
      limit 200`,
    [orgId, userId],
  );
  return rows;
},

async listBoardsOwnedBy(orgId, userId) {
  const { rows } = await this.pool.query(
    `select id, title from boards where org_id = $1 and owner_id = $2 order by title`,
    [orgId, userId],
  );
  return rows;
},

async transferBoard({ boardId, fromUserId, toUserId }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `update boards
          set owner_id = $2, acl_version = acl_version + 1
        where id = $1 and owner_id = $3
        returning id, title, owner_id`,
      [boardId, toUserId, fromUserId],
    );
    if (!rows[0]) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      `insert into board_grants (board_id, subject_type, subject_id, role, granted_by)
       values ($1, 'user', $2, 'editor', $3)
       on conflict (board_id, subject_type, subject_id)
       do update set role = 'editor'`,
      [boardId, fromUserId, toUserId],
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

async archiveBoard(boardId) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `update boards
          set archived_at = now(), visibility = 'private',
              acl_version = acl_version + 1
        where id = $1 and archived_at is null
        returning id, title, org_id`,
      [boardId],
    );
    if (!rows[0]) {
      await client.query("rollback");
      return null;
    }
    await client.query(`update board_links set enabled = false where board_id = $1`, [boardId]);
    await client.query(`delete from board_link_unlocks where board_id = $1`, [boardId]);
    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async restoreBoard(boardId) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `update boards
          set archived_at = null, acl_version = acl_version + 1
        where id = $1 and archived_at is not null
        returning id, title, org_id`,
      [boardId],
    );
    if (!rows[0]) {
      await client.query("rollback");
      return null;
    }
    await client.query(`update board_links set enabled = false where board_id = $1`, [boardId]);
    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async duplicateBoard({ sourceId, newId, title, ownerId, copyGrants = true }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows: sources } = await client.query(
      `select org_id, team_id, owner_id, snapshot, snapshot_through
         from boards where id = $1`,
      [sourceId],
    );
    if (!sources[0]) {
      await client.query("rollback");
      return null;
    }
    const source = sources[0];

    const doc = new Y.Doc();
    if (source.snapshot?.length) Y.applyUpdate(doc, new Uint8Array(source.snapshot));
    const { rows: updates } = await client.query(
      `select update from board_updates
        where board_id = $1 and id > $2 order by id`,
      [sourceId, source.snapshot_through ?? 0],
    );
    for (const row of updates) Y.applyUpdate(doc, new Uint8Array(row.update));
    doc.getMap("meta").set("title", title);
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();

    const { rows } = await client.query(
      `insert into boards
         (id, title, org_id, team_id, owner_id, visibility, snapshot, snapshot_through)
       values ($1, $2, $3, $4, $5, 'private', $6, 0)
       returning id, title`,
      [newId, title, source.org_id, source.team_id, ownerId ?? source.owner_id, snapshot],
    );

    await client.query(
      `insert into widgets
         (board_id, id, type, parent_id, x, y, width, height, title, content,
          fill_color, card_theme, rotation, props)
       select $1, id, type, parent_id, x, y, width, height, title, content,
              fill_color, card_theme, rotation, props
         from widgets where board_id = $2`,
      [newId, sourceId],
    );
    await client.query(
      `insert into kanban_columns
         (board_id, kanban_id, id, title, accent, width, wip_limit, position)
       select $1, kanban_id, id, title, accent, width, wip_limit, position
         from kanban_columns where board_id = $2`,
      [newId, sourceId],
    );
    await client.query(
      `insert into kanban_swimlanes (board_id, kanban_id, id, title, position)
       select $1, kanban_id, id, title, position
         from kanban_swimlanes where board_id = $2`,
      [newId, sourceId],
    );
    await client.query(
      `insert into kanban_cards (board_id, kanban_id, card_id, column_id, swimlane_id, order_key)
       select $1, kanban_id, card_id, column_id, swimlane_id, order_key
         from kanban_cards where board_id = $2`,
      [newId, sourceId],
    );
    if (copyGrants) {
      await client.query(
        `insert into board_grants (board_id, subject_type, subject_id, role, granted_by)
         select $1, subject_type, subject_id, role, granted_by
           from board_grants where board_id = $2`,
        [newId, sourceId],
      );
    }
    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
};
