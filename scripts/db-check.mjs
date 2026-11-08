/**
 * Postgres connectivity check.
 *
 *   docker compose up -d
 *   node scripts/db-check.mjs
 *
 * Reports the server version, creates the projection schema if it is missing, and
 * proves a write/read round trip. Exits non-zero when the database is unreachable,
 * so it can be used as a preflight in CI or before starting the persistence worker.
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

const url = databaseUrl();

let pg;
try {
  pg = await import("pg");
} catch {
  console.error("The `pg` package is not installed. Run: pnpm install");
  process.exit(2);
}

const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  const { rows: version } = await client.query("select version() as version");
  const { rows: time } = await client.query("select now() as now");
  console.log(`connected: ${url.replace(/:[^:@/]+@/, ":***@")}`);
  console.log(`server:    ${version[0].version.split(",")[0]}`);
  console.log(`server time: ${time[0].now.toISOString()}`);

  // The real schema, not a hand-written subset: two DDL sources drift, and a fresh
  // volume then migrates into a shape that no test ever saw (ADR-089).
  const schema = readFileSync(join(HERE, "..", "apps", "sync", "schema.sql"), "utf8");
  await client.query(schema);
  console.log("schema:    applied from apps/sync/schema.sql");

  const probe = `check-${Date.now()}`;
  await client.query(
    "insert into boards (id, title) values ($1, $2) on conflict (id) do update set title = $2",
    [probe, "connectivity probe"],
  );
  const { rows: found } = await client.query("select title from boards where id = $1", [probe]);
  await client.query("delete from boards where id = $1", [probe]);

  // Built-in agent skills live in code, not in a tenant: a database checked by this
  // script must also get them, or a fresh dev DB answers SKILL_UNAVAILABLE.
  const { PostgresStore } = await import("../apps/sync/postgres.mjs");
  const store = new PostgresStore({
    connectionString: url,
    log: { log() {}, error() {} },
  });
  try {
    await store.connect();
  } finally {
    await store.close();
  }

  const ok = found.length === 1 && found[0].title === "connectivity probe";
  console.log(`round trip: ${ok ? "ok" : "FAILED"}`);
  console.log(ok ? "DB CHECK OK" : "DB CHECK FAILED");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  const detail = error.message || error.code || String(error);
  const cause = error.errors?.map((e) => e.code ?? e.message).filter(Boolean).join(", ");
  console.error(`DB CHECK FAILED: ${detail}${cause ? ` (${cause})` : ""}`);
  console.error("Is Docker running?  docker compose up -d");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
