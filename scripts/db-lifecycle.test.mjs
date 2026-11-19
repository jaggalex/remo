/**
 * The shared create/drop rules, exercised against an in-memory stand-in for pg.
 *
 * This is the regression test for "no automated process may delete a database unless
 * ownership by the current run is established": every deletion path goes through
 * `dropOwnedDatabase` / `ensureOwnedDatabase`, both require the installed environment
 * instance in the marker, and both coordinate replacement with an advisory lock.
 */
import { describe, expect, it } from "vitest";
import {
  DatabaseMarkerError,
  DatabaseOwnershipError,
  dropOwnedDatabase,
  ensureOwnedDatabase,
} from "./db-lifecycle.mjs";
import { ownershipMarker } from "./db-identifiers.mjs";

const ENV = {
  name: "remo-test",
  namespace: "remo_test",
  instanceId: "11111111-1111-4111-8111-111111111111",
};

/** Just enough of a pg client: locks, existence, comment, create, drop. */
function fakeClient(initial = {}, { failComment = false } = {}) {
  const databases = new Map(Object.entries(initial));
  const locks = [];
  return {
    databases,
    locks,
    async query(sql, params = []) {
      if (sql === "select pg_advisory_lock(hashtext($1))") {
        locks.push(params[0]);
        return { rows: [] };
      }
      if (sql === "select pg_advisory_unlock(hashtext($1))") {
        locks.push(`unlock:${params[0]}`);
        return { rows: [] };
      }
      if (sql.startsWith("select 1 from pg_database")) {
        return { rows: databases.has(params[0]) ? [{}] : [] };
      }
      if (sql.startsWith("select shobj_description")) {
        return { rows: [{ marker: databases.get(params[0]) ?? null }] };
      }
      let match = sql.match(/^create database "([^"]+)"$/);
      if (match) {
        if (databases.has(match[1])) throw new Error("database already exists");
        databases.set(match[1], null);
        return { rows: [] };
      }
      match = sql.match(/^comment on database "([^"]+)" is '([^']*)'$/);
      if (match) {
        if (failComment) throw new Error("permission denied for comment");
        if (!databases.has(match[1])) throw new Error("database does not exist");
        databases.set(match[1], match[2]);
        return { rows: [] };
      }
      match = sql.match(/^drop database if exists "([^"]+)"$/);
      if (match) {
        databases.delete(match[1]);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

describe("database lifecycle ownership", () => {
  it("creates with this environment instance's marker", async () => {
    const client = fakeClient();
    await expect(
      ensureOwnedDatabase(client, {
        name: "remo_test_run_a",
        token: "run_a",
        identity: ENV,
      }),
    ).resolves.toBe("created");
    expect(client.databases.get("remo_test_run_a")).toBe(ownershipMarker(ENV, "run_a"));
    expect(client.locks).toEqual(["remo-test:remo_test_run_a", "unlock:remo-test:remo_test_run_a"]);
  });

  it("refuses to reset a database with a foreign marker", async () => {
    const client = fakeClient({
      remo_test_run_a: ownershipMarker(ENV, "run_other"),
    });
    await expect(
      ensureOwnedDatabase(client, {
        name: "remo_test_run_a",
        token: "run_a",
        identity: ENV,
        reset: true,
      }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
    // The concurrent run's database is still there.
    expect(client.databases.get("remo_test_run_a")).toBe(ownershipMarker(ENV, "run_other"));
  });

  it("refuses another environment instance's database even with the same run token", async () => {
    const other = { ...ENV, instanceId: "22222222-2222-4222-8222-222222222222" };
    const client = fakeClient({ remo_test_run_a: ownershipMarker(other, "run_a") });
    await expect(
      dropOwnedDatabase(client, { name: "remo_test_run_a", token: "run_a", identity: ENV }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
    expect(client.databases.has("remo_test_run_a")).toBe(true);
  });

  it("refuses to drop a database with no marker", async () => {
    const client = fakeClient({ remo_test_unknown: null });
    await expect(
      dropOwnedDatabase(client, { name: "remo_test_unknown", token: "run_a", identity: ENV }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
    expect(client.databases.has("remo_test_unknown")).toBe(true);
  });

  it("drops only its own database", async () => {
    const client = fakeClient({
      remo_test_run_a: ownershipMarker(ENV, "run_a"),
      remo_test_run_b: ownershipMarker(ENV, "run_b"),
    });
    await expect(
      dropOwnedDatabase(client, { name: "remo_test_run_a", token: "run_a", identity: ENV }),
    ).resolves.toBe(true);
    expect(client.databases.has("remo_test_run_a")).toBe(false);
    expect(client.databases.has("remo_test_run_b")).toBe(true);
  });

  it("treats a missing database as a no-op", async () => {
    const client = fakeClient();
    await expect(
      dropOwnedDatabase(client, { name: "remo_test_run_a", token: "run_a", identity: ENV }),
    ).resolves.toBe(false);
  });

  it("resets only a database it already owns", async () => {
    const client = fakeClient({ remo_test_e2e_run_a: ownershipMarker(ENV, "run_a") });
    await expect(
      ensureOwnedDatabase(client, {
        name: "remo_test_e2e_run_a",
        token: "run_a",
        identity: ENV,
        reset: true,
      }),
    ).resolves.toBe("reset");
    expect(client.databases.get("remo_test_e2e_run_a")).toBe(ownershipMarker(ENV, "run_a"));
  });

  it("preserves the new database and reports explicitly when the marker write fails", async () => {
    const client = fakeClient({}, { failComment: true });
    const error = await ensureOwnedDatabase(client, {
      name: "remo_test_run_a",
      token: "run_a",
      identity: ENV,
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(DatabaseMarkerError);
    expect(error.message).toMatch(
      /created remo_test_run_a.*preserved.*not be dropped automatically/,
    );
    // The unmarked database is still there: a failed marker write is not permission to drop.
    expect(client.databases.has("remo_test_run_a")).toBe(true);
    expect(client.locks.at(-1)).toBe("unlock:remo-test:remo_test_run_a");
  });

  it("refuses names outside the managed namespace", async () => {
    const client = fakeClient({ remo: ownershipMarker(ENV, "run_a") });
    await expect(
      dropOwnedDatabase(client, { name: "remo", token: "run_a", identity: ENV }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
    await expect(
      ensureOwnedDatabase(client, { name: "postgres", token: "run_a", identity: ENV }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
    expect(client.databases.has("remo")).toBe(true);
  });

  it("refuses to mutate without a verified environment identity", async () => {
    const client = fakeClient();
    await expect(
      ensureOwnedDatabase(client, { name: "remo_test_run_a", token: "run_a" }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
    await expect(
      dropOwnedDatabase(client, {
        name: "remo_test_run_a",
        token: "run_a",
        identity: { ...ENV, namespace: "public" },
      }),
    ).rejects.toBeInstanceOf(DatabaseOwnershipError);
  });
});
