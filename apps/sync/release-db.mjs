/** Production database preparation (ADR-221). Run from the release's sync image. */
import pg from "pg";
import { PostgresStore } from "./postgres.mjs";
import { applyRls, inspectRls } from "./rls-admin.mjs";
import { SCHEMA_VERSION } from "./schema-version.mjs";

async function inspectConnection(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows: [identity] } = await client.query(
      `select r.rolname as role, r.rolsuper or r.rolbypassrls as bypass,
              jsonb_build_array(d.datname, d.oid, extract(epoch from pg_postmaster_start_time())::text) as database,
              to_regclass('public.schema_meta') is not null as has_schema
         from pg_roles r cross join pg_database d
        where r.rolname = current_user and d.datname = current_database()`,
    );
    return { ...identity, version: identity.has_schema ? await schemaVersion(client) : 0 };
  } finally {
    await client.end().catch(() => {});
  }
}

async function schemaVersion(client) {
  const { rows } = await client.query("select version from public.schema_meta where id = 1");
  return rows[0]?.version ?? 0;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const migrationConnectionString = process.env.REMO_MIGRATION_DATABASE_URL;
  if (!connectionString || !migrationConnectionString || connectionString === migrationConnectionString) {
    throw new Error("Set distinct application and migration database connections.");
  }
  const [app, owner] = await Promise.all([
    inspectConnection(connectionString),
    inspectConnection(migrationConnectionString),
  ]);
  if (app.bypass || !owner.bypass || app.role === owner.role) {
    throw new Error("The application role must be subject to RLS and the migration role must be able to bypass it.");
  }
  const database = JSON.stringify(owner.database);
  if (JSON.stringify(app.database) !== database) {
    throw new Error("Application and migration connections must point to the same PostgreSQL database.");
  }
  const backup = process.env.REMO_BACKUP_DATABASE;
  if (backup && JSON.stringify(JSON.parse(backup)) !== database) {
    throw new Error("The backup tools point to a different PostgreSQL database.");
  }
  if (owner.version > SCHEMA_VERSION) {
    throw new Error(`Database schema ${owner.version} is newer than release schema ${SCHEMA_VERSION}.`);
  }
  console.log(`Database preflight: schema ${owner.version} to ${SCHEMA_VERSION}, application role ${app.role}`);
  if (process.argv.includes("--check-connections")) {
    if (!backup) throw new Error("The release controller must supply the backup database identity.");
    return;
  }

  const store = new PostgresStore({ connectionString, migrationConnectionString });
  let protectedTables;
  try {
    await store.connect({
      finalizeMigration: async (client) => {
        if (await schemaVersion(client) !== SCHEMA_VERSION) {
          throw new Error(`Expected database schema ${SCHEMA_VERSION}.`);
        }
        await applyRls(client);
        const { rows, missing, unprotected, appAccessProblems } = await inspectRls(client, app.role);
        const problems = [...missing, ...[...unprotected, ...appAccessProblems].map((row) => row.relname)];
        if (problems.length) throw new Error(`RLS verification failed for: ${[...new Set(problems)].join(", ")}`);
        protectedTables = rows.length;
      },
    });
  } finally {
    await store.close();
  }
  console.log(`Database schema ${SCHEMA_VERSION}, RLS verified on ${protectedTables} tables.`);
}

try {
  await main();
} catch (error) {
  console.error(`[release-db] ${error.code ?? error.message}`);
  process.exitCode = 1;
}
