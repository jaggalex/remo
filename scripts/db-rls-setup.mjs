#!/usr/bin/env node
/**
 * Create the least-privilege role the application uses under RLS (ADR-178 stage 2).
 *
 * Run as the database owner (or a role that can create roles and grant on the schema):
 *
 *   REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls:setup
 *   REMO_APP_DB_PASSWORD=... pnpm db:rls:setup   # also makes the role able to log in
 *
 * The role gets DML on the public schema and nothing else: no ownership, no
 * `BYPASSRLS`, no DDL. Migrations keep using the owner URL.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROLE = process.env.REMO_APP_ROLE ?? "remo_app";
const PASSWORD = process.env.REMO_APP_DB_PASSWORD ?? null;

if (!/^[a-z_][a-z0-9_]*$/.test(ROLE)) {
  console.error(`[rls] REMO_APP_ROLE is not a valid identifier: ${ROLE}`);
  process.exit(2);
}

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
const client = new pg.Client({
  connectionString: databaseUrl(),
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  const { rows: existing } = await client.query(
    "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = $1",
    [ROLE],
  );
  if (!existing.length) {
    await client.query(`create role ${ROLE} nologin`);
    console.log(`[rls] created role ${ROLE}`);
  } else {
    console.log(`[rls] role ${ROLE} already exists`);
  }

  // A role that can bypass a policy is not a tenant role, whatever its name.
  await client.query(`alter role ${ROLE} nobypassrls nosuperuser`);
  if (PASSWORD) {
    const literal = String(PASSWORD).replace(/'/g, "''");
    await client.query(`alter role ${ROLE} login password '${literal}'`);
    console.log(`[rls] ${ROLE} can log in`);
  }

  await client.query(`grant usage on schema public to ${ROLE}`);
  await client.query(
    `grant select, insert, update, delete on all tables in schema public to ${ROLE}`,
  );
  await client.query(`grant usage, select on all sequences in schema public to ${ROLE}`);
  await client.query(`grant execute on all functions in schema public to ${ROLE}`);
  await client.query(
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${ROLE}`,
  );
  await client.query(
    `alter default privileges in schema public grant usage, select on sequences to ${ROLE}`,
  );
  await client.query(
    `alter default privileges in schema public grant execute on functions to ${ROLE}`,
  );

  console.log(`[rls] ${ROLE}: DML only, no ownership, no BYPASSRLS`);
  console.log(
    `[rls] set DATABASE_URL to a URL for ${ROLE} and REMO_MIGRATION_DATABASE_URL to the owner URL`,
  );
  console.log("[rls] then apply policies with: pnpm db:rls:enable");
} catch (error) {
  console.error(`[rls] setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
