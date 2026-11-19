#!/usr/bin/env node
/**
 * Prepare, and optionally drop, the database the e2e run owns (ADR-090/130/136).
 *
 * The service refuses to start when a configured database is unreachable, and a fresh
 * volume is exactly the case we want to test, so the database has to exist first.
 *
 * The database is recreated on every run: an accumulated e2e database produced duplicate
 * widget ids between runs and turned a product bug into a harness flake. The schema is
 * applied by the service itself.
 *
 * Ownership follows the same rules as the unit-test lifecycle (scripts/db-lifecycle.mjs):
 * the name is run-scoped, the database carries a marker scoped to the installed test
 * environment instance and run, and the target server is verified before mutation. An
 * existing database with a foreign or missing marker is preserved. `WITH (FORCE)` is never
 * used.
 *
 *   node scripts/e2e-db.mjs              prepare (called by the Playwright webServer)
 *   node scripts/e2e-db.mjs --teardown   drop only this run's database (called by e2e-run)
 */
import { isE2eDatabaseName, isValidRunToken } from "./db-identifiers.mjs";
import {
  DatabaseOwnershipError,
  dropOwnedDatabase,
  ensureOwnedDatabase,
} from "./db-lifecycle.mjs";
import {
  TestEnvironmentUnavailable,
  serverUrlOf,
  testPostgresUrl,
  verifyTestEnvironment,
} from "./test-environment.mjs";

const teardown = process.argv.includes("--teardown");
const expected = process.env.REMO_E2E_DATABASE_NAME ?? "";
const token = process.env.REMO_E2E_RUN_ID ?? "";

if (!isE2eDatabaseName(expected) || !isValidRunToken(token) || !expected.endsWith(`_${token}`)) {
  console.error(
    `[e2e] refusing to manage ${JSON.stringify(expected || "(unknown)")}: expected a ` +
      `run-scoped test database owned by ${JSON.stringify(token || "(unknown)")}.`,
  );
  console.error(
    "[e2e] the name and run id come from e2e/ports.ts and scripts/e2e-run.mjs; run the " +
      "gate through `pnpm e2e`, not this script directly.",
  );
  process.exit(1);
}

const server = testPostgresUrl();
let identity;
try {
  identity = await verifyTestEnvironment(server);
} catch (error) {
  console.error(`[e2e] ${error.message}`);
  if (error instanceof TestEnvironmentUnavailable) {
    console.error("[e2e] start the dedicated test server with: pnpm test:db:up");
  } else {
    console.error("[e2e] install the test identity with: pnpm test:db:init");
  }
  process.exit(1);
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: serverUrlOf(server),
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  if (teardown) {
    const dropped = await dropOwnedDatabase(client, { name: expected, token, identity });
    console.log(`[e2e] ${dropped ? "dropped" : "no database to drop"} ${expected}`);
  } else {
    const result = await ensureOwnedDatabase(client, {
      name: expected,
      token,
      identity,
      reset: true,
    });
    console.log(`[e2e] ${result} database ${expected}`);
  }
} catch (error) {
  console.error(`[e2e] ${teardown ? "could not drop" : "could not prepare"} database: ${error.message}`);
  if (error instanceof DatabaseOwnershipError) {
    console.error("[e2e] the database was left in place for manual inspection.");
  }
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
