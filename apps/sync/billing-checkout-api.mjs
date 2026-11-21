/**
 * Checkout and invoices (ADR-247, `spec/billing.md` §3.4, §4, §6).
 *
 * Stage 2 sells by bank invoice only: the provider adapter creates a payment with
 * instructions, and an operator marks it paid with `pnpm billing:mark-paid`. The money
 * arithmetic lives in `billing-money.mjs`, the ledger in `pg/billing-money.mjs`; this
 * file only decides what to sell, to whom, and in which currency.
 */
import { paymentAdapters } from "./payment-adapters.mjs";
import { openConnectionSecret } from "./payment-connections.mjs";
import { kekFromEnv } from "./secrets.mjs";
import { periodEnd as endOfPeriod, promoDiscount, priceInvoice } from "./billing-money.mjs";
import { readJsonBody } from "./http-body.mjs";
import { fail, json, sessionFromRequest } from "./iam-http.mjs";

const CURRENCY = /^[A-Z]{3}$/;

async function memberOr404(store, request, response, orgId) {
  const session = await sessionFromRequest(request, store);
  if (!session) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return null;
  }
  const membership = await store.getOrgMembership(orgId, session.user.id);
  if (!membership || membership.state !== "active") {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return null;
  }
  return session;
}

async function canPay(store, orgId, userId, response) {
  if (await store.hasOrgRole(orgId, userId, "org_admin")) return true;
  fail(response, 403, "FORBIDDEN", "only the owner or an organisation admin can pay");
  return false;
}

/** `/billing/promo/check` — no session: the landing page quotes a code before sign-up. */
export async function checkPromo({ request, response, store }) {
  const body = await readJsonBody(request);
  if (!body?.code || !body?.priceId) {
    return fail(response, 422, "PROMO_INVALID", "code and priceId are required"), true;
  }
  if (typeof store.priceById !== "function") {
    return fail(response, 501, "BILLING_UNAVAILABLE", "billing needs the postgres store"), true;
  }
  const price = await store.priceById(String(body.priceId));
  if (!price) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such price"), true;
  const promo = await store.promoByCode(String(body.code));
  const result = promoDiscount({ promo, amount: price.amount });
  if (!result.ok) return fail(response, 422, result.code, "this code cannot be used here"), true;
  const totals = priceInvoice({ amount: price.amount, discount: result.discount });
  json(response, 200, {
    code: promo.code,
    currency: price.currency,
    discount: totals.discount,
    total: totals.total,
  });
  return true;
}

/**
 * Checkout for an organisation. A manual connection turns the request into an open
 * invoice and a pending payment; nothing is charged here, and no plan is granted until
 * the operator marks the invoice paid.
 */
async function checkout({ request, response, store, orgId }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session) return true;
  if (!(await canPay(store, orgId, session.user.id, response))) return true;

  const body = await readJsonBody(request);
  if (!body?.priceId || !body?.methodGroup) {
    return fail(response, 422, "BAD_CHECKOUT", "priceId and methodGroup are required"), true;
  }
  const consent = body.consent ?? {};
  // An invoice needs the terms, not autopay; a saved card needs both (§1 rule 8).
  if (!consent.termsVersion || typeof consent.autopay !== "boolean") {
    return fail(response, 422, "CONSENT_REQUIRED", "explicit consent is required"), true;
  }

  const org = typeof store.billingOrg === "function" ? await store.billingOrg(orgId) : null;
  if (org?.kind === "personal") {
    return fail(response, 409, "PERSONAL_ORG", "create a shared organisation to buy a plan"), true;
  }

  const price = await store.priceById(String(body.priceId));
  if (!price || price.status !== "for_sale" || price.promo_only) {
    return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this price is not for sale"), true;
  }
  const currency = String(price.currency).toUpperCase();

  let account;
  try {
    account = await store.upsertBillingAccount({
      orgId,
      email: typeof body.billingEmail === "string" ? body.billingEmail : session.user.email,
      currency,
    });
  } catch (error) {
    if (error?.code === "CURRENCY_LOCKED") {
      return fail(response, 409, "CURRENCY_LOCKED", "this organisation pays in another currency"), true;
    }
    throw error;
  }

  const routes = await store.routesFor({
    methodGroup: String(body.methodGroup),
    currency,
    testMode: Boolean(account.test_mode),
  });
  const route = routes[0];
  if (!route) {
    return fail(response, 422, "NO_PAYMENT_ROUTE", "no connection serves this method"), true;
  }
  // The route list is public on purpose; the keys live only on the runtime read.
  const connection = (await store.connectionById?.(route.id)) ?? route;
  const adapter = paymentAdapters()[connection.provider];
  if (!adapter) {
    return fail(response, 501, "PROVIDER_NOT_READY", "this provider arrives in a later stage"), true;
  }

  // A provider that talks to a network needs its sealed keys; a manual connection has no
  // envelope. The plaintext lives only for this request and goes to the adapter, never
  // into the response or the log.
  let usable = connection;
  if (connection.has_secret || connection.ciphertext) {
    let secret;
    try {
      secret = openConnectionSecret(connection, { kek: kekFromEnv() });
    } catch {
      return fail(response, 503, "PROVIDER_UNAVAILABLE", "the connection cannot be used"), true;
    }
    usable = { ...connection, secret };
  }

  // `bigint` columns arrive as strings from `pg`; money arithmetic is numeric here.
  const amount = Number(price.amount);
  let discount = 0;
  let promo = null;
  if (body.promoCode) {
    promo = await store.promoByCode(String(body.promoCode));
    const result = promoDiscount({ promo, amount });
    if (!result.ok) return fail(response, 422, result.code, "this code cannot be used here"), true;
    discount = result.discount;
  }
  const balance = Number(await store.creditBalance(orgId, currency));
  const totals = priceInvoice({ amount, discount, credit: balance });

  const periodStart = new Date();
  const periodEnd = endOfPeriod(periodStart, price.interval);
  // A reusable token needs the provider's capability and the payer's autopay consent.
  // The consent version is copied into the invoice line: the webhook that receives the
  // token has no session, and the invoice is the durable record of what was agreed.
  const savePaymentMethod = consent.autopay === true && adapter.capabilities?.saveMethod === true;
  const lines = [
    {
      kind: "subscription",
      plan: price.plan,
      interval: price.interval,
      priceId: price.id,
      amount,
      promoCode: promo?.code ?? null,
      ...(savePaymentMethod
        ? {
            autopayConsent: {
              version: String(consent.termsVersion),
              at: periodStart.toISOString(),
            },
          }
        : {}),
    },
  ];
  const invoice = await store.createInvoice({
    orgId,
    currency,
    lines,
    subtotal: totals.subtotal,
    discount: totals.discount,
    creditApplied: totals.creditApplied,
    total: totals.total,
    periodStart,
    periodEnd,
    dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const payment = await store.recordPayment({
    orgId,
    invoiceId: invoice.invoice.id,
    connectionId: connection.id,
    providerPaymentId: null,
    idempotencyKey: `checkout:${invoice.invoice.id}`,
    amount: totals.total,
    currency,
    status: "pending",
  });

  const started = await adapter.createCheckout(usable, {
    paymentId: payment.id,
    idempotencyKey: `checkout:${invoice.invoice.id}`,
    amount: totals.total,
    currency,
    description: `${price.plan} plan`,
    savePaymentMethod,
    customerEmail: account?.billing_email ?? session.user.email,
    returnUrl: body.returnUrl ?? null,
    locale: body.locale === "en" ? "en" : "ru",
  });

  if (started.providerPaymentId) {
    await store.attachProviderPaymentId?.(payment.id, started.providerPaymentId);
  }

  json(response, 201, {
    invoiceId: invoice.invoice.id,
    paymentId: payment.id,
    amount: totals.total,
    currency,
    widget: started.widget ?? null,
    redirectUrl: started.redirectUrl ?? null,
  });
  return true;
}

/** Checkout status after a return to the app; nothing here trusts the browser. */
async function checkoutStatus({ request, response, store, orgId, paymentId }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session) return true;
  const payment = await store.billingPayment(orgId, paymentId);
  if (!payment) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such payment"), true;
  json(response, 200, {
    paymentId: payment.id,
    invoiceId: payment.invoice_id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
  });
  return true;
}

async function invoices({ request, response, store, orgId }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session) return true;
  json(response, 200, { invoices: await store.listInvoices(orgId, 50) });
  return true;
}

/** Routes under `/orgs/:id/billing/…`; the caller has already resolved the organisation. */
export async function handleCheckoutRoutes({ request, response, url, store, orgId, rest }) {
  const method = request.method ?? "GET";
  const [head, tail] = rest.split("/");

  if (head === "checkout" && !tail) {
    if (method !== "POST") return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST"), true;
    return checkout({ request, response, store, orgId });
  }
  if (head === "checkout" && tail) {
    if (method !== "GET") return fail(response, 405, "METHOD_NOT_ALLOWED", "use GET"), true;
    return checkoutStatus({ request, response, store, orgId, paymentId: tail });
  }
  if (head === "invoices" && !tail) {
    if (method !== "GET") return fail(response, 405, "METHOD_NOT_ALLOWED", "use GET"), true;
    return invoices({ request, response, store, orgId });
  }
  return false;
}
