/**
 * YooKassa adapter (ADR-248, `spec/payment-providers.md` §4, §5, §7).
 *
 * YooKassa does not sign notifications. Authenticity is established by two facts that do
 * not come from the request: the sender address belongs to the published list, and a
 * fresh `GET /v3/payments/:id` with the shop's own keys returns an object that really has
 * the claimed status. The notification body is only allowed to name the object; the API
 * answer is the fact. Docs: https://yookassa.ru/developers/using-api/payments/notifications
 *
 * Cards never pass through this process: checkout returns a redirect URL, and renewals
 * use the provider's own `payment_method_id`. The adapter never logs a key, and an error
 * carries a status or a reason, never the Basic-auth header.
 */
import { safeFetch } from "@remo/outbound";

const API = "https://api.yookassa.ru/v3";
const TIMEOUT_MS = 20_000;
const RUB = "RUB";

/** The one error shape a caller can branch on without reading a provider message. */
export class YooKassaError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = "YooKassaError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Whole kopecks in, a decimal string out. `Number(v) * 100` on the way back is safe here
 * because the API returns at most two decimals; rounding absorbs the binary artefact.
 */
function decimal(minorUnits) {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) {
    throw new YooKassaError("YOOKASSA_AMOUNT", "the amount must be a non-negative integer in minor units");
  }
  return (minorUnits / 100).toFixed(2);
}

function amountObject(amount, currency) {
  if (String(currency ?? "").toUpperCase() !== RUB) {
    throw new YooKassaError("YOOKASSA_CURRENCY", "yookassa charges RUB only");
  }
  return { value: decimal(amount), currency: RUB };
}

function minorUnits(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

/** YooKassa statuses to the four normalized ones; anything new is a failure, not pending. */
const STATUSES = Object.freeze({
  pending: "pending",
  waiting_for_capture: "pending",
  succeeded: "succeeded",
  canceled: "canceled",
});

const SECOND_STATUSES = Object.freeze({ pending: "pending", succeeded: "succeeded", canceled: "canceled" });

const RECEIPT_STATUSES = Object.freeze({
  pending: "pending",
  succeeded: "issued",
  canceled: "failed",
});

/** `spec/payment-providers.md` §4: the closed failure list, YooKassa reason in, ours out. */
const FAILURE_CODES = Object.freeze({
  insufficient_funds: "insufficient_funds",
  card_expired: "card_expired",
  "3d_secure_failed": "3ds_failed",
  fraud_suspected: "fraud_suspected",
  permission_revoked: "method_revoked",
  payment_method_not_allowed: "method_revoked",
  payment_method_limit_exceeded: "limit_exceeded",
  internal_timeout: "provider_error",
  issuer_unavailable: "provider_error",
  canceled_by_merchant: "provider_error",
  general_decline: "card_declined",
  call_issuer: "card_declined",
  rejected_by_bank: "card_declined",
  invalid_card_number: "card_declined",
  invalid_cvv: "card_declined",
  invalid_recipient: "card_declined",
  country_forbidden: "card_declined",
});

const METHOD_KINDS = Object.freeze({
  bank_card: "card",
  sbp: "sbp",
  yoo_money: "wallet",
  sberbank: "wallet",
  tinkoff_bank: "wallet",
  alfabank: "wallet",
});

/** The Basic header, built only here from the opened secret. */
function authorization(conn) {
  const shopId = text(conn?.secret?.shopId);
  const secretKey = text(conn?.secret?.secretKey);
  if (!shopId || !secretKey) {
    throw new YooKassaError("YOOKASSA_CONFIG", "the connection has no shop id or secret key");
  }
  return `Basic ${Buffer.from(`${shopId}:${secretKey}`, "utf8").toString("base64")}`;
}

/**
 * One HTTPS call. Network and provider 5xx answers are retryable; a 400/401/403 is a
 * configuration or request problem and repeating it changes nothing.
 */
async function call(conn, { method = "GET", path, body, idempotencyKey }, { fetchImpl = safeFetch } = {}) {
  const headers = {
    Authorization: authorization(conn),
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotence-Key"] = String(idempotencyKey);

  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    const timedOut =
      error?.code === "TIMEOUT" || error?.name === "TimeoutError" || error?.name === "AbortError";
    // The original message may quote the URL or a socket; neither is useful to a caller,
    // and one of them could carry a header in a future implementation.
    if (timedOut) {
      throw new YooKassaError("YOOKASSA_TIMEOUT", "yookassa did not answer in time", { retryable: true });
    }
    throw new YooKassaError("YOOKASSA_NETWORK", "yookassa is unreachable", { retryable: true });
  }

  const raw = typeof response.text === "function" ? await response.text() : "";
  if (!response.ok) {
    // Never quote the provider body: it is untrusted input and may echo the request.
    throw new YooKassaError(`YOOKASSA_${response.status}`, `yookassa answered ${response.status}`, {
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new YooKassaError("YOOKASSA_BAD_RESPONSE", "yookassa answered with a body that is not JSON", {
      retryable: true,
    });
  }
}

function savedMethod(payment) {
  const method = payment?.payment_method;
  // `saved` is the provider's promise that the id can be charged again; an id on a
  // one-off payment is not a reusable reference and must not be stored as one.
  if (!method?.id || method.saved !== true) return undefined;
  const card = method.card ?? {};
  const display = { kind: METHOD_KINDS[method.type] ?? "wallet" };
  if (card.card_type) display.brand = String(card.card_type);
  if (card.last4) display.last4 = String(card.last4);
  const month = Number(card.expiry_month);
  const year = Number(card.expiry_year);
  if (Number.isInteger(month) && month >= 1 && month <= 12) display.expMonth = month;
  if (Number.isInteger(year) && year > 0) display.expYear = year;
  return { methodRef: String(method.id), display };
}

/** One provider payment as the billing core understands it; raw objects never escape. */
export function normalizePayment(payment) {
  const status = STATUSES[payment?.status] ?? "failed";
  const result = {
    providerPaymentId: String(payment?.id ?? ""),
    status,
    amount: minorUnits(payment?.amount?.value),
    currency: String(payment?.amount?.currency ?? RUB).toUpperCase(),
  };
  const failure = FAILURE_CODES[payment?.cancellation_details?.reason];
  if (failure) result.failureCode = failure;
  else if (status === "canceled" || status === "failed") result.failureCode = "unknown";
  const method = savedMethod(payment);
  if (method) result.savedMethod = method;
  const receipt = RECEIPT_STATUSES[payment?.receipt_registration];
  if (receipt) result.receiptStatus = receipt;
  return result;
}

function normalizeRefund(refund) {
  return {
    providerRefundId: String(refund?.id ?? ""),
    status: SECOND_STATUSES[refund?.status] ?? "pending",
    amount: minorUnits(refund?.amount?.value),
    currency: String(refund?.amount?.currency ?? RUB).toUpperCase(),
  };
}

async function readPayment(conn, providerPaymentId, { fetchImpl } = {}) {
  return call(conn, { path: `/payments/${encodeURIComponent(providerPaymentId)}` }, { fetchImpl });
}

export const yookassaAdapter = {
  provider: "yookassa",

  capabilities: {
    model: "merchant_scheduled",
    saveMethod: true,
    verifyMethodWithoutCharge: true,
    refunds: "full",
    receipts54fz: true,
    currencies: ["RUB"],
  },

  /** Both fields live in the secret; a missing one is a configuration problem, not a warning. */
  validateConfig(_settings = {}, secret = {}) {
    const problems = [];
    if (!text(secret?.shopId)) {
      problems.push({ field: "shopId", message: "add the shop id from the YooKassa cabinet" });
    }
    if (!text(secret?.secretKey)) {
      problems.push({ field: "secretKey", message: "add the secret key from the YooKassa cabinet" });
    }
    return problems;
  },

  async healthCheck(conn, { fetchImpl } = {}) {
    try {
      await call(conn, { path: "/me" }, { fetchImpl });
      return { ok: true, detail: "yookassa: the shop is reachable" };
    } catch (error) {
      return {
        ok: false,
        detail: `${error?.code ?? "YOOKASSA_ERROR"}: ${error?.message ?? "the shop is not reachable"}`,
      };
    }
  },

  /**
   * A redirect checkout: the card is entered on YooKassa's page. `metadata.paymentId` is
   * how a later notification is tied to our own ledger row.
   */
  async createCheckout(conn, req, { fetchImpl } = {}) {
    const body = {
      amount: amountObject(req.amount, req.currency),
      capture: true,
      confirmation: { type: "redirect", return_url: req.returnUrl },
      description: req.description,
      metadata: { paymentId: String(req.paymentId) },
      save_payment_method: Boolean(req.savePaymentMethod),
    };
    if (req.receipt) body.receipt = req.receipt;
    const payment = await call(
      conn,
      { method: "POST", path: "/payments", body, idempotencyKey: req.idempotencyKey },
      { fetchImpl },
    );
    // A 200 without an id cannot be attached to our ledger row; treating it as success
    // would leave a paid customer with no payment.
    if (!payment?.id) {
      throw new YooKassaError("YOOKASSA_BAD_RESPONSE", "yookassa answered without a payment id", {
        retryable: true,
      });
    }
    return {
      providerPaymentId: String(payment.id),
      redirectUrl: payment?.confirmation?.confirmation_url,
    };
  },

  /** Renewal: charge the provider's saved method; no confirmation step exists here. */
  async chargeSaved(conn, req, { fetchImpl } = {}) {
    if (!text(req.methodRef)) {
      throw new YooKassaError("YOOKASSA_BAD_REQUEST", "a saved payment method is required");
    }
    const body = {
      amount: amountObject(req.amount, req.currency),
      capture: true,
      payment_method_id: String(req.methodRef),
      description: req.description,
      metadata: { paymentId: String(req.paymentId) },
    };
    if (req.receipt) body.receipt = req.receipt;
    const payment = await call(
      conn,
      { method: "POST", path: "/payments", body, idempotencyKey: req.idempotencyKey },
      { fetchImpl },
    );
    return normalizePayment(payment);
  },

  async getPayment(conn, providerPaymentId, { fetchImpl } = {}) {
    return normalizePayment(await readPayment(conn, providerPaymentId, { fetchImpl }));
  },

  async refund(conn, req, { fetchImpl } = {}) {
    const body = {
      payment_id: String(req.providerPaymentId),
      amount: amountObject(req.amount, req.currency),
    };
    if (req.receipt) body.receipt = req.receipt;
    const refund = await call(
      conn,
      { method: "POST", path: "/refunds", body, idempotencyKey: req.idempotencyKey },
      { fetchImpl },
    );
    if (!refund?.id) {
      throw new YooKassaError("YOOKASSA_BAD_RESPONSE", "yookassa answered without a refund id", {
        retryable: true,
      });
    }
    return normalizeRefund(refund);
  },

  /**
   * Verify a notification. The allowlist is supplied by the caller because YooKassa's
   * published addresses change without a release; an empty list refuses everything
   * rather than trusting a body the sender controls.
   *
   * `verified: false` means "do not touch money". A provider outage is different: it
   * throws a retryable error so the HTTP layer can answer `503` and the sender repeats
   * the delivery instead of the event being silently dropped.
   */
  async parseWebhook(conn, { rawBody, remoteIp } = {}, { fetchImpl, allowedIps = [] } = {}) {
    const denied = {
      verified: false,
      events: [],
      respond: { status: 401, body: "" },
    };

    const allowed = (Array.isArray(allowedIps) ? allowedIps : [])
      .map((value) => normalizeIp(value))
      .filter(Boolean);
    const sender = normalizeIp(remoteIp);
    if (!sender || allowed.length === 0 || !allowed.includes(sender)) return denied;

    let notification;
    try {
      const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
      notification = JSON.parse(body);
    } catch {
      return denied;
    }
    // Only payment notifications exist for this adapter, and only the object's id is
    // taken from the body. Everything else is what the API says.
    const event = typeof notification?.event === "string" ? notification.event : "";
    const objectId = typeof notification?.object?.id === "string" ? notification.object.id : "";
    if (!event.startsWith("payment.") || !objectId) return denied;

    const fresh = await readPayment(conn, objectId, { fetchImpl });
    const payment = normalizePayment(fresh);
    if (payment.status === "pending") {
      return { verified: true, events: [], respond: { status: 200, body: "OK" } };
    }
    if (payment.status !== "succeeded" && payment.status !== "canceled") return denied;

    const normalized = {
      key: `${event}:${objectId}:${payment.status}`,
      type: "payment.updated",
      payment,
    };
    const paymentId = fresh?.metadata?.paymentId;
    if (paymentId) normalized.paymentId = String(paymentId);
    return {
      verified: true,
      events: [normalized],
      respond: { status: 200, body: "OK" },
    };
  },
};

/** `::ffff:1.2.3.4` is the same sender as `1.2.3.4`. */
function normalizeIp(value) {
  const address = String(value ?? "").trim();
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export default yookassaAdapter;
