import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PostgresStore } from "./postgres.mjs";
import { SCHEMA_VERSION } from "./schema-version.mjs";

/**
 * A fresh database is part of the acceptance (ADR-089).
 *
 * The sync service applies `schema.sql` on every start. On a database created by an
 * older release, an `alter table` before its `create table` is harmless because the
 * table already exists; on an empty volume the same file fails halfway, which is how a
 * new install silently fell back to disk. This test is the cheap invariant that keeps
 * the two audiences honest.
 */
const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const withoutComments = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("schema migrations", () => {
  it("never alters a table before creating it", () => {
    const created = new Map();
    const problems = [];
    withoutComments.split("\n").forEach((line, index) => {
      const create = /create table(?:\s+if not exists)?\s+([a-z_][a-z0-9_]*)/i.exec(line);
      if (create) created.set(create[1].toLowerCase(), index + 1);
      const alter = /alter table\s+([a-z_][a-z0-9_]*)/i.exec(line);
      if (alter) {
        const table = alter[1].toLowerCase();
        if (!created.has(table)) {
          problems.push(`line ${index + 1}: alter table ${table} but it is never created`);
        }
      }
    });
    expect(problems).toEqual([]);
  });

  it("declares every table an alter touches", () => {
    const alters = new Set(
      [...withoutComments.matchAll(/alter table\s+([a-z_][a-z0-9_]*)/gi)].map((match) =>
        match[1].toLowerCase(),
      ),
    );
    const creates = new Set(
      [...withoutComments.matchAll(/create table(?:\s+if not exists)?\s+([a-z_][a-z0-9_]*)/gi)].map(
        (match) => match[1].toLowerCase(),
      ),
    );
    expect([...alters].filter((table) => !creates.has(table))).toEqual([]);
  });

  it("is idempotent by construction: every table creation is guarded", () => {
    const unguarded = [...withoutComments.matchAll(/create table\s+(?!if not exists)([a-z_]+)/gi)].map(
      (match) => match[1],
    );
    expect(unguarded).toEqual([]);
  });
});

describe("schema version", () => {
  it("matches the version declared in schema.sql", () => {
    const declared = /insert into schema_meta \(id, version\) values \(1, (\d+)\)/i.exec(sql);
    expect(declared?.[1]).toBe(String(SCHEMA_VERSION));
  });

  it("scopes the idempotency indexes to the board", () => {
    expect(sql).toContain("agent_tasks_board_idempotency_idx");
    expect(sql).toContain("agent_change_sets_board_idempotency_idx");
    expect(sql).toContain("drop index if exists agent_tasks_idempotency_idx");
    expect(sql).toContain("drop index if exists agent_change_sets_idempotency_idx");
  });
});

/** A client that answers the migration gate without touching a database. */
function migrationClient(version) {
  const queries = [];
  return {
    queries,
    async query(text) {
      const statement = String(text);
      queries.push(statement);
      if (statement.startsWith("select version from schema_meta")) {
        return { rows: [{ version }] };
      }
      return { rows: [] };
    },
    release() {},
  };
}

async function migrateAt(version) {
  const client = migrationClient(version);
  const store = Object.create(PostgresStore.prototype);
  store.pool = { connect: async () => client };
  store.log = { log() {}, error() {} };
  await store.migrate();
  return client.queries;
}

describe("schema migration gate", () => {
  it("applies schema.sql to a database older than the current version", async () => {
    // The v13 bug: changing an index in schema.sql without bumping the version made
    // migrate() skip the file, leaving the old index in place.
    const queries = await migrateAt(SCHEMA_VERSION - 1);
    expect(queries.some((text) => text.includes("create table if not exists boards"))).toBe(true);
  });

  it("skips schema.sql when the database is current", async () => {
    const queries = await migrateAt(SCHEMA_VERSION);
    expect(queries.some((text) => text.includes("create table if not exists boards"))).toBe(false);
  });
});
