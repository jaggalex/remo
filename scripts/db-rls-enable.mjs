#!/usr/bin/env node
/**
 * Apply or verify the stage-2 RLS pilot (ADR-178).
 *
 *   pnpm db:rls:enable
 *   pnpm db:rls:enable --check
 *
 * Run as the owner. The application role must already exist (`pnpm db:rls:setup`) and
 * the service must connect as it; `FORCE` does not exempt the table owner.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes("--check");
const TABLES = [
  "boards",
  "widgets",
  "board_grants",
  "board_updates",
  "kanban_cards",
  "kanban_columns",
  "kanban_swimlanes",
  "comments",
  "comment_threads",
  "board_links",
  "board_link_unlocks",
  "command_runs",
  "vote_sessions",
  "agent_actions",
  "orgs",
  "org_memberships",
  "teams",
  "admin_roles",
  "org_policies",
  "org_apps",
  "invitations",
  "integration_tokens",
  "agents",
  "agent_tasks",
  "agent_schedules",
  "agent_change_sets",
  "agent_task_plans",
  "ai_runs",
  "ai_log_anchors",
  "audit_events",
  "event_outbox",
  "org_webhooks",
  "agent_skills",
  "team_memberships",
  "comment_reads",
  "votes",
  "agent_task_inputs",
];

function databaseUrl() {
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

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000 });

try {
  await client.connect();

  // The helper functions are SECURITY DEFINER and owned by this role. Under FORCE they
  // bypass RLS only if the owner is a superuser or has BYPASSRLS.
  const { rows: me } = await client.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
  );
  const ownerBypasses = Boolean(me[0]?.rolsuper || me[0]?.rolbypassrls);
  if (!ownerBypasses) {
    const message =
      "[rls] the owner/migration role cannot bypass RLS; the security-definer lookups will return no rows";
    if (CHECK) {
      console.error(message);
      process.exitCode = 1;
    } else {
      console.warn(`${message}; use a BYPASSRLS migration role`);
    }
  }

  if (CHECK) {
    const { rows } = await client.query(
      `select c.relname,
              c.relrowsecurity as rls,
              c.relforcerowsecurity as forced,
              exists (select 1 from pg_policies p where p.tablename = c.relname) as policy
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])
        order by c.relname`,
      [TABLES],
    );
    const bad = rows.filter((row) => !row.rls || !row.forced || !row.policy);
    for (const row of rows) {
      console.log(
        `${row.relname}: rls=${row.rls ? "on" : "off"} forced=${row.forced ? "yes" : "no"} ` +
          `policy=${row.policy ? "yes" : "no"}`,
      );
    }
    const missing = TABLES.filter((table) => !rows.some((row) => row.relname === table));
    if (missing.length) console.log(`missing tables: ${missing.join(", ")}`);
    if (bad.length || missing.length) {
      console.error(`[rls] ${bad.length + missing.length} tenant table(s) are not protected`);
      process.exitCode = 1;
    } else {
      console.log(`[rls] ${rows.length} tenant table(s) protected`);
    }
  } else {
    const sql = readFileSync(join(HERE, "..", "apps", "sync", "rls.sql"), "utf8");
    await client.query(sql);
    console.log(`[rls] policies applied to ${TABLES.length} table(s)`);
    console.log("[rls] connect the service as remo_app and keep migrations on the owner URL");
  }
} catch (error) {
  console.error(`[rls] ${CHECK ? "check" : "apply"} failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
