#!/usr/bin/env node
/**
 * Find, archive or adopt rooms that have no owner (ADR-174).
 *
 * A room without an owner is closed: there is no access decision to make, and the old
 * legacy rule ("anyone with the link may edit") is gone. Existing rows are not a reason
 * to reopen it. The default is a read-only listing; nothing changes until `--archive`
 * or `--assign` is given, and archiving still needs `--yes`.
 *
 *   node scripts/ownerless-boards.mjs --list
 *   node scripts/ownerless-boards.mjs --archive --yes
 *   node scripts/ownerless-boards.mjs --assign <boardId> --user <email>
 *
 * The `--assign` path is the exception for a board whose owner is actually known. It
 * uses the person's first active organisation and team, creates a team when there is
 * none, and writes an audit row.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  // Prefer the owner/migration URL: schema work and inventory need to see every tenant.
  if (process.env.REMO_MIGRATION_DATABASE_URL) return process.env.REMO_MIGRATION_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(HERE, "..", ".env"), "utf8");
    const match = env.match(/^(?:REMO_MIGRATION_)?DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env — fall through to the compose defaults */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list") || args.length === 0;
const archive = args.includes("--archive");
const yes = args.includes("--yes");
const assignAt = args.indexOf("--assign");
const assignId = assignAt === -1 ? null : args[assignAt + 1];
const userAt = args.indexOf("--user");
const userEmail = userAt === -1 ? null : args[userAt + 1];

if (archive && assignId) {
  console.error("Choose one: --archive or --assign.");
  process.exit(2);
}
if (assignId && !userEmail) {
  console.error("--assign needs --user <email>.");
  process.exit(2);
}
if (archive && !yes) {
  console.error("--archive changes every unowned room. Re-run with --archive --yes.");
  process.exit(2);
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl(),
  connectionTimeoutMillis: 5000,
});

async function audit(boardId, orgId, action, subject, after) {
  await client.query(
    `insert into audit_events (actor_id, org_id, board_id, action, subject, after, actor_type)
     values (null, $2, $1, $3, $4, $5, 'system')`,
    [boardId, orgId ?? null, action, subject ?? null, after ? JSON.stringify(after) : null],
  );
}

async function list() {
  const { rows } = await client.query(
    `select b.id, b.title, b.updated_at, b.archived_at,
            b.snapshot is not null as has_snapshot,
            coalesce(w.count, 0)::int as widgets
       from boards b
       left join (select board_id, count(*) from widgets group by board_id) w on w.board_id = b.id
      where b.owner_id is null
      order by b.updated_at desc`,
  );
  if (!rows.length) {
    console.log("No rooms without an owner.");
    return rows;
  }
  console.log(`${rows.length} room(s) without an owner:`);
  for (const row of rows) {
    console.log(
      [
        row.id,
        `updated ${row.updated_at?.toISOString?.() ?? row.updated_at}`,
        `${row.widgets} widget(s)`,
        row.has_snapshot ? "snapshot" : "no snapshot",
        row.archived_at ? "already archived" : "open",
        row.title ? `"${row.title}"` : "(untitled)",
      ].join(" · "),
    );
  }
  return rows;
}

async function archiveAll() {
  const rows = await list();
  if (!rows.length) return;
  let archived = 0;
  for (const row of rows) {
    if (row.archived_at) continue;
    const { rows: updated } = await client.query(
      `update boards
          set archived_at = now(), acl_version = acl_version + 1
        where id = $1 and owner_id is null and archived_at is null
        returning id, title`,
      [row.id],
    );
    if (!updated.length) continue;
    await audit(row.id, null, "board.owner.archived", updated[0].title, {
      reason: "unowned room closed by ADR-174",
    });
    archived += 1;
  }
  console.log(`Archived ${archived} room(s).`);
}

async function assignOne(boardId, email) {
  const { rows: users } = await client.query(
    "select id, email, name from users where email = $1",
    [email.trim().toLowerCase()],
  );
  const user = users[0];
  if (!user) throw new Error(`no account with email ${email}`);

  const { rows: orgs } = await client.query(
    `select o.id, o.name
       from org_memberships m
       join orgs o on o.id = m.org_id
      where m.user_id = $1 and m.state = 'active'
      order by (o.kind = 'personal') desc, o.created_at
      limit 1`,
    [user.id],
  );
  const org = orgs[0];
  if (!org) throw new Error(`${email} is not an active member of any organisation`);

  let { rows: teams } = await client.query(
    "select id from teams where org_id = $1 order by created_at limit 1",
    [org.id],
  );
  if (!teams.length) {
    ({ rows: teams } = await client.query(
      "insert into teams (org_id, name) values ($1, 'General') returning id",
      [org.id],
    ));
  }
  const teamId = teams[0].id;
  await client.query(
    `insert into team_memberships (team_id, user_id, role)
     values ($1, $2, 'admin')
     on conflict do nothing`,
    [teamId, user.id],
  );

  const { rows: updated } = await client.query(
    `update boards
        set owner_id = $2, org_id = $3, team_id = $4, claimed_at = now(),
            archived_at = null, acl_version = acl_version + 1
      where id = $1 and owner_id is null
      returning id, title`,
    [boardId, user.id, org.id, teamId],
  );
  if (!updated.length) throw new Error(`board ${boardId} is unknown or already has an owner`);
  await audit(boardId, org.id, "board.owner.assigned", updated[0].title, { ownerId: user.id });
  console.log(`Assigned ${boardId} to ${email} (${org.name}).`);
}

try {
  await client.connect();
  if (assignId) {
    await assignOne(assignId, userEmail);
  } else if (archive) {
    await archiveAll();
  } else if (listOnly) {
    await list();
  }
} catch (error) {
  console.error(`OWNERLESS BOARDS FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
