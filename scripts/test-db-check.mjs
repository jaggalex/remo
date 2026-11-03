#!/usr/bin/env node
/**
 * Read-only readiness and identity check for the dedicated test PostgreSQL (ADR-136).
 *
 *   pnpm test:db:check
 *
 * Never creates, migrates or drops anything. Exits non-zero with an actionable message
 * when the test server is down, un-bootstrapped, or is a different environment.
 */
import {
  TestEnvironmentError,
  controlUrlOf,
  describeTestEnvironment,
  redactPostgresUrl,
  testPostgresUrl,
  verifyTestEnvironment,
} from "./test-environment.mjs";

const { default: pg } = await import("pg");
const url = testPostgresUrl();

async function connect(connectionString) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  return client;
}

let identity;
try {
  identity = await verifyTestEnvironment(url, { connect });
} catch (error) {
  console.error(`[test-db] NOT READY: ${error instanceof TestEnvironmentError ? error.message : error.message}`);
  if (error?.code === "ECONNREFUSED" || /cannot reach/.test(error?.message ?? "")) {
    console.error("[test-db] start it with: pnpm test:db:up");
  } else {
    console.error("[test-db] install the identity with: pnpm test:db:init");
    console.error("[test-db] diagnostics: pnpm test:db:logs");
  }
  process.exit(1);
}

let client;
try {
  client = await connect(controlUrlOf(url));
  const { rows: version } = await client.query("select version() as version");
  const { rows: managed } = await client.query(
    "select count(*)::int as count from pg_database where datname like 'remo_test\\_%' " +
      "and datname <> 'remo_test_control'",
  );
  console.log(`[test-db] READY: ${describeTestEnvironment(url, identity)}`);
  console.log(`[test-db] url: ${redactPostgresUrl(url)}`);
  console.log(`[test-db] server: ${version[0].version.split(",")[0]}`);
  console.log(`[test-db] managed databases currently present: ${managed[0].count}`);
} catch (error) {
  console.error(`[test-db] identity verified but the control database is unreadable: ${error.message}`);
  process.exit(1);
} finally {
  await client?.end?.().catch(() => {});
}
