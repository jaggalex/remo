/**
 * Test payment provider for checkout and card-replacement flows (ADR-248 §7,
 * `spec/payment-providers.md` §7).
 *
 * This file exists so the client path can be watched end to end without a provider
 * account: `createCheckout` returns a normal redirect URL pointing back at the app with
 * `?fake_pay=<paymentId>`, the page has a success and a decline button, and the result is
 * applied through the same ledger methods a real payment uses.
 *
 * The adapter is a development seam, not a feature: it is loaded only when
 * `NODE_ENV !== "production"` **and** `REMO_PAY_FAKE=1`. A production process that is
 * handed the flag refuses to start (`assertFakeProviderGate`), and a connection row with
 * `provider = 'fake'` is refused at creation — the same shape as `ai-fake.mjs`.
 *
 * Payment status lives in this process. That is deliberate: a fake payment that survives
 * a restart would be a fake fact in a real ledger. The invoice and payment rows remain
 * the durable record of what the test did.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const FAKE_PROVIDER = "fake";
export const FAKE_SIGNATURE_HEADER = "x-remo-fake-signature";
const DEFAULT_APP_ORIGIN = "http://localhost:5173";

/** The card the fake provider "stores", so autopay has something to point at. */
export const FAKE_CARD = Object.freeze({
  methodRef: "fake:card",
  display: Object.freeze({
    kind: "card",
    brand: "visa",
    last4: "4242",
    expMonth: 12,
    expYear: 2030,
  }),
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The one gate. `REMO_PAY_FAKE=1` alone is not enough, and production cannot opt in:
 * a self-hoster who copies a development `.env` does not get a free-money button.
 */
export function fakeProviderEnabled(env = process.env) {
  if (env?.NODE_ENV === "production") return false;
  return env?.REMO_PAY_FAKE === "1";
}

/**
 * A production process with the development flag is a misconfiguration, not a feature
 * switch. Startup fails loudly instead of silently serving a disabled adapter.
 */
export function assertFakeProviderGate(env = process.env) {
  if (env?.NODE_ENV === "production" && env?.REMO_PAY_FAKE === "1") {
    throw new Error(
      "REMO_PAY_FAKE is a development seam; refusing to start in production with it set",
    );
  }
}

/** providerPaymentId → the status the fake page and `getPayment` report. */
const payments = new Map();

/** Test seam: the module keeps no state across two scenarios in one process. */
export function resetFakePayments() {
  payments.clear();
}

/**
 * Record the outcome chosen on the fake page. Returns the normalized status and whether
 * the status changed, so a repeated request can skip every ledger consequence.
 */
export function completeFakePayment(providerPaymentId, outcome) {
  const entry = payments.get(providerPaymentId);
  if (!entry) return null;
  const status = outcome === "success" ? "succeeded" : "failed";
  const changed = entry.status !== status;
  entry.status = status;
  return { ...entry, status, changed };
}

/** One normalized payment from what checkout stored. */
function normalized(providerPaymentId, entry) {
  return {
    providerPaymentId,
    status: entry?.status ?? "pending",
    amount: Number(entry?.amount ?? 0),
    currency: entry?.currency ?? "RUB",
    ...(entry?.status === "succeeded" && entry?.saveMethod
      ? { savedMethod: { methodRef: FAKE_CARD.methodRef, display: { ...FAKE_CARD.display } } }
      : {}),
  };
}

/** Constant-time comparison that does not leak the expected signature length. */
function signatureMatches(expected, given) {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(text(given), "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function webhookSecret(conn) {
  return text(conn?.secret?.webhookSecret) || text(conn?.settings?.webhookSecret);
}

export const fakeAdapter = {
  provider: FAKE_PROVIDER,

  capabilities: {
    model: "merchant_scheduled",
    saveMethod: true,
    verifyMethodWithoutCharge: true,
    redirects: true,
    refunds: "none",
    receipts54fz: false,
    currencies: [],
  },

  /** The HMAC key is the only configuration: there is no API to reach. */
  validateConfig(_settings = {}, secret = {}) {
    if (text(secret?.webhookSecret)) return [];
    return [
      {
        field: "webhookSecret",
        message: "add a webhook secret; the fake provider signs every notification with it",
      },
    ];
  },

  async healthCheck() {
    return { ok: true, detail: "fake: no provider API to check" };
  },

  /** A redirect to the app's own fake page — the same shape as a real hosted checkout. */
  async createCheckout(conn, req) {
    const origin = (
      text(process.env.REMO_APP_ORIGIN) ||
      text(conn?.settings?.appOrigin) ||
      DEFAULT_APP_ORIGIN
    ).replace(/\/+$/, "");
    const providerPaymentId = `fake:${req.paymentId}`;
    payments.set(providerPaymentId, {
      paymentId: req.paymentId,
      amount: Number(req.amount ?? 0),
      currency: String(req.currency ?? "RUB").toUpperCase(),
      saveMethod: Boolean(req.savePaymentMethod),
      status: "pending",
    });
    return {
      providerPaymentId,
      redirectUrl: `${origin}/?fake_pay=${encodeURIComponent(req.paymentId)}`,
    };
  },

  /** Renewal path: a fake charge always succeeds with the one fake card. */
  async chargeSaved(_conn, req) {
    const providerPaymentId = `fake:${req.paymentId}`;
    const entry = {
      paymentId: req.paymentId,
      amount: Number(req.amount ?? 0),
      currency: String(req.currency ?? "RUB").toUpperCase(),
      saveMethod: true,
      status: "succeeded",
    };
    payments.set(providerPaymentId, entry);
    return {
      ...normalized(providerPaymentId, entry),
      savedMethod: { methodRef: FAKE_CARD.methodRef, display: { ...FAKE_CARD.display } },
    };
  },

  /** Status by our provider payment id; unknown ids are still pending, never failed. */
  async getPayment(_conn, providerPaymentId) {
    return normalized(providerPaymentId, payments.get(providerPaymentId));
  },

  /**
   * HMAC-SHA256 of the raw body with the connection's `webhookSecret`. The signature is a
   * hex digest in `x-remo-fake-signature`; the body is `{ paymentId, status }`.
   */
  async parseWebhook(conn, { headers = {}, rawBody } = {}) {
    const secret = webhookSecret(conn);
    const unsigned = {
      verified: false,
      events: [],
      respond: {
        status: 401,
        body: JSON.stringify({ error: "WEBHOOK_REJECTED" }),
        contentType: "application/json",
      },
    };
    if (!secret) return unsigned;

    const expected = createHmac("sha256", secret).update(rawBody ?? Buffer.alloc(0)).digest("hex");
    if (!signatureMatches(expected, headers[FAKE_SIGNATURE_HEADER])) return unsigned;

    let body;
    try {
      body = JSON.parse((rawBody ?? Buffer.alloc(0)).toString("utf8"));
    } catch {
      return unsigned;
    }
    const paymentId = text(body?.paymentId);
    const status = text(body?.status);
    if (!paymentId || !["succeeded", "failed", "canceled"].includes(status)) return unsigned;

    const providerPaymentId = `fake:${paymentId}`;
    const entry = payments.get(providerPaymentId);
    if (entry) entry.status = status;
    const payment = normalized(providerPaymentId, entry ?? { status, amount: body?.amount, currency: body?.currency });

    return {
      verified: true,
      events: [
        {
          type: "payment.updated",
          key: `fake:${paymentId}:${status}`,
          paymentId,
          payment,
        },
      ],
      respond: {
        status: 200,
        body: JSON.stringify({ ok: true }),
        contentType: "application/json",
      },
    };
  },
};

export default fakeAdapter;
