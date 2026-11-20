/**
 * YooKassa adapter without a network (ADR-248, `spec/payment-providers.md` §4, §5, §7).
 *
 * Every request goes through a fake `fetch`, so the tests pin the exact URL, headers and
 * body a real shop would send, the status mapping the billing core depends on, and the
 * rule that a notification is believed only when the API confirms it.
 */
import { describe, expect, it } from "vitest";
import { YooKassaError, yookassaAdapter } from "./pay-yookassa.mjs";

const CONN = {
  id: "conn-1",
  provider: "yookassa",
  secret: { shopId: "123456", secretKey: "test_secret_key" },
};

const AUTH = `Basic ${Buffer.from("123456:test_secret_key", "utf8").toString("base64")}`;

/** A fetch stand-in: records the call, returns `{status, body}`, or throws an Error. */
function fakeFetch(answer) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const result = typeof answer === "function" ? await answer(url, options, calls.length) : answer;
    if (result instanceof Error) throw result;
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => (typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? {})),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const PAYMENT = {
  id: "pay_1",
  status: "succeeded",
  amount: { value: "1234.56", currency: "RUB" },
  metadata: { paymentId: "our-payment-1" },
  receipt_registration: "succeeded",
  payment_method: {
    type: "bank_card",
    id: "pm_1",
    saved: true,
    card: { card_type: "MasterCard", last4: "4444", expiry_month: "01", expiry_year: "2030" },
  },
};

function notification(event = "payment.succeeded", id = "pay_1") {
  return Buffer.from(JSON.stringify({ type: "notification", event, object: { id, status: "succeeded" } }));
}

function webhookDeps(extra = {}) {
  return { fetchImpl: fakeFetch({ status: 200, body: PAYMENT }), allowedIps: ["185.71.76.10"], ...extra };
}

describe("capabilities (§3.2, §4)", () => {
  it("declares a merchant-scheduled RUB connection that can save and refund", () => {
    expect(yookassaAdapter.provider).toBe("yookassa");
    expect(yookassaAdapter.capabilities).toEqual({
      model: "merchant_scheduled",
      saveMethod: true,
      verifyMethodWithoutCharge: true,
      refunds: "full",
      receipts54fz: true,
      currencies: ["RUB"],
    });
  });
});

describe("validateConfig (§2.2)", () => {
  it("requires both the shop id and the secret key", () => {
    expect(yookassaAdapter.validateConfig({}, {})).toEqual([
      { field: "shopId", message: "add the shop id from the YooKassa cabinet" },
      { field: "secretKey", message: "add the secret key from the YooKassa cabinet" },
    ]);
  });

  it("accepts a complete secret and ignores blanks", () => {
    expect(yookassaAdapter.validateConfig({}, { shopId: " 123 ", secretKey: " key " })).toEqual([]);
    expect(yookassaAdapter.validateConfig({}, { shopId: "  ", secretKey: "key" })).toHaveLength(1);
  });
});

describe("createCheckout (§7)", () => {
  it("posts a redirect payment with metadata, idempotency and Basic auth", async () => {
    const fetchImpl = fakeFetch({
      status: 200,
      body: { id: "pay_1", confirmation: { type: "redirect", confirmation_url: "https://yoomoney.ru/pay" } },
    });
    const receipt = { customer: { email: "billing@example.test" }, items: [] };
    const result = await yookassaAdapter.createCheckout(
      CONN,
      {
        paymentId: "our-payment-1",
        idempotencyKey: "checkout:inv-1",
        amount: 123456,
        currency: "RUB",
        description: "pro plan",
        savePaymentMethod: true,
        customerEmail: "billing@example.test",
        receipt,
        returnUrl: "https://remo.example.test/billing/return",
        locale: "ru",
      },
      { fetchImpl },
    );

    expect(result).toEqual({ providerPaymentId: "pay_1", redirectUrl: "https://yoomoney.ru/pay" });
    expect(fetchImpl.calls).toHaveLength(1);
    const [call] = fetchImpl.calls;
    expect(call.url).toBe("https://api.yookassa.ru/v3/payments");
    expect(call.options.method).toBe("POST");
    expect(call.options.headers.Authorization).toBe(AUTH);
    expect(call.options.headers["Idempotence-Key"]).toBe("checkout:inv-1");
    expect(call.options.headers["Content-Type"]).toBe("application/json");
    expect(call.options.timeoutMs).toBe(20_000);
    expect(JSON.parse(call.options.body)).toEqual({
      amount: { value: "1234.56", currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: "https://remo.example.test/billing/return" },
      description: "pro plan",
      metadata: { paymentId: "our-payment-1" },
      save_payment_method: true,
      receipt,
    });
  });

  it("omits the receipt and the save flag when the caller does not ask for them", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { id: "pay_2", confirmation: {} } });
    await yookassaAdapter.createCheckout(
      CONN,
      {
        paymentId: "p2",
        idempotencyKey: "k2",
        amount: 100,
        currency: "RUB",
        description: "month",
        savePaymentMethod: false,
        returnUrl: "https://example.test/back",
      },
      { fetchImpl },
    );
    const body = JSON.parse(fetchImpl.calls[0].options.body);
    expect(body.receipt).toBeUndefined();
    expect(body.save_payment_method).toBe(false);
    expect(body.amount).toEqual({ value: "1.00", currency: "RUB" });
  });

  it("keeps money in whole kopecks and refuses a non-RUB currency", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { id: "pay_3", confirmation: {} } });
    await yookassaAdapter.createCheckout(
      CONN,
      { paymentId: "p3", idempotencyKey: "k3", amount: 1, currency: "RUB", description: "x", returnUrl: "https://x.test" },
      { fetchImpl },
    );
    expect(JSON.parse(fetchImpl.calls[0].options.body).amount.value).toBe("0.01");

    await expect(
      yookassaAdapter.createCheckout(
        CONN,
        { paymentId: "p4", idempotencyKey: "k4", amount: 100, currency: "USD", description: "x", returnUrl: "https://x.test" },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "YOOKASSA_CURRENCY", retryable: false });
  });
});

describe("chargeSaved (§7)", () => {
  it("charges the saved method without a confirmation step", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { ...PAYMENT, status: "pending" } });
    const payment = await yookassaAdapter.chargeSaved(
      CONN,
      {
        paymentId: "our-payment-2",
        idempotencyKey: "renewal:sub-1:2026-12",
        methodRef: "pm_1",
        amount: 290000,
        currency: "RUB",
        description: "renewal",
      },
      { fetchImpl },
    );
    const body = JSON.parse(fetchImpl.calls[0].options.body);
    expect(body.payment_method_id).toBe("pm_1");
    expect(body.capture).toBe(true);
    expect(body.metadata).toEqual({ paymentId: "our-payment-2" });
    expect(body.confirmation).toBeUndefined();
    expect(fetchImpl.calls[0].options.headers["Idempotence-Key"]).toBe("renewal:sub-1:2026-12");
    expect(payment).toMatchObject({ providerPaymentId: "pay_1", status: "pending" });
  });

  it("refuses to charge without a method reference", async () => {
    await expect(
      yookassaAdapter.chargeSaved(
        CONN,
        { paymentId: "p", idempotencyKey: "k", amount: 100, currency: "RUB", description: "x" },
        { fetchImpl: fakeFetch({ status: 200, body: PAYMENT }) },
      ),
    ).rejects.toMatchObject({ code: "YOOKASSA_BAD_REQUEST", retryable: false });
  });
});

describe("getPayment status mapping (§4)", () => {
  it.each([
    ["pending", "pending"],
    ["waiting_for_capture", "pending"],
    ["succeeded", "succeeded"],
    ["canceled", "canceled"],
    ["something_new", "failed"],
  ])("maps %s to %s", async (providerStatus, expected) => {
    const fetchImpl = fakeFetch({ status: 200, body: { ...PAYMENT, status: providerStatus } });
    const payment = await yookassaAdapter.getPayment(CONN, "pay_1", { fetchImpl });
    expect(payment.status).toBe(expected);
    expect(fetchImpl.calls[0].url).toBe("https://api.yookassa.ru/v3/payments/pay_1");
    expect(fetchImpl.calls[0].options.method).toBe("GET");
  });

  it("normalizes the amount, the receipt and the saved card", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: PAYMENT });
    const payment = await yookassaAdapter.getPayment(CONN, "pay_1", { fetchImpl });
    expect(payment).toEqual({
      providerPaymentId: "pay_1",
      status: "succeeded",
      amount: 123456,
      currency: "RUB",
      receiptStatus: "issued",
      savedMethod: {
        methodRef: "pm_1",
        display: { kind: "card", brand: "MasterCard", last4: "4444", expMonth: 1, expYear: 2030 },
      },
    });
  });

  it("does not return a one-off method as reusable", async () => {
    const body = {
      ...PAYMENT,
      payment_method: { type: "bank_card", id: "pm_1", saved: false, card: { last4: "4444" } },
    };
    const payment = await yookassaAdapter.getPayment(CONN, "pay_1", {
      fetchImpl: fakeFetch({ status: 200, body }),
    });
    expect(payment.savedMethod).toBeUndefined();
  });

  it("maps a failed receipt and a cancellation reason", async () => {
    const body = {
      ...PAYMENT,
      status: "canceled",
      receipt_registration: "canceled",
      cancellation_details: { reason: "insufficient_funds" },
    };
    const payment = await yookassaAdapter.getPayment(CONN, "pay_1", {
      fetchImpl: fakeFetch({ status: 200, body }),
    });
    expect(payment.receiptStatus).toBe("failed");
    expect(payment.failureCode).toBe("insufficient_funds");
  });
});

describe("refund (§7)", () => {
  it("posts the refund with its own idempotency key", async () => {
    const fetchImpl = fakeFetch({
      status: 200,
      body: { id: "ref_1", status: "succeeded", amount: { value: "100.00", currency: "RUB" } },
    });
    const refund = await yookassaAdapter.refund(
      CONN,
      {
        refundId: "re-1",
        idempotencyKey: "refund:re-1",
        providerPaymentId: "pay_1",
        amount: 10000,
        currency: "RUB",
      },
      { fetchImpl },
    );
    expect(refund).toEqual({
      providerRefundId: "ref_1",
      status: "succeeded",
      amount: 10000,
      currency: "RUB",
    });
    const [call] = fetchImpl.calls;
    expect(call.url).toBe("https://api.yookassa.ru/v3/refunds");
    expect(call.options.headers["Idempotence-Key"]).toBe("refund:re-1");
    expect(JSON.parse(call.options.body)).toEqual({
      payment_id: "pay_1",
      amount: { value: "100.00", currency: "RUB" },
    });
  });
});

describe("errors (§5)", () => {
  it.each([
    [400, "YOOKASSA_400", false],
    [401, "YOOKASSA_401", false],
    [403, "YOOKASSA_403", false],
    [500, "YOOKASSA_500", true],
    [503, "YOOKASSA_503", true],
  ])("maps HTTP %i to %s", async (status, code, retryable) => {
    const error = await yookassaAdapter
      .getPayment(CONN, "pay_1", { fetchImpl: fakeFetch({ status, body: { description: "nope" } }) })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(YooKassaError);
    expect(error).toMatchObject({ code, retryable, status });
  });

  it("names a timeout and a network failure as retryable", async () => {
    const timeout = Object.assign(new Error("socket timeout"), { code: "TIMEOUT" });
    const timedOut = await yookassaAdapter
      .getPayment(CONN, "pay_1", { fetchImpl: fakeFetch(timeout) })
      .catch((error) => error);
    expect(timedOut).toMatchObject({ code: "YOOKASSA_TIMEOUT", retryable: true });

    const offline = await yookassaAdapter
      .getPayment(CONN, "pay_1", { fetchImpl: fakeFetch(new Error("connect ECONNREFUSED")) })
      .catch((error) => error);
    expect(offline).toMatchObject({ code: "YOOKASSA_NETWORK", retryable: true });
  });

  it("never puts the secret into an error", async () => {
    const error = await yookassaAdapter
      .getPayment(CONN, "pay_1", { fetchImpl: fakeFetch({ status: 401, body: {} }) })
      .catch((caught) => caught);
    const printed = `${error.message} ${JSON.stringify({ ...error })}`;
    expect(printed).not.toContain("test_secret_key");
    expect(printed).not.toContain(AUTH);
  });
});

describe("healthCheck (§2.2)", () => {
  it("probes the shop with the sealed credentials", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { shop_id: "123456" } });
    const result = await yookassaAdapter.healthCheck(CONN, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fetchImpl.calls[0].url).toBe("https://api.yookassa.ru/v3/me");
    expect(fetchImpl.calls[0].options.headers.Authorization).toBe(AUTH);
  });

  it("reports a rejected key without echoing it", async () => {
    const result = await yookassaAdapter.healthCheck(CONN, {
      fetchImpl: fakeFetch({ status: 401, body: {} }),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("YOOKASSA_401");
    expect(result.detail).not.toContain("test_secret_key");
  });
});

describe("parseWebhook (§5)", () => {
  it("rejects a sender outside the allowlist without asking the API", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: PAYMENT });
    const result = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification(), remoteIp: "203.0.113.9" },
      { fetchImpl, allowedIps: ["185.71.76.10"] },
    );
    expect(result.verified).toBe(false);
    expect(result.events).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("refuses everything when the allowlist is empty", async () => {
    const result = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification(), remoteIp: "185.71.76.10" },
      { fetchImpl: fakeFetch({ status: 200, body: PAYMENT }), allowedIps: [] },
    );
    expect(result.verified).toBe(false);
  });

  it("accepts an allowed sender when the API confirms success", async () => {
    const result = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification(), remoteIp: "::ffff:185.71.76.10" },
      webhookDeps(),
    );
    expect(result.verified).toBe(true);
    expect(result.respond).toEqual({ status: 200, body: "OK" });
    expect(result.events).toEqual([
      {
        key: "payment.succeeded:pay_1:succeeded",
        type: "payment.updated",
        paymentId: "our-payment-1",
        payment: {
          providerPaymentId: "pay_1",
          status: "succeeded",
          amount: 123456,
          currency: "RUB",
          receiptStatus: "issued",
          savedMethod: {
            methodRef: "pm_1",
            display: { kind: "card", brand: "MasterCard", last4: "4444", expMonth: 1, expYear: 2030 },
          },
        },
      },
    ]);
  });

  it("believes the API status, not the body", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { ...PAYMENT, status: "canceled" } });
    const result = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification("payment.succeeded"), remoteIp: "185.71.76.10" },
      { fetchImpl, allowedIps: ["185.71.76.10"] },
    );
    expect(result.verified).toBe(true);
    expect(result.events[0].key).toBe("payment.succeeded:pay_1:canceled");
    expect(result.events[0].payment.status).toBe("canceled");
  });

  it("verifies a pending notification without emitting an event", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { ...PAYMENT, status: "pending" } });
    const result = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification(), remoteIp: "185.71.76.10" },
      { fetchImpl, allowedIps: ["185.71.76.10"] },
    );
    expect(result.verified).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.respond).toEqual({ status: 200, body: "OK" });
  });

  it("rejects a status the API cannot confirm", async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { ...PAYMENT, status: "something_new" } });
    const result = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification(), remoteIp: "185.71.76.10" },
      { fetchImpl, allowedIps: ["185.71.76.10"] },
    );
    expect(result.verified).toBe(false);
  });

  it("rejects an unparsable body and a foreign event", async () => {
    const broken = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: Buffer.from("{not json"), remoteIp: "185.71.76.10" },
      webhookDeps(),
    );
    expect(broken.verified).toBe(false);

    const foreign = await yookassaAdapter.parseWebhook(
      CONN,
      { headers: {}, rawBody: notification("refund.succeeded"), remoteIp: "185.71.76.10" },
      webhookDeps(),
    );
    expect(foreign.verified).toBe(false);
  });

  it("derives the same event key on a repeated delivery", async () => {
    const deps = webhookDeps();
    const args = { headers: {}, rawBody: notification(), remoteIp: "185.71.76.10" };
    const first = await yookassaAdapter.parseWebhook(CONN, args, deps);
    const second = await yookassaAdapter.parseWebhook(CONN, args, deps);
    expect(first.events[0].key).toBe(second.events[0].key);
  });

  it("lets a retryable API failure out so the sender repeats the delivery", async () => {
    const error = await yookassaAdapter
      .parseWebhook(
        CONN,
        { headers: {}, rawBody: notification(), remoteIp: "185.71.76.10" },
        { fetchImpl: fakeFetch({ status: 502, body: {} }), allowedIps: ["185.71.76.10"] },
      )
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "YOOKASSA_502", retryable: true });
  });
});
