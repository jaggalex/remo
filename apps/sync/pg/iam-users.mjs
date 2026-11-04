import { normalizeEmail } from "../iam.mjs";

/**
 * Accounts, sessions, organisations, teams, invitations and audit (ADR-061).
 *
 * One place for the identity plane: a user is a row, a session is a hash, membership is
 * a seat, and every mutation of rights leaves an audit row.
 */
export const iamUserMethods = {
async createUser({ email, passwordHash, name }) {
  const { rows } = await this.pool.query(
    `insert into users (email, password_hash, name)
     values ($1, $2, $3)
     returning id, email, name, state, theme, lang, created_at`,
    [email, passwordHash, name],
  );
  return rows[0];
},

async findUserByEmail(email) {
  const { rows } = await this.pool.query(
    `select id, email, name, state, theme, lang, password_hash, created_at
       from users where email = $1`,
    [email],
  );
  return rows[0] ?? null;
},

async findUserById(id) {
  const { rows } = await this.pool.query(
    `select id, email, name, state, theme, lang, created_at from users where id = $1`,
    [id],
  );
  return rows[0] ?? null;
},

/** Theme and language are personal display preferences, not rights or content (ADR-150). */
async updateUserPreferences(userId, { theme, lang }) {
  const { rows } = await this.pool.query(
    `update users set theme = $2, lang = $3, updated_at = now()
      where id = $1
      returning theme, lang`,
    [userId, theme ?? null, lang ?? null],
  );
  return rows[0] ?? null;
},

async updatePassword(userId, passwordHash) {
  await this.pool.query(
    `update users set password_hash = $2, updated_at = now() where id = $1`,
    [userId, passwordHash],
  );
},

async createSession({ userId, tokenHash, expiresAt, userAgent }) {
  const { rows } = await this.pool.query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, $3, $4)
     returning id, expires_at`,
    [userId, tokenHash, expiresAt, userAgent ?? null],
  );
  return rows[0];
},

async findSession(tokenHash) {
  const { rows } = await this.pool.query(
    `select s.id, s.user_id, s.expires_at,
            u.email, u.name, u.state, u.theme, u.lang
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()`,
    [tokenHash],
  );
  return rows[0] ?? null;
},

async touchSession(tokenHash) {
  // One minute of resolution is enough for "last active" and avoids a write per request.
  await this.pool.query(
    `update sessions set last_seen_at = now()
      where token_hash = $1
        and revoked_at is null
        and last_seen_at < now() - interval '1 minute'`,
    [tokenHash],
  );
},

/** The sessions a person can see and end one by one (ADR-153); never expose a token. */
async listSessionsForUser(userId) {
  const { rows } = await this.pool.query(
    `select id, created_at, last_seen_at, expires_at, user_agent
       from sessions
      where user_id = $1
        and revoked_at is null
        and expires_at > now()
      order by last_seen_at desc, created_at desc`,
    [userId],
  );
  return rows;
},

/** Revoke one owned session; false when it is missing, expired or not this user's. */
async revokeSessionById(userId, sessionId) {
  const { rowCount } = await this.pool.query(
    `update sessions set revoked_at = now()
      where id = $1 and user_id = $2 and revoked_at is null`,
    [sessionId, userId],
  );
  return rowCount > 0;
},

async revokeSession(tokenHash) {
  await this.pool.query(
    `update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
    [tokenHash],
  );
},

async revokeUserSessions(userId) {
  await this.pool.query(
    `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
    [userId],
  );
},

async createOrgWithOwner({ name, slug, userId }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const org = (
      await client.query(
        `insert into orgs (name, slug, created_by) values ($1, $2, $3)
         returning id, name, slug`,
        [name, slug, userId],
      )
    ).rows[0];
    await client.query(
      `insert into org_memberships (org_id, user_id, relation, state)
       values ($1, $2, 'member', 'active')`,
      [org.id, userId],
    );
    await client.query(
      `insert into admin_roles (org_id, user_id, role, granted_by)
       values ($1, $2, 'org_admin', $2)`,
      [org.id, userId],
    );
    await client.query(`insert into org_policies (org_id) values ($1)`, [org.id]);
    const team = (
      await client.query(
        `insert into teams (org_id, name) values ($1, 'General')
         returning id, name`,
        [org.id],
      )
    ).rows[0];
    await client.query(
      `insert into team_memberships (team_id, user_id, role) values ($1, $2, 'admin')`,
      [team.id, userId],
    );
    await client.query("commit");
    return { org, team };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async getOrg(orgId) {
  const { rows } = await this.pool.query(
    `select id, name, slug, created_at from orgs where id = $1`,
    [orgId],
  );
  return rows[0] ?? null;
},

async renameOrg({ orgId, name }) {
  const { rows } = await this.pool.query(
    `update orgs set name = $2 where id = $1 returning id, name, slug`,
    [orgId, name],
  );
  return rows[0] ?? null;
},

async listOrgsForUser(userId) {
  const { rows } = await this.pool.query(
    `select o.id, o.name, o.slug, m.relation, m.state
       from org_memberships m
       join orgs o on o.id = m.org_id
      where m.user_id = $1 and m.state in ('active', 'invited')
      order by o.created_at`,
    [userId],
  );
  return rows;
},

async getOrgMembership(orgId, userId) {
  const { rows } = await this.pool.query(
    `select relation, state from org_memberships where org_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  return rows[0] ?? null;
},

async listOrgMembers(orgId, { includeGuests = true } = {}) {
  const { rows } = await this.pool.query(
    `select u.id, u.email, u.name, m.relation, m.state,
            coalesce(
              array_agg(a.role order by a.role) filter (where a.role is not null),
              '{}'::text[]
            ) as roles
       from org_memberships m
       join users u on u.id = m.user_id
       left join admin_roles a on a.org_id = m.org_id and a.user_id = m.user_id
      where m.org_id = $1 and ($2 or m.relation = 'member')
      group by u.id, u.email, u.name, m.relation, m.state
      order by u.name`,
    [orgId, includeGuests],
  );
  return rows;
},

async listOrgRoles(orgId, userId) {
  const { rows } = await this.pool.query(
    `select role from admin_roles where org_id = $1 and user_id = $2 order by role`,
    [orgId, userId],
  );
  return rows.map((row) => row.role);
},

async restoreOrgMember(orgId, userId) {
  const { rows } = await this.pool.query(
    `update org_memberships set state = 'active'
      where org_id = $1 and user_id = $2 and state = 'suspended'
      returning user_id`,
    [orgId, userId],
  );
  return rows.length > 0;
},

async setOrgAdmin({ orgId, userId, role, grantedBy }) {
  await this.pool.query(
    `insert into admin_roles (org_id, user_id, role, granted_by)
     values ($1, $2, $3, $4)
     on conflict (org_id, user_id, role) do nothing`,
    [orgId, userId, role, grantedBy],
  );
},

async hasOrgRole(orgId, userId, role) {
  // A role without a seat is not a role: suspension and removal must end it (ADR-161).
  const { rows } = await this.pool.query(
    `select 1
       from admin_roles a
       join org_memberships m on m.org_id = a.org_id and m.user_id = a.user_id
      where a.org_id = $1 and a.user_id = $2 and a.role = $3
        and m.state = 'active' and m.relation = 'member'`,
    [orgId, userId, role],
  );
  return rows.length > 0;
},

async countOrgAdmins(orgId) {
  const { rows } = await this.pool.query(
    `select count(*)::int as total
       from admin_roles a
       join org_memberships m on m.org_id = a.org_id and m.user_id = a.user_id
      where a.org_id = $1 and a.role = 'org_admin' and m.state = 'active'`,
    [orgId],
  );
  return rows[0]?.total ?? 0;
},

async listTeams(orgId) {
  const { rows } = await this.pool.query(
    `select id, name from teams where org_id = $1 order by name`,
    [orgId],
  );
  return rows;
},

async createTeam({ orgId, name }) {
  const { rows } = await this.pool.query(
    `insert into teams (org_id, name) values ($1, $2) returning id, name`,
    [orgId, name],
  );
  return rows[0];
},

async getTeam(orgId, teamId) {
  const { rows } = await this.pool.query(
    `select id, name from teams where id = $2 and org_id = $1`,
    [orgId, teamId],
  );
  return rows[0] ?? null;
},

async renameTeam({ orgId, teamId, name }) {
  const { rows } = await this.pool.query(
    `update teams set name = $3 where id = $2 and org_id = $1 returning id, name`,
    [orgId, teamId, name],
  );
  return rows[0] ?? null;
},

async teamUsage(teamId) {
  const { rows } = await this.pool.query(
    `select
       (select count(*)::int from boards where team_id = $1) as boards,
       (select count(*)::int from board_grants
         where subject_type = 'team' and subject_id = $1) as grants`,
    [teamId],
  );
  return rows[0] ?? { boards: 0, grants: 0 };
},

async deleteTeam({ orgId, teamId }) {
  const { rows } = await this.pool.query(
    `delete from teams where id = $2 and org_id = $1 returning id`,
    [orgId, teamId],
  );
  return rows[0] ?? null;
},

async listTeamMembers(teamId) {
  const { rows } = await this.pool.query(
    `select u.id, u.name, u.email, tm.role
       from team_memberships tm
       join users u on u.id = tm.user_id
      where tm.team_id = $1 and tm.source = 'direct'
      order by u.name`,
    [teamId],
  );
  return rows;
},

async addTeamMember({ teamId, userId, role = "member" }) {
  await this.pool.query(
    `insert into team_memberships (team_id, user_id, role)
     values ($1, $2, $3)
     on conflict (team_id, user_id, source) do update set role = excluded.role`,
    [teamId, userId, role],
  );
},

async removeTeamMember({ teamId, userId }) {
  const { rowCount } = await this.pool.query(
    `delete from team_memberships where team_id = $1 and user_id = $2 and source = 'direct'`,
    [teamId, userId],
  );
  return rowCount > 0;
},

async createInvitation({
  orgId,
  targetType,
  targetId,
  email,
  subjectKind,
  role,
  tokenHash,
  expiresAt,
  createdBy,
}) {
  const { rows } = await this.pool.query(
    `insert into invitations
       (org_id, target_type, target_id, email, subject_kind, role, token_hash, expires_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, org_id, target_type, target_id, email, subject_kind, role, state, expires_at`,
    [orgId, targetType, targetId ?? null, email, subjectKind, role, tokenHash, expiresAt, createdBy],
  );
  return rows[0];
},

async listInvitations(orgId) {
  const { rows } = await this.pool.query(
    `select id, target_type, target_id, email, subject_kind, role, state, expires_at, created_at
       from invitations
      where org_id = $1 and state = 'pending'
      order by created_at desc`,
    [orgId],
  );
  return rows;
},

async revokeInvitation(orgId, id) {
  const { rows } = await this.pool.query(
    `update invitations set state = 'revoked'
      where id = $1 and org_id = $2 and state = 'pending'
      returning id`,
    [id, orgId],
  );
  return rows[0] ?? null;
},

async acceptInvitation({ tokenHash, userId, email }) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select id, org_id, target_type, target_id, email, subject_kind, role, expires_at
         from invitations
        where token_hash = $1 and state = 'pending'
        for update`,
      [tokenHash],
    );
    const invitation = rows[0];
    if (!invitation) {
      await client.query("rollback");
      return null;
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      await client.query(`update invitations set state = 'expired' where id = $1`, [
        invitation.id,
      ]);
      await client.query("commit");
      return { expired: true };
    }
    // The recipient check belongs inside the transaction, before any grant: the token
    // is a bearer secret, and a holder must not gain access merely by presenting it.
    if (normalizeEmail(email) !== normalizeEmail(invitation.email)) {
      await client.query("rollback");
      return { mismatch: true };
    }
    // Both branches below set the seat to active, so an invitation would otherwise undo
    // a suspension that only an administrator may lift (ADR-161).
    const seat = await client.query(
      `select state from org_memberships where org_id = $1 and user_id = $2 for update`,
      [invitation.org_id, userId],
    );
    if (seat.rows[0]?.state === "suspended") {
      await client.query("rollback");
      return { suspended: true };
    }

    if (invitation.subject_kind === "member") {
      await client.query(
        `insert into org_memberships (org_id, user_id, relation, state)
         values ($1, $2, 'member', 'active')
         on conflict (org_id, user_id)
         do update set relation = 'member', state = 'active'`,
        [invitation.org_id, userId],
      );
      const teams = await client.query(
        `select id from teams where org_id = $1 order by created_at limit 1`,
        [invitation.org_id],
      );
      const teamId = teams.rows[0]?.id;
      if (teamId) {
        await client.query(
          `insert into team_memberships (team_id, user_id, role)
           values ($1, $2, 'member')
           on conflict (team_id, user_id, source) do nothing`,
          [teamId, userId],
        );
      }
    } else {
      await client.query(
        `insert into org_memberships (org_id, user_id, relation, state)
         values ($1, $2, 'guest', 'active')
         on conflict (org_id, user_id)
         do update set relation = 'guest', state = 'active'`,
        [invitation.org_id, userId],
      );
      if (invitation.target_type === "board" && invitation.target_id) {
        await client.query(
          `insert into board_grants (board_id, subject_type, subject_id, role, granted_by)
           values ($1, 'user', $2, $3, $4)
           on conflict (board_id, subject_type, subject_id)
           do update set role = excluded.role`,
          [invitation.target_id, userId, invitation.role, invitation.created_by],
        );
        await client.query(
          `update boards set acl_version = acl_version + 1 where id = $1`,
          [invitation.target_id],
        );
      }
    }

    await client.query(
      `update invitations
          set state = 'accepted', accepted_by = $2, accepted_at = now()
        where id = $1`,
      [invitation.id, userId],
    );
    await client.query("commit");
    return { invitation };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async hasActiveMembership(orgId, userId) {
  const { rows } = await this.pool.query(
    `select 1 from org_memberships
      where org_id = $1 and user_id = $2 and state in ('active', 'invited')`,
    [orgId, userId],
  );
  return rows.length > 0;
},

async suspendOrgMember(orgId, userId) {
  await this.pool.query(
    `update org_memberships set state = 'suspended'
      where org_id = $1 and user_id = $2`,
    [orgId, userId],
  );
  // A token is a portable credential; it must not outlive the owner's seat. Revoke it
  // now so a later restore does not bring the old token back (AG-07).
  await this.pool.query(
    `update agent_tokens t
        set revoked_at = now()
       from agents a
      where t.agent_id = a.id
        and a.org_id = $1 and a.owner_id = $2
        and t.revoked_at is null`,
    [orgId, userId],
  );
},

async removeOrgMember(orgId, userId) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from org_memberships where org_id = $1 and user_id = $2`,
      [orgId, userId],
    );
    await client.query(`delete from admin_roles where org_id = $1 and user_id = $2`, [
      orgId,
      userId,
    ]);
    await client.query(
      `delete from team_memberships tm
        using teams t
        where tm.team_id = t.id and t.org_id = $1 and tm.user_id = $2`,
      [orgId, userId],
    );
    // The seat is gone; so is every token that acted for it (AG-07).
    await client.query(
      `update agent_tokens t
          set revoked_at = now()
         from agents a
        where t.agent_id = a.id
          and a.org_id = $1 and a.owner_id = $2
          and t.revoked_at is null`,
      [orgId, userId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async removeOrgRole(orgId, userId, role) {
  const client = await this.pool.connect();
  try {
    await client.query("begin");
    if (role === "org_admin") {
      const { rows } = await client.query(
        `select count(*)::int as total
           from admin_roles a
           join org_memberships m on m.org_id = a.org_id and m.user_id = a.user_id
          where a.org_id = $1 and a.role = 'org_admin'
            and m.state = 'active' and a.user_id <> $2`,
        [orgId, userId],
      );
      if ((rows[0]?.total ?? 0) === 0) {
        await client.query("rollback");
        return { lastAdmin: true };
      }
    }
    await client.query(
      `delete from admin_roles where org_id = $1 and user_id = $2 and role = $3`,
      [orgId, userId, role],
    );
    await client.query("commit");
    return { lastAdmin: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
},

async recordAudit(event) {
  await this.pool.query(
    `insert into audit_events
       (actor_id, org_id, board_id, action, subject, before, after, request_id, reason,
        actor_type, agent_id, task_id, skill, session_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      event.actorId ?? null,
      event.orgId ?? null,
      event.boardId ?? null,
      event.action,
      event.subject ?? null,
      event.before ? JSON.stringify(event.before) : null,
      event.after ? JSON.stringify(event.after) : null,
      event.requestId ?? null,
      event.reason ?? null,
      event.actorType ?? "user",
      event.agentId ?? null,
      event.taskId ?? null,
      event.skill ?? null,
      event.sessionId ?? null,
    ],
  );
},

async listAudit(orgId, { limit = 100 } = {}) {
  // Names, not ids: the journal is read by people, and an id would only send the
  // reader to another screen. A deleted account keeps its historical subject text.
  const { rows } = await this.pool.query(
    `select e.id, e.at, e.actor_id, u.name as actor_name, u.email as actor_email,
            e.actor_type, e.agent_id, ag.name as agent_name, e.task_id, e.skill,
            e.session_id, e.board_id, b.title as board_title, e.action, e.subject,
            e.before, e.after, e.request_id, e.reason
       from audit_events e
       left join users u on u.id = e.actor_id
       left join agents ag on ag.id = e.agent_id
       left join boards b on b.id = e.board_id
      where e.org_id = $1
      order by e.at desc
      limit $2`,
    [orgId, Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
},

async getOrgPolicy(orgId) {
  const { rows } = await this.pool.query(
    `select can_share as "canShare", public_links as "publicLinks",
            agents_enabled as "agentsEnabled"
       from org_policies where org_id = $1`,
    [orgId],
  );
  return rows[0] ?? { canShare: true, publicLinks: false, agentsEnabled: false };
},

async setOrgAgentsEnabled(orgId, enabled) {
  const { rows } = await this.pool.query(
    `insert into org_policies (org_id, agents_enabled) values ($1, $2)
     on conflict (org_id) do update set agents_enabled = excluded.agents_enabled
     returning agents_enabled as "agentsEnabled"`,
    [orgId, enabled],
  );
  return rows[0]?.agentsEnabled === true;
},

async setBoardAgentsEnabled(boardId, enabled) {
  const { rows } = await this.pool.query(
    `update boards set agents_enabled = $2 where id = $1 returning agents_enabled`,
    [boardId, enabled],
  );
  return rows[0]?.agents_enabled === true;
}
};
