/**
 * Remove throwaway boards left behind by manual and automated testing.
 *
 *   node scripts/db-prune.mjs           # show what would be deleted
 *   node scripts/db-prune.mjs --yes     # delete
 *
 * Keeps anything that looks like a real board: only ids matching the test prefixes
 * below are candidates, and a board that has been given a title is never touched.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--yes");
const FORCE = process.argv.includes("--force");

/**
 * Names a template gives a board; anything else means a human named it.
 * Keep in sync with `TEMPLATE_LABELS` in `packages/model/src/template.ts`.
 */
const TEMPLATE_TITLES = new Set([
  "Story map",
  "Roadmap",
  "Roadmap example",
  "Kanban board",
]);

const TEST_PREFIXES = [
  "bench-",
  "smoke-",
  "keepalive-",
  "proxy-check",
  "perf",
  "text-demo",
  "mvp",
  "frame-test",
  "final-check",
  "persist-check",
  "dbg",
  "fresh",
  "fix-check",
  "stack-check",
  "connect",
  "authoring",
  "additive",
  "p1-",
  "p2-",
  "pg-demo",
];

function databaseUrl() {
  // Prefer the owner/migration URL: schema work and inventory need to see every tenant.
  if (process.env.REMO_MIGRATION_DATABASE_URL) return process.env.REMO_MIGRATION_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(HERE, "..", ".env"), "utf8");
    const match = env.match(/^(?:REMO_MIGRATION_)?DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  const { rows } = await client.query(
    `select b.id, b.title, coalesce(w.count, 0)::int as widgets
       from boards b
       left join (select board_id, count(*) from widgets group by board_id) w on w.board_id = b.id
      order by b.updated_at desc`,
  );

  const candidates = rows.filter((row) => TEST_PREFIXES.some((p) => row.id.startsWith(p)));
  // A board someone named themselves is never a leftover, even if its id looks
  // like a test: that rule is what keeps the delete button safe to press.
  const protectedRows = candidates.filter(
    (row) => row.title && !TEMPLATE_TITLES.has(row.title),
  );
  const doomed = FORCE ? candidates : candidates.filter((row) => !protectedRows.includes(row));
  const kept = rows.filter((row) => !doomed.includes(row));
  if (protectedRows.length && !FORCE) {
    console.log(`protected (named by hand, use --force to include):`);
    for (const row of protectedRows) console.log(`  ~ ${row.id} “${row.title}”`);
  }

  console.log(`${rows.length} boards, ${doomed.length} look like test leftovers:`);
  for (const row of doomed) console.log(`  - ${row.id} (${row.widgets} widgets)`);
  console.log(`${kept.length} kept (named, or not matching a test prefix):`);
  for (const row of kept) console.log(`  · ${row.id}${row.title ? ` “${row.title}”` : ""}`);

  if (!APPLY) {
    console.log("\ndry run — re-run with --yes to delete the listed test boards");
  } else {
    const ids = doomed.map((row) => row.id);
    if (ids.length) {
      await client.query("delete from boards where id = any($1::text[])", [ids]);
      console.log(`\ndeleted ${ids.length} board(s)`);
    }
  }
} catch (error) {
  console.error(`prune failed: ${error.message || error.code}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
