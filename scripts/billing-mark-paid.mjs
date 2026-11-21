#!/usr/bin/env node
/**
 * Mark an invoice paid by bank transfer (ADR-247, `spec/billing.md` §4, stage 2).
 *
 *   pnpm billing:mark-paid <invoiceId> [--ref <bank reference>]
 *
 * The operator is the only source of truth for a manual payment: the command records the
 * payment, applies the credit the invoice promised, and — when the invoice sells a
 * subscription — gives the organisation that plan until the end of the period. Running
 * it twice changes nothing.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { settleInvoice } from "../apps/sync/billing-settle.mjs";
import { PostgresStore } from "../apps/sync/postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile?.(join(ROOT, ".env"));
} catch {
  /* the process environment is the source of truth */
}

const args = process.argv.slice(2);
const invoiceId = args.find((arg) => !arg.startsWith("--"));
const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : null;

if (!invoiceId) {
  console.error("usage: pnpm billing:mark-paid <invoiceId> [--ref <bank reference>]");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[billing:mark-paid] DATABASE_URL is required");
  process.exit(1);
}

const store = new PostgresStore({
  connectionString,
  migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
  log: console,
});

try {
  await store.connect();
  const invoice = await store.billingInvoiceGlobal(invoiceId);
  if (!invoice) {
    console.error(`[billing:mark-paid] no invoice ${invoiceId}`);
    process.exitCode = 1;
  } else if (invoice.status === "void") {
    console.error(`[billing:mark-paid] ${invoice.number} is void`);
    process.exitCode = 1;
  } else if (invoice.status === "paid") {
    console.log(`[billing:mark-paid] ${invoice.number} is already paid`);
  } else {
    // The fake provider's page settles through the same function, so a browser test and
    // an operator command cannot disagree about what "paid" means.
    const settled = await settleInvoice({
      store,
      invoice,
      providerPaymentId: ref ? `manual:${ref}` : `manual:${invoice.id}`,
    });

    console.log(
      `[billing:mark-paid] ${invoice.number} paid: ${invoice.total} ${invoice.currency}` +
        (settled.subscription ? ` → ${settled.subscription.plan}` : ""),
    );
  }
} finally {
  await store.close().catch(() => {});
}
