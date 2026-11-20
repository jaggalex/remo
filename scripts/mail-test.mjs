#!/usr/bin/env node
/**
 * Send one transactional message through the configured driver (ADR-246).
 *
 *   pnpm mail:test --to person@example.com
 *
 * The message enters the real outbox and is drained at once, so a green run proves the
 * driver, the KEK seal, the template and the recording of the outcome — not merely that
 * SMTP accepted a socket.
 */
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import {
  assertMailConfig,
  enqueueMail,
  mailAddress,
  mailDriver,
  resolveMailConfig,
} from "../apps/sync/mail.mjs";
import { createMailDrain } from "../apps/sync/mail-drain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile?.(join(ROOT, ".env"));
} catch {
  /* the process environment is the source of truth */
}

const args = process.argv.slice(2);
const to = args.includes("--to") ? mailAddress(args[args.indexOf("--to") + 1]) : null;

if (!to) {
  console.error("usage: pnpm mail:test --to <address>");
  process.exit(1);
}

const config = assertMailConfig(resolveMailConfig());
if (config.driver === "disabled") {
  console.error("[mail:test] mail is disabled; set REMO_MAIL_DRIVER and its variables");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[mail:test] DATABASE_URL is required: mail lives in the database outbox");
  process.exit(1);
}

const store = new PostgresStore({
  connectionString,
  migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
  log: console,
});

try {
  await store.connect();
  const token = randomBytes(8).toString("hex");
  const queued = await enqueueMail(
    store,
    {
      toEmail: to,
      template: "password_reset",
      locale: "en",
      params: { name: "mail test" },
      linkParams: { link: `${config.appOrigin}/?reset=mail-test-${token}` },
      validUntil: new Date(Date.now() + 10 * 60 * 1000),
    },
    { config },
  );

  const drain = createMailDrain({ store, driver: mailDriver(config), config, log: console });
  await drain.drain({ onlyId: queued.id });

  const { rows } = await store.pool.query(
    "select sent_at, dead_at, last_error from mail_outbox where id = $1",
    [queued.id],
  );
  const row = rows[0] ?? {};
  if (row.sent_at) {
    console.log(`[mail:test] sent ${queued.id} via ${config.driver}`);
  } else {
    console.error(`[mail:test] not sent ${queued.id}: ${row.last_error ?? "unknown error"}`);
    process.exitCode = 1;
  }
} finally {
  await store.close().catch(() => {});
}
