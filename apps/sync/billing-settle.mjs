/**
 * What a confirmed payment does to an invoice (ADR-247 §3.3, `spec/billing.md` §4).
 *
 * Two callers confirm money: the operator command `pnpm billing:mark-paid` for a bank
 * transfer, and the development fake provider's page. Both must write the same ledger
 * rows: spend the credit the invoice promised, mark the invoice paid with a payment row,
 * and grant the plan the subscription line sells. Keeping that sequence in one function
 * is what keeps the fake path honest — it cannot grow a second interpretation of "paid".
 *
 * The caller passes the invoice as stored (`billingInvoiceGlobal`), because both entry
 * points start from an id that has no tenant in its URL.
 */
import { PLANS } from "./billing-catalog.mjs";

/** `lines` is JSON; checkout wrote the autopay consent into the subscription line. */
export function consentVersionOf(lines) {
  const list = Array.isArray(lines) ? lines : [];
  for (const line of list) {
    const version = line?.autopayConsent?.version;
    if (typeof version === "string" && version.trim() !== "") return version;
  }
  return null;
}

/**
 * Apply a confirmed payment. Idempotent through `markInvoicePaid`'s derived payment key
 * and the invoice status, so a repeated fake click or a rerun of the operator command
 * changes nothing twice.
 *
 * @returns the settling facts: the invoice, the payment row and the subscription line.
 */
export async function settleInvoice({
  store,
  invoice,
  connectionId = null,
  providerPaymentId = null,
}) {
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const subscription = lines.find((line) => line?.kind === "subscription");

  return store.withTenant(invoice.org_id, async () => {
    // The credit was promised on the invoice; this is the moment it is spent.
    const creditApplied = Number(invoice.credit_applied);
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

    const paid = await store.markInvoicePaid({
      invoiceId: invoice.id,
      amount: Number(invoice.total),
      currency: invoice.currency,
      connectionId,
      providerPaymentId,
    });

    if (subscription) {
      await store.upsertOperatorPlan({
        orgId: invoice.org_id,
        plan: subscription.plan,
        priceId: subscription.priceId,
        amount: Number(invoice.subtotal),
        currency: invoice.currency,
        interval: subscription.interval ?? "month",
        until: invoice.period_end ?? new Date(Date.now() + 30 * 86400000),
      });
      const plan = PLANS[subscription.plan];
      await store.reconcileFrozenRooms(invoice.org_id, plan?.rooms ?? null);
    }

    return { invoice: paid.invoice, payment: paid.payment, subscription };
  });
}
