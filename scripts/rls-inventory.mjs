#!/usr/bin/env node
/**
 * The work list for tenant isolation (ADR-178).
 *
 * Row-level security is only a guarantee when every tenant table has a tenant key and
 * `FORCE ROW LEVEL SECURITY`; a table that is merely "covered by a where clause" is the
 * bug the policy exists to catch. This script reads the catalog and prints the gaps. It
 * changes nothing.
 *
 *   node scripts/rls-inventory.mjs
 *   node scripts/rls-inventory.mjs --check   # exit 1 when a gap remains
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes("--check");

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

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl(),
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  const { rows } = await client.query(
    `select c.relname as table_name,
            c.relrowsecurity as rls,
            c.relforcerowsecurity as forced,
            exists (
              select 1 from information_schema.columns col
               where col.table_schema = 'public' and col.table_name = c.relname
                 and col.column_name = 'org_id'
            ) as has_org,
            exists (
              select 1 from information_schema.columns col
               where col.table_schema = 'public' and col.table_name = c.relname
                 and col.column_name = 'board_id'
            ) as has_board
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );

  // Tenant rows without their own key inherit it from a protected parent.
  const RELATED = new Set([
    "orgs",
    "team_memberships",
    "comment_reads",
    "votes",
    "agent_task_inputs",
  ]);
  // Identity and secrets are looked up before an organisation exists; they are not
  // tenant-scoped by a column and are covered by their own auth boundary.
  const GLOBAL = new Set(["agent_tokens", "ai_credentials", "sessions", "users", "schema_meta"]);

  const tenant = rows.filter((row) => row.has_org || row.has_board);
  const related = rows.filter((row) => RELATED.has(row.table_name));
  const scoped = tenant.filter((row) => row.has_org);
  const boardOnly = tenant.filter((row) => !row.has_org && row.has_board);
  const unprotected = tenant.filter((row) => !row.rls || !row.forced);
  const relatedUnprotected = related.filter((row) => !row.rls || !row.forced);
  const noKey = rows.filter(
    (row) =>
      !row.has_org &&
      !row.has_board &&
      !RELATED.has(row.table_name) &&
      !GLOBAL.has(row.table_name),
  );

  console.log(`tenant tables: ${tenant.length}`);
  console.log(`  org_id direct: ${scoped.length}`);
  console.log(`  board-scoped:  ${boardOnly.length}`);

  if (boardOnly.length) {
    console.log("\nboard-scoped tables (policy joins boards.org_id):");
    for (const row of boardOnly) {
      console.log(`  ${row.table_name}  rls=${row.rls ? "on" : "off"} forced=${row.forced ? "yes" : "no"}`);
    }
  }

  if (unprotected.length || relatedUnprotected.length) {
    console.log("\ngaps — RLS off or not forced:");
    for (const row of [...unprotected, ...relatedUnprotected]) {
      console.log(
        `  ${row.table_name}  key=${row.has_org ? "org_id" : row.has_board ? "board_id" : "none"}` +
          `  rls=${row.rls ? "on" : "off"} forced=${row.forced ? "yes" : "no"}`,
      );
    }
  } else {
    console.log("\nRLS: every tenant table has a policy and FORCE is on.");
  }

  if (noKey.length) {
    console.log("\ntables with neither org_id nor board_id (review manually):");
    console.log(`  ${noKey.map((row) => row.table_name).join(", ")}`);
  }
  console.log(`\nglobal identity/secrets (outside tenant RLS): ${[...GLOBAL].join(", ")}`);

  if (
    CHECK &&
    (unprotected.length ||
      relatedUnprotected.length ||
      boardOnly.some((row) => !row.rls || !row.forced))
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`RLS INVENTORY FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
