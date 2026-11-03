/**
 * The throwaway database the database-backed suites run against (ADR-131, ADR-136).
 *
 * One run owns `remo_test_<run>` on the dedicated test PostgreSQL: created before the
 * workers start, migrated once through the same path the service uses (ADR-089), dropped
 * when the run ends. The run token comes from the npm script
 * (`REMO_TEST_RUN=$$_<random>`), so two runs never share a database.
 *
 * The server comes only from `REMO_TEST_POSTGRES_URL` (default: the dedicated
 * `remo-test` Compose server on 127.0.0.1:55432). `DATABASE_URL` and the repository
 * `.env` are deliberately not consulted here: they belong to the development environment.
 *
 * `testDatabaseStore()` is the suite-level gate: a missing/unreachable server is an
 * intentional local skip, but a connection or migration failure is fatal under `CI`.
 */
import {
  TestEnvironmentUnavailable,
  databaseUrlFor,
  testPostgresUrl,
  verifyTestEnvironment,
} from "../../scripts/test-environment.mjs";
import {
  TEST_CONTROL_DATABASE,
  TEST_DB_PREFIX,
  isTestDatabaseName,
  testDatabaseName as derivedTestDatabaseName,
} from "../../scripts/db-identifiers.mjs";

export { TEST_DB_PREFIX, isTestDatabaseName };

/**
 * The run token, safe to put in an identifier and stable across every process of the run.
 * Falls back to `local` when unset. A token that would need normalising is refused: two
 * different raw values must never collapse onto one database name.
 */
export function runToken(raw = process.env.REMO_TEST_RUN ?? "local") {
  const value = String(raw).trim();
  if (`${TEST_DB_PREFIX}_${value}` === TEST_CONTROL_DATABASE) {
    throw new Error(
      "[test-db] REMO_TEST_RUN=control is reserved for the environment identity database",
    );
  }
  if (!isTestDatabaseName(`${TEST_DB_PREFIX}_${value}`)) {
    throw new Error(
      `[test-db] REMO_TEST_RUN ${JSON.stringify(raw)} must match [a-z0-9] with single ` +
        "underscores and be at most 40 characters; refusing to guess a database name",
    );
  }
  return value;
}

/** The database this run creates, migrates and drops. */
export function testDatabaseName(token = runToken()) {
  return derivedTestDatabaseName(token);
}

/**
 * The connection string the suites use. Always derived from the dedicated test server;
 * there is no development fallback and no explicit database URL that could bypass the
 * environment identity check performed by the global setup.
 */
export function testDatabaseUrl(env = process.env) {
  return databaseUrlFor(testPostgresUrl(env), testDatabaseName(env.REMO_TEST_RUN));
}

/**
 * Open the store a database suite tests against, or return null when the local inner loop
 * has no reachable test server.
 *
 * The installed environment identity is verified *before* the store is constructed: a
 * suite may not connect or run migrations against a server whose identity is missing or
 * mismatched. A connection failure is a local skip and a CI failure; a mismatch is always
 * fatal.
 *
 * This is the suite-level gate, not a startup probe: a URL that was reachable during the
 * global setup but fails when the suite connects is still fatal under `CI`, so a preliminary
 * probe can never stand in for the suite actually running.
 *
 * `options` exists for regression tests: inject a URL, an opener, an identity verifier and
 * an environment map. Production callers pass none of them.
 */
export async function testDatabaseStore(label = "database suite", options = {}) {
  const { url, open, env = process.env, verify } = options;
  const server = testPostgresUrl(env);

  try {
    await (verify ? verify(server) : verifyTestEnvironment(server));
  } catch (error) {
    if (error instanceof TestEnvironmentUnavailable) {
      databaseUnavailable(`${label}: ${error.message};`, 1, env);
      return null;
    }
    // A reachable server with a wrong/missing identity is never a local skip.
    throw error;
  }

  const connectionString =
    url === undefined ? databaseUrlFor(server, testDatabaseName(env.REMO_TEST_RUN)) : url;

  if (!connectionString) {
    databaseUnavailable(`${label}: no test database configured.`, 1, env);
    return null;
  }

  try {
    const store = open
      ? await open(connectionString)
      : await (async () => {
          const { PostgresStore } = await import("./postgres.mjs");
          const created = new PostgresStore({
            connectionString,
            log: { log() {}, error() {} },
          });
          await created.connect();
          return created;
        })();
    return { store, url: connectionString };
  } catch (error) {
    databaseUnavailable(
      `${label}: cannot use the test database (${error?.code ?? error?.message});`,
      1,
      env,
    );
    return null;
  }
}

/**
 * A skip is loud locally and fatal under CI. `env` is a parameter so the rule itself can be
 * tested without changing the process environment.
 */
export function databaseUnavailable(message, suites, env = process.env) {
  const text = `[test-db] ${message} ${suites} database suite${suites === 1 ? "" : "s"} skipped.`;
  if (env.CI) {
    // The gate must not go green with its database coverage removed (ADR-131).
    throw new Error(text);
  }
  console.warn(text);
  console.warn("[test-db] start the dedicated server with: pnpm test:db:up");
}
