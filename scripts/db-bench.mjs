/**
 * Read-path benchmark.
 *
 *   node scripts/db-bench.mjs [widgets]
 *
 * Fills a throwaway board with synthetic widgets, then times the queries the read
 * API issues and shows whether Postgres used the trigram index. Deletes its board
 * afterwards, so it is safe to run against a development database.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNT = Number(process.argv[2] ?? 5000);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(HERE, "..", ".env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000 });

const BOARD = `bench-${Date.now()}`;
const WORDS = [
  "checkout", "authentication", "dashboard", "onboarding", "billing", "search",
  "notifications", "analytics", "рефакторинг", "документация", "интеграция", "оплата",
];

const time = async (label, sql, params) => {
  // Warm the plan once, then measure.
  await client.query(sql, params);
  const started = process.hrtime.bigint();
  const { rows } = await client.query(sql, params);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(2).padStart(8)} ms  (${rows.length} rows)`);
  return ms;
};

try {
  await client.connect();
  // Apply the same schema the sync service applies, so the bench measures the real
  // indexes rather than whatever happened to be in place.
  await client.query(readFileSync(join(HERE, "..", "apps", "sync", "schema.sql"), "utf8"));

  console.log(`seeding ${COUNT} widgets into ${BOARD}…`);

  await client.query("insert into boards (id, snapshot) values ($1, ''::bytea)", [BOARD]);
  const words = WORDS.map((w) => `'${w}'`).join(",");
  await client.query(
    `insert into widgets (board_id, id, type, x, y, width, height, title, content)
     select $1,
            'w' || g,
            (array['sticky_note','card','text','frame'])[1 + (g % 4)],
            (g % 200) * 200, (g / 200) * 200, 161, 184,
            (array[${words}])[1 + (g % ${WORDS.length})] || ' ' || g,
            case when g % 3 = 0
                 then (array[${words}])[1 + ((g + 1) % ${WORDS.length})] || ' details for story ' || g
                 else null end
       from generate_series(1, $2) as g`,
    [BOARD, COUNT],
  );

  const { rows: counted } = await client.query(
    "select count(*)::int as n from widgets where board_id = $1",
    [BOARD],
  );
  console.log(`seeded rows: ${counted[0].n}`);

  console.log("\nqueries:");
  await time("board list", `select b.id from boards b
     left join (select board_id, count(*) from widgets group by board_id) w on w.board_id = b.id
     order by b.updated_at desc limit 100`);
  await time(
    "search (latin)",
    `select id from widgets where title ilike '%' || $1 || '%' or content ilike '%' || $1 || '%'
      order by updated_at desc limit 50`,
    ["billing"],
  );
  await time(
    "search (cyrillic)",
    `select id from widgets where title ilike '%' || $1 || '%' or content ilike '%' || $1 || '%'
      order by updated_at desc limit 50`,
    ["оплата"],
  );
  await time(
    "widgets of one board",
    "select id from widgets where board_id = $1 order by updated_at desc limit 200",
    [BOARD],
  );

  const searchSql = `select id from widgets
     where title ilike '%' || $1 || '%' or content ilike '%' || $1 || '%' limit 50`;

  // A selective term: the planner should choose the trigram index by itself.
  await time(
    "search (selective term)",
    `select id from widgets where title ilike '%' || $1 || '%' or content ilike '%' || $1 || '%'
      order by updated_at desc limit 50`,
    [`${COUNT - 1}`],
  );

  const plan = await client.query(
    `explain (analyze, costs off, timing off) ${searchSql}`,
    ["billing"],
  );
  const usedIndex = plan.rows.some((row) => /Index/.test(row["QUERY PLAN"]));
  console.log(`\ntrigram index picked by the planner: ${usedIndex ? "yes" : "no"}`);
  for (const row of plan.rows.slice(0, 8)) console.log(`  ${row["QUERY PLAN"]}`);

  // Prove the index is genuinely usable, even when the planner prefers a scan.
  await client.query("set enable_seqscan = off");
  const forced = await client.query(
    `explain (analyze, costs off, timing off) ${searchSql}`,
    ["billing"],
  );
  const forcedIndex = forced.rows.some((row) => /Index/.test(row["QUERY PLAN"]));
  console.log(`\nindex usable when a scan is discouraged: ${forcedIndex ? "yes" : "no"}`);
  for (const row of forced.rows.slice(0, 6)) console.log(`  ${row["QUERY PLAN"]}`);
  await client.query("reset enable_seqscan");

  await client.query("delete from boards where id = $1", [BOARD]);
  console.log(`\ncleaned up ${BOARD}`);
} catch (error) {
  console.error(`bench failed: ${error.message || error.code}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
