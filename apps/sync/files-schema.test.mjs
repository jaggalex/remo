import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RLS_TABLES } from "./rls-admin.mjs";
import { SCHEMA_VERSION } from "./schema-version.mjs";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const rls = readFileSync(new URL("./rls.sql", import.meta.url), "utf8");

describe("schema 25: the files table and its organisation lookup", () => {
  it("declares the files table from spec/images.md §3.1", () => {
    const ddl = /create table if not exists files \(([\s\S]*?)\n\);/.exec(schema)?.[1] ?? "";
    expect(ddl).not.toBe("");

    expect(ddl).toContain("id uuid primary key default gen_random_uuid()");
    expect(ddl).toContain("org_id uuid not null references orgs (id) on delete cascade");
    expect(ddl).toContain("board_id text references boards (id) on delete set null");
    expect(ddl).toContain("uploaded_by uuid references users (id) on delete set null");
    expect(ddl).toContain("sha256 text not null");
    expect(ddl).toContain(
      "check (mime in ('image/png','image/jpeg','image/webp','image/gif','image/avif'))",
    );
    expect(ddl).toContain("stored_bytes bigint not null");
    expect(ddl).toContain("variants jsonb not null");
    expect(ddl).toContain("unreferenced_since timestamptz");
    expect(ddl).toContain("check (status in ('ready', 'deleted'))");
  });

  it("has the two partial indexes and the schema version", () => {
    expect(schema).toContain(
      "create index if not exists files_org_idx on files (org_id) where status = 'ready'",
    );
    expect(schema).toContain(
      "create unique index if not exists files_org_sha_idx on files (org_id, sha256) where status = 'ready'",
    );
    expect(schema).toContain("insert into schema_meta (id, version) values (1, 27)");
    expect(SCHEMA_VERSION).toBe(27);
  });

  it("answers a file's organisation through a definer lookup after the table", () => {
    const lookup =
      /create or replace function remo_file_org\(file_id uuid\)([\s\S]*?)\$\$;/.exec(schema)?.[1] ??
      "";
    // `security definer` is what survives `FORCE ROW LEVEL SECURITY`; `search_path` is
    // pinned so the function cannot be pointed at another schema.
    expect(lookup).toContain("security definer");
    expect(lookup).toContain("set search_path = public");
    expect(lookup).toContain("from files where id = file_id and status = 'ready'");
    expect(schema).toContain("grant execute on function remo_file_org(uuid) to remo_app");
    // `language sql` bodies are checked at creation, so the table must come first.
    expect(schema.indexOf("create or replace function remo_file_org")).toBeGreaterThan(
      schema.indexOf("create table if not exists files"),
    );
  });

  it("is a tenant table in both RLS lists", () => {
    expect(RLS_TABLES).toContain("files");

    const tenantArray = /foreach t in array array\[([\s\S]*?)\] loop/.exec(rls)?.[1] ?? "";
    expect(tenantArray).toContain("'files'");
  });
});
