/**
 * The one lifecycle for databases the harness creates and drops.
 *
 * Unit-test runs and browser-gate runs use the same rules: a managed database is created
 * with a run-scoped ownership marker that includes the installed test-environment
 * instance, an existing database is dropped only when that marker names this exact run,
 * and a drop is always a plain `drop database`. A name, a host, a port or a local pid is
 * never proof of ownership.
 *
 * PostgreSQL assumptions:
 * - creating a database requires `CREATEDB` (the dedicated `remo_test` role and the CI
 *   service role have it); the creator owns the database and may comment on it;
 * - `drop database` requires that no other session is connected. We never use
 *   `WITH (FORCE)`: a busy database is left in place instead of terminating sessions that
 *   may belong to another run;
 * - the marker lives in `pg_shdescription` (`shobj_description(oid, 'pg_database')`), so
 *   it is readable before connecting to the database itself;
 * - create/reset/drop hold a session advisory lock keyed by the database name. The lock
 *   serialises replacement attempts; it is never used as proof of ownership and a crashed
 *   session releases it automatically.
 * - a marker-write failure after CREATE preserves the new database and throws an explicit
 *   error: without the marker there is no proof that would justify deletion.
 */
import { isManagedDatabaseName, isOwnedBy, ownershipMarker } from "./db-identifiers.mjs";

/** A database exists but nothing proves it belongs to this run. Never deleted. */
export class DatabaseOwnershipError extends Error {}

/** The database was created but its ownership marker could not be written. Preserved. */
export class DatabaseMarkerError extends DatabaseOwnershipError {}

export async function databaseExists(client, name) {
  const { rows } = await client.query("select 1 from pg_database where datname = $1", [name]);
  return rows.length > 0;
}

export async function databaseMarker(client, name) {
  const { rows } = await client.query(
    "select shobj_description(oid, 'pg_database') as marker from pg_database where datname = $1",
    [name],
  );
  return rows[0]?.marker ?? null;
}

/**
 * Serialise lifecycle operations for one database name. The lock is advisory and
 * session-scoped; releasing is best-effort because closing the session releases it too.
 */
export async function withAdvisoryLock(client, key, work) {
  const lockKey = `remo-test:${key}`;
  await client.query("select pg_advisory_lock(hashtext($1))", [lockKey]);
  try {
    return await work();
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext($1))", [lockKey])
      .catch(() => {});
  }
}

function assertManagedName(name) {
  if (!isManagedDatabaseName(name)) {
    throw new DatabaseOwnershipError(
      `[db] refusing to manage ${JSON.stringify(name)}: outside the test namespace ` +
        `remo_test_`,
    );
  }
}

function assertIdentity(identity) {
  if (
    !identity?.name ||
    !identity?.namespace ||
    !identity?.instanceId ||
    identity.namespace !== "remo_test"
  ) {
    throw new DatabaseOwnershipError(
      "[db] refusing to create or drop a database without a verified test-environment identity",
    );
  }
}

/**
 * Write the ownership marker. A failure is reported and the database is preserved: the
 * marker is the only proof that would justify deletion, so a failed marker write must not
 * become an unconditional drop.
 */
async function markOwned(client, name, expected) {
  try {
    await client.query(`comment on database "${name}" is '${expected}'`);
  } catch (cause) {
    throw new DatabaseMarkerError(
      `[db] created ${name} but could not write its ownership marker ` +
        `(${cause.message ?? cause.code}). The database has been preserved and requires ` +
        "manual inspection; it will not be dropped automatically.",
      { cause },
    );
  }
}

/**
 * Create this run's database, or reset one that already carries this run's marker.
 *
 * `reset: true` is what the E2E gate needs on every start (an accumulated database caused
 * duplicate widget ids). Reset is safe only when the marker proves the previous creator was
 * this same environment instance and run. Any other existing database throws and is
 * preserved.
 *
 * Returns "created" or "reset".
 */
export async function ensureOwnedDatabase(client, { name, token, identity, reset = false }) {
  assertManagedName(name);
  assertIdentity(identity);
  const expected = ownershipMarker(identity, token);

  return withAdvisoryLock(client, name, async () => {
    if (await databaseExists(client, name)) {
      const current = await databaseMarker(client, name);
      if (!isOwnedBy(current, identity, token)) {
        throw new DatabaseOwnershipError(
          `[db] ${name} already exists with marker ${JSON.stringify(current)}; ` +
            `this run owns ${JSON.stringify(expected)}. Refusing to drop it.`,
        );
      }
      if (!reset) return "kept";
      // Our marker: this is the same environment instance and run (a retry or reset).
      await client.query(`drop database if exists "${name}"`);
      await client.query(`create database "${name}"`);
      await markOwned(client, name, expected);
      return "reset";
    }

    await client.query(`create database "${name}"`);
    await markOwned(client, name, expected);
    return "created";
  });
}

/**
 * Drop only a database whose marker names this environment instance and run. Unknown
 * ownership throws; a missing database is a no-op. Plain `drop database` — a connected
 * session makes it fail closed.
 */
export async function dropOwnedDatabase(client, { name, token, identity }) {
  assertManagedName(name);
  assertIdentity(identity);
  return withAdvisoryLock(client, name, async () => {
    if (!(await databaseExists(client, name))) return false;
    const current = await databaseMarker(client, name);
    if (!isOwnedBy(current, identity, token)) {
      throw new DatabaseOwnershipError(
        `[db] refusing to drop ${name}: marker ${JSON.stringify(current)} is not ` +
          `${JSON.stringify(ownershipMarker(identity, token))}.`,
      );
    }
    await client.query(`drop database if exists "${name}"`);
    return true;
  });
}
