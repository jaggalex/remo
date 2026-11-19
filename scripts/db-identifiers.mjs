/**
 * Names and ownership markers for databases the harness may create or drop.
 *
 * A database is the one destructive resource the gate touches, so the rules live in one
 * place instead of being re-derived by each script:
 *
 * - a name is either the canonical default or `prefix_<token>`, where the token is an
 *   exact lowercase identifier — no silent lossy normalisation that could map two runs
 *   onto one name;
 * - a test database carries an ownership marker written at creation, and only a marker
 *   that names this run makes the database ours to drop.
 *
 * Kept as plain `.mjs` so both the Node scripts and the Playwright config can import it.
 */

export const E2E_DB_PREFIX = "remo_test_e2e";
export const TEST_DB_PREFIX = "remo_test";
/** The bootstrap database: it carries identity, never a run identity. */
export const TEST_CONTROL_DATABASE = "remo_test_control";

/** Postgres caps identifiers at 63 bytes; leave room for the longest prefix. */
const MAX_TOKEN = 40;
const MAX_DB_NAME = 63;
const TOKEN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** An exact run token: lowercase, digits and single underscores, 1–40 characters. */
export function isValidRunToken(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN && TOKEN.test(value);
}

/**
 * A run suffix: lowercase, digits and single underscores. A value that would need
 * rewriting is refused, so `1000-a` and `1000_a` cannot collapse onto one run identity.
 * Shared by e2e/ports.ts and scripts/e2e-run.mjs so both derive the same name.
 */
export function normalizeRunSuffix(value) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (candidate === "") return "";
  if (!TOKEN.test(candidate) || candidate.length > MAX_TOKEN) {
    throw new Error(
      `E2E_RUN_SUFFIX ${JSON.stringify(value)} must match [a-z0-9] with single ` +
        `underscores and be at most ${MAX_TOKEN} characters`,
    );
  }
  return candidate;
}

/** The database one test run creates. Throws rather than normalising a bad token. */
export function testDatabaseName(token) {
  if (!isValidRunToken(token)) {
    throw new Error(
      `[test-db] run token ${JSON.stringify(token)} must match [a-z0-9] with single ` +
        `underscores and be 1-${MAX_TOKEN} characters; refusing to derive a database name`,
    );
  }
  return `${TEST_DB_PREFIX}_${token}`;
}

/** True only for `remo_test_<valid token>`; the control database is not a run database. */
export function isTestDatabaseName(name) {
  if (typeof name !== "string" || name.length > MAX_DB_NAME) return false;
  if (name === TEST_CONTROL_DATABASE) return false;
  const prefix = `${TEST_DB_PREFIX}_`;
  if (!name.startsWith(prefix)) return false;
  return isValidRunToken(name.slice(prefix.length));
}

/** The browser gate's database: a run-scoped name, never the bare prefix. */
export function e2eDatabaseName(suffix, token) {
  if (!isValidRunToken(token)) {
    throw new Error(
      `[e2e] run token ${JSON.stringify(token)} must match [a-z0-9] with single ` +
        `underscores and be 1-${MAX_TOKEN} characters; refusing to derive a database name`,
    );
  }
  if (suffix !== "" && !isValidRunToken(suffix)) {
    throw new Error(
      `[e2e] run suffix ${JSON.stringify(suffix)} must match [a-z0-9] with single ` +
        `underscores and be 1-${MAX_TOKEN} characters; refusing to derive a database name`,
    );
  }
  const name =
    suffix === "" ? `${E2E_DB_PREFIX}_${token}` : `${E2E_DB_PREFIX}_${suffix}_${token}`;
  if (name.length > MAX_DB_NAME) {
    throw new Error(
      `[e2e] database name ${JSON.stringify(name)} is longer than PostgreSQL's ` +
        `${MAX_DB_NAME}-byte identifier limit; shorten E2E_RUN_SUFFIX or E2E_RUN_ID`,
    );
  }
  return name;
}

export function isE2eDatabaseName(name) {
  if (typeof name !== "string" || name.length > MAX_DB_NAME) return false;
  const prefix = `${E2E_DB_PREFIX}_`;
  if (!name.startsWith(prefix)) return false;
  return isValidRunToken(name.slice(prefix.length));
}

/** A database the harness is allowed to manage at all (either namespace). */
export function isManagedDatabaseName(name) {
  return isTestDatabaseName(name) || isE2eDatabaseName(name);
}

/**
 * Exact ownership for the browser gate: the name must equal the one this run derived.
 * `remo_e2e_1000_abcd` is a valid gate name, but it is not this run's when the run derived
 * `remo_e2e_2000_ef01`. This is a name check only; deletion also requires the marker.
 */
export function isRunOwnedE2eDatabase(name, expected) {
  return isE2eDatabaseName(expected) && name === expected;
}

/**
 * The comment stored on a database when a run creates it. The environment instance is
 * part of the marker, so a database created by another test server is never "ours" even
 * if its run token happens to match.
 */
export function ownershipMarker(identity, token) {
  return `remo-owner:${identity.name}:${identity.instanceId}:${token}`;
}

/**
 * Only a marker naming this exact environment instance and run establishes ownership. A
 * missing marker (a database from before markers, or one made by hand), another server's
 * instance, and another run's marker all mean "not ours".
 */
export function isOwnedBy(marker, identity, token) {
  return typeof marker === "string" && marker === ownershipMarker(identity, token);
}
