import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  it("matches the version declared in schema.sql", async () => {
    const { SCHEMA_VERSION } = await import("./schema-version.mjs");
    const declared = /insert into schema_meta \(id, version\) values \(1, (\d+)\)/i.exec(sql);
    expect(declared?.[1]).toBe(String(SCHEMA_VERSION));
  });
});
