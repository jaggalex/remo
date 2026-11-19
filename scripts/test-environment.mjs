/**
 * The test PostgreSQL environment: one connection contract, one installed identity.
 *
 * Every supported test path reads `REMO_TEST_POSTGRES_URL` (defaulting to the dedicated
 * `remo-test` Compose server) and verifies the identity row before it creates or drops a
 * database. There is deliberately no fallback to `DATABASE_URL` or to the repository
 * `.env`: those belong to the development environment.
 *
 * The identity is installed once per server volume by `scripts/test-db-init.mjs`:
 * `test_environment_identity` holds the fixed environment name, the fixed database
 * namespace and a random instance id. The instance id is part of every ownership marker,
 * so a database created by another test server can never be treated as ours.
 */
import { withAdvisoryLock } from "./db-lifecycle.mjs";
import { TEST_CONTROL_DATABASE } from "./db-identifiers.mjs";

export { TEST_CONTROL_DATABASE };

export const TEST_ENVIRONMENT_NAME = "remo-test";
export const TEST_DATABASE_NAMESPACE = "remo_test";

/** Dedicated Compose server from docker-compose.test.yml, bound to loopback. */
export const DEFAULT_TEST_POSTGRES_URL =
  "postgres://remo_test:remo_test@127.0.0.1:55432/remo_test_control";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The server this test process may talk to. Never the development database. */
export function testPostgresUrl(env = process.env) {
  const raw = String(env.REMO_TEST_POSTGRES_URL ?? "").trim();
  const value = raw || DEFAULT_TEST_POSTGRES_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TestEnvironmentMismatch(
      `REMO_TEST_POSTGRES_URL is not a valid URL: ${JSON.stringify(raw)}`,
    );
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TestEnvironmentMismatch(
      "REMO_TEST_POSTGRES_URL must use the postgres:// scheme",
    );
  }
  return url.toString();
}

/** The same server connected to `postgres`, for CREATE/DROP and bootstrap work. */
export function serverUrlOf(connectionString) {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

/** The control database that carries the installed environment identity. */
export function controlUrlOf(connectionString) {
  const url = new URL(connectionString);
  url.pathname = `/${TEST_CONTROL_DATABASE}`;
  return url.toString();
}

/** A run-scoped database on the same test server. */
export function databaseUrlFor(connectionString, name) {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Safe for logs and diagnostics. */
export function redactPostgresUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(invalid URL)";
  }
}

export class TestEnvironmentError extends Error {}

/** The server or its bootstrap identity is not reachable. */
export class TestEnvironmentUnavailable extends TestEnvironmentError {}

/** The server answered, but it is not the installed `remo-test` environment. */
export class TestEnvironmentMismatch extends TestEnvironmentError {}

/** The server is reachable but has no installed identity yet. */
export class TestEnvironmentNotBootstrapped extends TestEnvironmentMismatch {}

/** Validate the shape of an identity row without trusting the server's host or port. */
export function identityFromRow(row) {
  if (!row) {
    throw new TestEnvironmentMismatch(
      "test_environment_identity is empty; run `pnpm test:db:init` against the test server",
    );
  }
  if (row.environment !== TEST_ENVIRONMENT_NAME) {
    throw new TestEnvironmentMismatch(
      `test environment is ${JSON.stringify(row.environment)}, expected ` +
        `${JSON.stringify(TEST_ENVIRONMENT_NAME)}`,
    );
  }
  if (row.namespace !== TEST_DATABASE_NAMESPACE) {
    throw new TestEnvironmentMismatch(
      `test namespace is ${JSON.stringify(row.namespace)}, expected ` +
        `${JSON.stringify(TEST_DATABASE_NAMESPACE)}`,
    );
  }
  if (!UUID.test(String(row.instance_id ?? ""))) {
    throw new TestEnvironmentMismatch(
      `test environment instance id is invalid: ${JSON.stringify(row.instance_id)}`,
    );
  }
  return {
    name: row.environment,
    namespace: row.namespace,
    instanceId: String(row.instance_id),
  };
}

/** Read and validate the identity through an already-connected control client. */
export async function readTestEnvironment(client) {
  let rows;
  try {
    ({ rows } = await client.query(
      "select environment, namespace, instance_id::text as instance_id " +
        "from test_environment_identity",
    ));
  } catch (error) {
    if (error?.code === "42P01") {
      throw new TestEnvironmentNotBootstrapped(
        "this server has no test_environment_identity table; it is not a bootstrapped " +
          "remo-test server. Run `pnpm test:db:init` against the dedicated test server.",
      );
    }
    throw error;
  }
  if (rows.length !== 1) {
    throw new TestEnvironmentMismatch(
      `expected exactly one test environment identity row, found ${rows.length}`,
    );
  }
  return identityFromRow(rows[0]);
}

async function defaultConnect(connectionString) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  return client;
}

async function closeClient(client) {
  try {
    await client?.end?.();
  } catch {
    /* diagnostics already returned; close failures change nothing */
  }
}

/**
 * Verify the installed identity before any database mutation.
 *
 * A connection failure is `TestEnvironmentUnavailable` (a local run may skip); a server
 * that answers without the expected identity is `TestEnvironmentMismatch` and is always
 * fatal. `connect` is injectable for tests.
 */
export async function verifyTestEnvironment(connectionString, options = {}) {
  const { connect = defaultConnect } = options;
  let client;
  try {
    client = await connect(controlUrlOf(connectionString));
  } catch (error) {
    throw new TestEnvironmentUnavailable(
      `cannot reach the test PostgreSQL at ${redactPostgresUrl(connectionString)} ` +
        `(${error?.code ?? error?.message}); start it with \`pnpm test:db:up\``,
    );
  }
  try {
    return await readTestEnvironment(client);
  } finally {
    await closeClient(client);
  }
}

/**
 * Install the identity on an empty test server. Idempotent: an existing identity is kept,
 * and a server that already carries a different environment is refused rather than
 * re-bootstrapped. This is the only operation allowed to create the control database, and
 * it never drops anything.
 */
export async function bootstrapTestEnvironment(connectionString, options = {}) {
  const { connect = defaultConnect } = options;
  let admin;
  try {
    admin = await connect(serverUrlOf(connectionString));
  } catch (error) {
    throw new TestEnvironmentUnavailable(
      `cannot reach the test PostgreSQL at ${redactPostgresUrl(connectionString)} ` +
        `(${error?.code ?? error?.message}); start it with \`pnpm test:db:up\``,
    );
  }
  try {
    await withAdvisoryLock(admin, TEST_CONTROL_DATABASE, async () => {
      // Safety before the identity exists: a dedicated test server starts empty. A server
      // that already carries any other database (the development server has `remo`) is
      // not ours to bootstrap, whatever its host or port says.
      const { rows: foreign } = await admin.query(
        "select datname from pg_database " +
          "where not datistemplate and datname not in ('postgres', $1)",
        [TEST_CONTROL_DATABASE],
      );
      if (foreign.length > 0) {
        throw new TestEnvironmentMismatch(
          "refusing to bootstrap: this server already contains other databases " +
            `(${foreign.map((row) => row.datname).join(", ")}). ` +
            "Point REMO_TEST_POSTGRES_URL at the dedicated empty test server.",
        );
      }
      const { rows } = await admin.query(
        "select 1 from pg_database where datname = $1",
        [TEST_CONTROL_DATABASE],
      );
      if (rows.length === 0) {
        await admin.query(`create database "${TEST_CONTROL_DATABASE}"`);
      }
    });
  } finally {
    await closeClient(admin);
  }

  const control = await connect(controlUrlOf(connectionString));
  try {
    return await withAdvisoryLock(control, TEST_CONTROL_DATABASE, async () => {
      await control.query(
        "create table if not exists test_environment_identity (" +
          "environment text primary key, " +
          "namespace text not null, " +
          "instance_id uuid not null, " +
          "bootstrapped_at timestamptz not null default now())",
      );
      await control.query(
        "insert into test_environment_identity (environment, namespace, instance_id) " +
          "values ($1, $2, gen_random_uuid()) on conflict (environment) do nothing",
        [TEST_ENVIRONMENT_NAME, TEST_DATABASE_NAMESPACE],
      );
      return readTestEnvironment(control);
    });
  } finally {
    await closeClient(control);
  }
}

export function describeTestEnvironment(connectionString, identity) {
  return (
    `test environment ${identity.name} (namespace ${identity.namespace}, instance ` +
    `${identity.instanceId}) at ${redactPostgresUrl(connectionString)}`
  );
}
