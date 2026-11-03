/**
 * Vitest global setup for the database-backed suites (ADR-131, ADR-136).
 *
 * Three jobs, in this order:
 *
 * 1. Verify the installed test-environment identity from `REMO_TEST_POSTGRES_URL`. A server
 *    that answers without the expected identity is always fatal; an unreachable server is a
 *    local skip and a CI failure.
 * 2. Create `remo_test_<run>` and migrate it once, so the suites do not race their own DDL.
 *    The name carries a collision-resistant random token and the database carries an
 *    ownership marker scoped to the environment instance and run.
 * 3. Drop only the database this run created, and only while our marker is still on it.
 *    Nothing is deleted with `WITH (FORCE)`, and no other run's database is swept: a
 *    database whose owner cannot be proven is left alone.
 *
 * The create/drop rules live in scripts/db-lifecycle.mjs and are shared with the browser
 * gate, so both lifecycles cannot drift apart.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresStore } from "./postgres.mjs";
import {
  databaseUnavailable,
  isTestDatabaseName,
  runToken,
  testDatabaseName,
} from "./test-db.mjs";
import {
  DatabaseOwnershipError,
  dropOwnedDatabase,
  ensureOwnedDatabase,
} from "../../scripts/db-lifecycle.mjs";
import {
  TestEnvironmentUnavailable,
  databaseUrlFor,
  describeTestEnvironment,
  serverUrlOf,
  testPostgresUrl,
  verifyTestEnvironment,
} from "../../scripts/test-environment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** How many suites would be skipped without a database — the number in the warning. */
function databaseSuiteCount() {
  return readdirSync(HERE)
    .filter((file) => file.endsWith(".test.mjs"))
    .filter((file) => file !== "test-db.test.mjs")
    .filter((file) => readFileSync(join(HERE, file), "utf8").includes("testDatabaseStore("))
    .length;
}

async function withAdmin(connectionString, work) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export default async function setup() {
  const suites = databaseSuiteCount();
  const server = testPostgresUrl();

  let identity;
  try {
    identity = await verifyTestEnvironment(server);
  } catch (error) {
    if (error instanceof TestEnvironmentUnavailable) {
      databaseUnavailable(`${error.message};`, suites);
      return;
    }
    // A reachable server with a wrong/missing identity is never a local skip.
    throw error;
  }

  const token = runToken();
  const name = testDatabaseName();
  if (!isTestDatabaseName(name)) {
    throw new Error(`[test-db] refusing to manage a database outside ${name}'s namespace`);
  }
  const admin = serverUrlOf(server);

  try {
    await withAdmin(admin, (client) =>
      ensureOwnedDatabase(client, { name, token, identity, reset: true }),
    );
  } catch (error) {
    if (error instanceof DatabaseOwnershipError) throw error;
    databaseUnavailable(
      `cannot prepare ${name} (${error.code ?? error.message});`,
      suites,
    );
    return;
  }

  const store = new PostgresStore({
    connectionString: databaseUrlFor(server, name),
    log: { log() {}, error() {} },
  });
  try {
    await store.connect();
    await store.close();
  } catch (error) {
    // Migration failed after we created the database: undoing our own creation is safe.
    await withAdmin(admin, (client) => dropOwnedDatabase(client, { name, token, identity })).catch(
      () => {},
    );
    throw error;
  }
  console.log(`[test-db] ${name} created and migrated`);
  console.log(`[test-db] ${describeTestEnvironment(server, identity)}`);

  return async function teardown() {
    await withAdmin(admin, (client) => dropOwnedDatabase(client, { name, token, identity }))
      .then((dropped) => {
        if (dropped) console.log(`[test-db] dropped ${name}`);
      })
      .catch((error) => {
        const reason =
          error instanceof DatabaseOwnershipError ? "ownership uncertain" : error.message;
        console.warn(`[test-db] leaving ${name}: ${reason}. Drop it by hand if it is a leftover.`);
      });
  };
}
