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
import { PLANS } from "../apps/sync/billing-catalog.mjs";
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
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const subscription = lines.find((line) => line?.kind === "subscription");

    await store.withTenant(invoice.org_id, async () => {
      // The credit was promised on the invoice; this is the moment it is spent.
      const creditApplied = Number(invoice.credit_applied);
      const total = Number(invoice.total);
      const subtotal = Number(invoice.subtotal);
      if (creditApplied > 0) {
        const balance = Number(await store.creditBalance(invoice.org_id, invoice.currency));
        const applied = Math.min(balance, creditApplied);
        if (applied > 0) {
          await store.applyCredit({
            orgId: invoice.org_id,
            currency: invoice.currency,
            amount: applied,
            invoiceId: invoice.id,
          });
        }
      }
      await store.markInvoicePaid({
        invoiceId: invoice.id,
        amount: total,
        currency: invoice.currency,
        providerPaymentId: ref ? `manual:${ref}` : `manual:${invoice.id}`,
      });
      if (subscription) {
        await store.upsertOperatorPlan({
          orgId: invoice.org_id,
          plan: subscription.plan,
          priceId: subscription.priceId,
          amount: subtotal,
          currency: invoice.currency,
          interval: subscription.interval ?? "month",
          until: invoice.period_end ?? new Date(Date.now() + 30 * 86400000),
        });
        const plan = PLANS[subscription.plan];
        await store.reconcileFrozenRooms(invoice.org_id, plan?.rooms ?? null);
      }
    });

    console.log(
      `[billing:mark-paid] ${invoice.number} paid: ${invoice.total} ${invoice.currency}` +
        (subscription ? ` → ${subscription.plan}` : ""),
    );
  }
} finally {
  await store.close().catch(() => {});
}
