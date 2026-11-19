#!/usr/bin/env node
/**
 * Apply or verify the stage-2 RLS pilot (ADR-178).
 *
 *   pnpm db:rls:enable
 *   pnpm db:rls:enable --check
 *
 * Run as the owner. The application role must already exist (`pnpm db:rls:setup`) and
 * the service must connect as it; `FORCE` does not exempt the table owner.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyRls, inspectRls } from "../apps/sync/rls-admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes("--check");

function databaseUrl() {
  if (process.env.REMO_MIGRATION_DATABASE_URL) return process.env.REMO_MIGRATION_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(HERE, "..", ".env"), "utf8");
    const match = env.match(/^(?:REMO_MIGRATION_)?DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env — fall through to the compose defaults */
  }
  return "postgres://remo:remo@localhost:5432/remo";
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5000 });

try {
  await client.connect();

  // The helper functions are SECURITY DEFINER and owned by this role. Under FORCE they
  // bypass RLS only if the owner is a superuser or has BYPASSRLS.
  const { rows: me } = await client.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
  );
  const ownerBypasses = Boolean(me[0]?.rolsuper || me[0]?.rolbypassrls);
  if (!ownerBypasses) {
    const message =
      "[rls] the owner/migration role cannot bypass RLS; the security-definer lookups will return no rows";
    if (CHECK) {
      console.error(message);
      process.exitCode = 1;
    } else {
      console.warn(`${message}; use a BYPASSRLS migration role`);
    }
  }

  if (CHECK) {
    const { rows, missing, unprotected } = await inspectRls(client);
    for (const row of rows) {
      console.log(
        `${row.relname}: rls=${row.rls ? "on" : "off"} forced=${row.forced ? "yes" : "no"} ` +
          `policy=${row.policy ? "yes" : "no"}`,
      );
    }
    if (missing.length) console.log(`missing tables: ${missing.join(", ")}`);
    if (unprotected.length || missing.length) {
      console.error(`[rls] ${unprotected.length + missing.length} tenant table(s) are not protected`);
      process.exitCode = 1;
    } else {
      console.log(`[rls] ${rows.length} tenant table(s) protected`);
    }
  } else {
    const count = await applyRls(client);
    console.log(`[rls] policies applied to ${count} table(s)`);
    console.log("[rls] connect the service as remo_app and keep migrations on the owner URL");
  }
} catch (error) {
  console.error(`[rls] ${CHECK ? "check" : "apply"} failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
