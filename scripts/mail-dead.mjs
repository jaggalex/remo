#!/usr/bin/env node
/**
 * Inspect the dead-letter side of the mail outbox (ADR-246).
 *
 *   pnpm mail:dead                # recent dead rows
 *   pnpm mail:dead --retry <id>   # put one back in the queue
 *
 * A dead row has had its sealed link parameters cleared, because the link was either
 * expired or the provider refused the message. `--retry` therefore works only for a row
 * whose link survived (an older release) or for a template that carries no link at all,
 * such as `password_changed`. Otherwise ask the person for a new request instead of
 * resurrecting a secret that was deliberately removed.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile?.(join(ROOT, ".env"));
} catch {
  /* the process environment is the source of truth */
}

const args = process.argv.slice(2);
const retryRequested = args.includes("--retry");
const retryId = retryRequested ? args[args.indexOf("--retry") + 1] : null;
const connectionString = process.env.DATABASE_URL;

if (retryRequested && !retryId) {
  console.error("usage: pnpm mail:dead [--retry <id>]");
  process.exit(1);
}

if (!connectionString) {
  console.error("[mail:dead] DATABASE_URL is required");
  process.exit(1);
}

const store = new PostgresStore({
  connectionString,
  migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
  log: console,
});

try {
  await store.connect();

  if (retryId) {
    const retried = await store.retryDeadMail(retryId);
    if (retried) {
      console.log(`[mail:dead] ${retryId} is queued again; the drain will pick it up`);
    } else {
      console.error(
        `[mail:dead] ${retryId} cannot be retried: it is unknown or its link was cleared. Ask for a new request.`,
      );
      process.exitCode = 1;
    }
  } else {
    const rows = await store.listDeadMail(50);
    if (!rows.length) {
      console.log("[mail:dead] no dead mail");
    }
    for (const row of rows) {
      const when = new Date(row.dead_at).toISOString();
      console.log(
        `${when}  ${row.id}  ${row.template}  ${row.last_error ?? "?"}  attempts=${row.attempts}`,
      );
    }
  }
} finally {
  await store.close().catch(() => {});
}
