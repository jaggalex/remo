/**
 * The development payment provider (ADR-248 §7, `spec/payment-providers.md` §7).
 *
 * The tests pin the two things that would be dangerous to get wrong: the adapter cannot
 * be reached in production even with the flag, and a completion is a ledger operation,
 * not a client-side toast — it saves the fake card once and a repeated click changes
 * nothing. The HTTP handler is exercised with a small store double, so the save and the
 * idempotency are visible without a database.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FAKE_CARD,
  FAKE_SIGNATURE_HEADER,
  assertFakeProviderGate,
  completeFakePayment,
  fakeAdapter,
  fakeProviderEnabled,
  resetFakePayments,
} from "./pay-fake.mjs";
import { handleFakeBilling } from "./billing-fake-api.mjs";
import { paymentAdapters } from "./payment-adapters.mjs";
import { paymentProviderMethods } from "./pg/payment-providers.mjs";

const ENV = process.env;

beforeEach(() => {
  resetFakePayments();
  process.env.REMO_APP_ORIGIN = "https://remo.example.test";
  delete process.env.REMO_PAY_FAKE;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ENV };
  resetFakePayments();
});

describe("gate (§7)", () => {
  it("needs the explicit flag and never loads in production", () => {
    expect(fakeProviderEnabled({})).toBe(false);
    expect(fakeProviderEnabled({ REMO_PAY_FAKE: "1" })).toBe(true);
    expect(fakeProviderEnabled({ NODE_ENV: "production", REMO_PAY_FAKE: "1" })).toBe(false);
  });

  it("refuses to start a production process that carries the flag", () => {
    expect(() =>
      assertFakeProviderGate({ NODE_ENV: "production", REMO_PAY_FAKE: "1" }),
    ).toThrow(/production/);
    expect(() => assertFakeProviderGate({ REMO_PAY_FAKE: "1" })).not.toThrow();
  });

  it("joins the adapter registry only under the gate", () => {
    expect(Object.keys(paymentAdapters({}))).toEqual(["manual", "yookassa"]);
    expect(paymentAdapters({ REMO_PAY_FAKE: "1" }).fake).toBe(fakeAdapter);
    expect(paymentAdapters({ NODE_ENV: "production", REMO_PAY_FAKE: "1" }).fake).toBeUndefined();
  });

  it("refuses a fake connection row when the gate is off", async () => {
    await expect(
      paymentProviderMethods.createConnection.call(
        {},
        {
          provider: "fake",
          name: "Fake",
          mode: "test",
          currencies: ["RUB"],
          methodGroups: ["ru_card"],
        },
      ),
    ).rejects.toThrow(/REMO_PAY_FAKE/);
  });
});

describe("adapter contract (§4, §7)", () => {
  it("declares a merchant-scheduled provider that can save and redirect", () => {
    expect(fakeAdapter.provider).toBe("fake");
    expect(fakeAdapter.capabilities).toEqual({
      model: "merchant_scheduled",
      saveMethod: true,
      verifyMethodWithoutCharge: true,
      redirects: true,
      refunds: "none",
      receipts54fz: false,
      currencies: [],
    });
  });

  it("requires the webhook secret", () => {
    expect(fakeAdapter.validateConfig({}, {})).toEqual([
      {
        field: "webhookSecret",
        message: "add a webhook secret; the fake provider signs every notification with it",
      },
    ]);
    expect(fakeAdapter.validateConfig({}, { webhookSecret: "shared" })).toEqual([]);
  });

  it("sends the payer to the app with our payment id", async () => {
    const started = await fakeAdapter.createCheckout(
      { settings: {} },
      {
        paymentId: "pay-1",
        idempotencyKey: "checkout:inv-1",
        amount: 199000,
        currency: "rub",
        description: "pro plan",
        savePaymentMethod: true,
        customerEmail: "billing@example.test",
        returnUrl: null,
        locale: "ru",
      },
    );

    expect(started).toEqual({
      providerPaymentId: "fake:pay-1",
      redirectUrl: "https://remo.example.test/?fake_pay=pay-1",
    });
    const pending = await fakeAdapter.getPayment(null, "fake:pay-1");
    expect(pending).toMatchObject({ status: "pending", amount: 199000, currency: "RUB" });
    expect(pending.savedMethod).toBeUndefined();

    completeFakePayment("fake:pay-1", "success");
    const done = await fakeAdapter.getPayment(null, "fake:pay-1");
    expect(done.status).toBe("succeeded");
    expect(done.savedMethod).toEqual({
      methodRef: "fake:card",
      display: { ...FAKE_CARD.display },
    });
  });

  it("accepts a correctly signed notification and rejects a forgery", async () => {
    const body = Buffer.from(JSON.stringify({ paymentId: "pay-9", status: "succeeded" }));
    const conn = { secret: { webhookSecret: "shared-secret" } };
    const signature = createHmac("sha256", "shared-secret").update(body).digest("hex");

    const ok = await fakeAdapter.parseWebhook(conn, {
      headers: { [FAKE_SIGNATURE_HEADER]: signature },
      rawBody: body,
    });
    expect(ok.verified).toBe(true);
    expect(ok.events[0]).toMatchObject({
      type: "payment.updated",
      key: "fake:pay-9:succeeded",
      paymentId: "pay-9",
      payment: { status: "succeeded" },
    });

    const forged = await fakeAdapter.parseWebhook(conn, {
      headers: { [FAKE_SIGNATURE_HEADER]: "00".repeat(32) },
      rawBody: body,
    });
    expect(forged.verified).toBe(false);
    expect(forged.respond.status).toBe(401);
  });
});

/* --------------------------------------------------------------- routes -- */

function fakeResponse() {
  const headers = {};
  return {
    status: 0,
    body: "",
    headers,
    getHeader(name) {
      return headers[name];
    },
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(status, extra = {}) {
      this.status = status;
      Object.assign(headers, extra);
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function fakeRequest({ method = "POST", body, cookie = "remo_session=session-token" } = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    headers: { cookie },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
}

const INVOICE = {
  id: "inv-1",
  org_id: "org-1",
  number: "RU-0001",
  status: "open",
  currency: "RUB",
  subtotal: 199000,
  discount: 0,
  credit_applied: 0,
  total: 199000,
  period_end: "2026-12-20T00:00:00.000Z",
  lines: [
    {
      kind: "subscription",
      plan: "pro",
      interval: "month",
      priceId: "price-1",
      amount: 199000,
      autopayConsent: { version: "2026-11-20", at: "2026-11-20T00:00:00.000Z" },
    },
  ],
};

function fakeStore({ connection = { id: "conn-fake", provider: "fake" } } = {}) {
  const events = new Set();
  const saved = [];
  const settled = [];
  const attempts = [];
  return {
    events,
    saved,
    settled,
    attempts,
    async paymentChainFor(id) {
      if (id !== "pay-1") return null;
      return {
        payment_id: "pay-1",
        org_id: "org-1",
        invoice_id: "inv-1",
        payment_status: "pending",
        connection_id: connection.id,
        payment_amount: 199000,
        payment_currency: "RUB",
        invoice_currency: "RUB",
        lines: INVOICE.lines,
      };
    },
    async connectionById() {
      return connection;
    },
    async billingInvoiceGlobal(id) {
      return id === "inv-1" ? { ...INVOICE } : null;
    },
    async recordProviderEvent({ providerEventKey }) {
      if (events.has(providerEventKey)) return false;
      events.add(providerEventKey);
      return true;
    },
    async findSession() {
      return { id: "s1", user_id: "u1", email: "owner@example.test", name: "Owner", handle: "owner" };
    },
    async getOrgMembership() {
      return { state: "active" };
    },
    async hasOrgRole() {
      return true;
    },
    async withTenant(_orgId, run) {
      return run();
    },
    async creditBalance() {
      return 0;
    },
    async applyCredit() {},
    async markInvoicePaid(args) {
      settled.push(args);
      return { invoice: { id: "inv-1", status: "paid" }, payment: { id: "pay-settled" } };
    },
    async upsertOperatorPlan() {},
    async reconcileFrozenRooms() {},
    async savePaymentMethod(args) {
      saved.push(args);
      return { id: "pm-1" };
    },
    async recordPayment(args) {
      attempts.push(args);
      return { id: "pay-failed" };
    },
  };
}

function completeRequest(paymentId = "pay-1", outcome = "success") {
  return fakeRequest({ method: "POST", body: { paymentId, outcome } });
}

describe("POST /billing/fake/complete", () => {
  it("is a 404 without the flag and in production", async () => {
    for (const env of [{}, { NODE_ENV: "production", REMO_PAY_FAKE: "1" }]) {
      const response = fakeResponse();
      const handled = await handleFakeBilling({
        request: completeRequest(),
        response,
        url: new URL("http://localhost/billing/fake/complete"),
        store: fakeStore(),
        env,
      });
      expect(handled).toBe(true);
      expect(response.status).toBe(404);
    }
  });

  it("settles the invoice and saves the fake card once", async () => {
    const store = fakeStore();
    const response = fakeResponse();
    await handleFakeBilling({
      request: completeRequest(),
      response,
      url: new URL("http://localhost/billing/fake/complete"),
      store,
      env: { REMO_PAY_FAKE: "1" },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, status: "succeeded" });
    expect(store.settled).toEqual([
      {
        invoiceId: "inv-1",
        amount: 199000,
        currency: "RUB",
        connectionId: "conn-fake",
        providerPaymentId: "fake:pay-1",
      },
    ]);
    expect(store.saved).toEqual([
      {
        orgId: "org-1",
        connectionId: "conn-fake",
        ref: "fake:card",
        display: { ...FAKE_CARD.display },
        consentVersion: "2026-11-20",
      },
    ]);
  });

  it("answers a repeated click without touching the ledger again", async () => {
    const store = fakeStore();
    const url = new URL("http://localhost/billing/fake/complete");
    for (let click = 0; click < 2; click += 1) {
      const response = fakeResponse();
      await handleFakeBilling({
        request: completeRequest(),
        response,
        url,
        store,
        env: { REMO_PAY_FAKE: "1" },
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).ok).toBe(true);
    }
    expect(store.settled).toHaveLength(1);
    expect(store.saved).toHaveLength(1);
  });

  it("records a decline as a failed attempt and saves no card", async () => {
    const store = fakeStore();
    const response = fakeResponse();
    await handleFakeBilling({
      request: completeRequest("pay-1", "fail"),
      response,
      url: new URL("http://localhost/billing/fake/complete"),
      store,
      env: { REMO_PAY_FAKE: "1" },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, status: "failed" });
    expect(store.settled).toHaveLength(0);
    expect(store.saved).toHaveLength(0);
    expect(store.attempts[0]).toMatchObject({
      orgId: "org-1",
      invoiceId: "inv-1",
      status: "failed",
      failureCode: "card_declined",
      idempotencyKey: "fake:pay-1:failed",
    });
  });

  it("refuses a payment that is not on a fake connection", async () => {
    const store = fakeStore({ connection: { id: "conn-live", provider: "yookassa" } });
    const response = fakeResponse();
    await handleFakeBilling({
      request: completeRequest(),
      response,
      url: new URL("http://localhost/billing/fake/complete"),
      store,
      env: { REMO_PAY_FAKE: "1" },
    });
    expect(response.status).toBe(404);
    expect(store.settled).toHaveLength(0);
  });
});

describe("GET /billing/fake/payment/:id", () => {
  it("shows the amount and status the page renders", async () => {
    const store = fakeStore();
    const response = fakeResponse();
    await handleFakeBilling({
      request: fakeRequest({ method: "GET" }),
      response,
      url: new URL("http://localhost/billing/fake/payment/pay-1"),
      store,
      env: { REMO_PAY_FAKE: "1" },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      paymentId: "pay-1",
      amount: 199000,
      currency: "RUB",
      status: "pending",
      saveMethod: true,
    });
  });
});
