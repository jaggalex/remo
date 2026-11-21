/**
 * The development payment page's server side (ADR-248 §7, `spec/payment-providers.md` §7
 * `pay-fake`).
 *
 * Two routes, both only under the fake-provider gate (`NODE_ENV !== "production"` and
 * `REMO_PAY_FAKE=1`); outside it the whole family is a `404`, exactly like the disabled
 * billing family:
 *
 *   GET  /billing/fake/payment/:paymentId  — the amount and status the page shows
 *   POST /billing/fake/complete            — `{ paymentId, outcome }`, the two buttons
 *
 * Completion goes through the same ledger path as an operator's `billing:mark-paid`:
 * `settleInvoice` (credit, invoice, payment, plan) and, when checkout asked for autopay,
 * `savePaymentMethod` with the one fake card. Repeating a completion is a no-op because
 * the attempt is recorded in the provider inbox under `fake:complete:<payment>:<outcome>`
 * and `recordProviderEvent` reports whether the row is new.
 *
 * A payment whose connection is not `fake` is refused: this route must never be a way to
 * mark a real YooKassa invoice paid from a browser page.
 */
import { FAKE_CARD, completeFakePayment, fakeAdapter, fakeProviderEnabled } from "./pay-fake.mjs";
import { consentVersionOf, settleInvoice } from "./billing-settle.mjs";
import { readJsonBody } from "./http-body.mjs";
import { fail, json, sessionFromRequest } from "./iam-http.mjs";

const PAYMENT_ROUTE = /^\/billing\/fake\/payment\/([^/]+)$/;

async function adminOr403(store, orgId, userId, response) {
  if (await store.hasOrgRole(orgId, userId, "org_admin")) return true;
  fail(response, 403, "FORBIDDEN", "only the owner or an organisation admin can pay");
  return false;
}

/** The fake connection behind a payment; anything else is not ours to settle. */
async function fakeConnectionFor(store, chain, response) {
  const connection = await store.connectionById?.(chain.connection_id);
  if (!connection || connection.provider !== "fake") {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return null;
  }
  return connection;
}

async function showPayment({ request, response, store, paymentId }) {
  const session = await sessionFromRequest(request, store);
  if (!session) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return true;
  }
  const chain = await store.paymentChainFor(paymentId);
  if (!chain) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such payment"), true;

  const membership = await store.getOrgMembership(chain.org_id, session.user.id);
  if (!membership || membership.state !== "active") {
    return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
  }
  if (!(await store.hasOrgRole(chain.org_id, session.user.id, "org_admin"))) {
    return fail(response, 403, "FORBIDDEN", "only the owner or an organisation admin can pay"), true;
  }
  const connection = await fakeConnectionFor(store, chain, response);
  if (!connection) return true;

  const invoice = await store.billingInvoiceGlobal?.(chain.invoice_id);
  const providerPaymentId = `fake:${paymentId}`;
  const memory = await fakeAdapter.getPayment(connection, providerPaymentId);
  // A paid invoice is the durable fact; otherwise the process's own choice is the latest.
  const status = invoice?.status === "paid" ? "succeeded" : memory.status;

  json(response, 200, {
    paymentId,
    invoiceId: chain.invoice_id,
    status,
    amount: Number(invoice?.total ?? chain.payment_amount ?? 0),
    currency: invoice?.currency ?? chain.payment_currency ?? "RUB",
    saveMethod: Boolean(consentVersionOf(invoice?.lines)),
  });
  return true;
}

async function completePayment({ request, response, store, log }) {
  const body = await readJsonBody(request);
  const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
  const outcome = body?.outcome;
  if (!paymentId || (outcome !== "success" && outcome !== "fail")) {
    return fail(response, 422, "BAD_FAKE_PAYMENT", "expected { paymentId, outcome: success|fail }"), true;
  }

  const session = await sessionFromRequest(request, store);
  if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;

  const chain = await store.paymentChainFor(paymentId);
  if (!chain) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such payment"), true;

  const membership = await store.getOrgMembership(chain.org_id, session.user.id);
  if (!membership || membership.state !== "active") {
    return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
  }
  if (!(await adminOr403(store, chain.org_id, session.user.id, response))) return true;

  const connection = await fakeConnectionFor(store, chain, response);
  if (!connection) return true;

  const invoice = await store.billingInvoiceGlobal(chain.invoice_id);
  if (!invoice) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such invoice"), true;
  // A paid invoice is the durable terminal state: a second visit cannot decline it.
  if (invoice.status === "paid") {
    return json(response, 200, { ok: true, status: "succeeded", idempotent: true }), true;
  }

  const providerPaymentId = `fake:${paymentId}`;
  const status = outcome === "success" ? "succeeded" : "failed";

  // The inbox is the idempotency record: a repeated click is acknowledged, not applied
  // twice. A different outcome is a genuinely different attempt and is allowed.
  const recorded = await store.recordProviderEvent({
    connectionId: connection.id,
    providerEventKey: `fake:complete:${paymentId}:${outcome}`,
    type: "payment.updated",
    orgId: chain.org_id,
    payload: { paymentId, outcome },
  });
  if (recorded !== true) {
    return json(response, 200, { ok: true, status, idempotent: true }), true;
  }

  completeFakePayment(providerPaymentId, outcome);

  if (outcome === "fail") {
    await store.recordPayment({
      orgId: chain.org_id,
      invoiceId: chain.invoice_id,
      connectionId: connection.id,
      providerPaymentId,
      idempotencyKey: `fake:${paymentId}:failed`,
      amount: Number(chain.payment_amount),
      currency: chain.payment_currency,
      status: "failed",
      failureCode: "card_declined",
    });
    return json(response, 200, { ok: true, status: "failed" }), true;
  }

  await settleInvoice({
    store,
    invoice,
    connectionId: connection.id,
    providerPaymentId,
  });

  // Checkout wrote the consent into the subscription line only when autopay was asked
  // for and the adapter can save a method; its presence is the permission to save.
  const consentVersion = consentVersionOf(invoice.lines);
  if (consentVersion) {
    try {
      await store.savePaymentMethod({
        orgId: chain.org_id,
        connectionId: connection.id,
        ref: FAKE_CARD.methodRef,
        display: { ...FAKE_CARD.display },
        consentVersion,
      });
    } catch (error) {
      // The money is already recorded; a missing KEK must not reopen the invoice. The
      // screen simply will not show a saved card, which is the honest state.
      log.error?.(`[billing] fake ${paymentId}: the card was not saved (${error?.code ?? "ERROR"})`);
    }
  }

  json(response, 200, {
    ok: true,
    status: "succeeded",
    invoiceId: invoice.id,
    paymentId,
  });
  return true;
}

/**
 * @returns {Promise<boolean>} true when the request belonged to the fake surface.
 */
export async function handleFakeBilling({
  request,
  response,
  url,
  store,
  env = process.env,
  log = console,
}) {
  if (!url.pathname.startsWith("/billing/fake/")) return false;

  // No flag, or production: the feature is absent, not "disabled with a form".
  if (!fakeProviderEnabled(env)) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }

  if (
    !store ||
    typeof store.paymentChainFor !== "function" ||
    typeof store.billingInvoiceGlobal !== "function" ||
    typeof store.recordProviderEvent !== "function"
  ) {
    fail(response, 501, "BILLING_UNAVAILABLE", "the fake provider needs the postgres store");
    return true;
  }

  const method = request.method ?? "GET";

  if (url.pathname === "/billing/fake/complete") {
    if (method !== "POST") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "use POST");
      return true;
    }
    return completePayment({ request, response, store, log });
  }

  const match = PAYMENT_ROUTE.exec(url.pathname);
  if (match) {
    if (method !== "GET") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "use GET");
      return true;
    }
    let paymentId;
    try {
      paymentId = decodeURIComponent(match[1]);
    } catch {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    return showPayment({ request, response, store, paymentId });
  }

  fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
  return true;
}
