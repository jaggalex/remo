/**
 * The inbound webhook route without a database or a network (ADR-248,
 * `spec/payment-providers.md` §5).
 *
 * What is pinned here: an unknown connection and a wrong token are indistinguishable, a
 * draft connection is closed, a notification that fails verification never reaches the
 * inbox, a repeated delivery writes one row, and an oversized body stops before it is
 * read.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleBilling } from "./billing-catalog-api.mjs";
import { openConnectionSecret, sealedConnectionRow } from "./payment-connections.mjs";
import { encryptSecret } from "./secrets.mjs";
import { handlePaymentWebhook } from "./payment-webhooks.mjs";

const KEK = { key: randomBytes(32), id: "test-kek" };
const SENDER = "185.71.76.10";
const TOKEN = "hook-token";

const ENV = {
  REMO_KEK: KEK.key.toString("base64"),
  REMO_KEK_ID: KEK.id,
  REMO_YOOKASSA_WEBHOOK_IPS: SENDER,
};

const silent = { error() {}, warn() {}, log() {} };

const PAYMENT = {
  id: "pay_1",
  status: "succeeded",
  amount: { value: "100.00", currency: "RUB" },
  metadata: { paymentId: "our-payment-1" },
};

function fakeResponse() {
  const out = { status: 0, body: null, headers: {} };
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers ?? {};
    },
    end(payload) {
      out.body = payload ?? "";
    },
    setHeader(name, value) {
      out.headers[name] = value;
    },
    getHeader(name) {
      return out.headers[name];
    },
    headersSent: false,
  };
}

function fakeRequest({ body = "", remoteAddress = SENDER, method = "POST", headers = {} } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return {
    method,
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (bytes.length) yield bytes;
    },
    resume() {},
  };
}

function connectionFor({ id = "conn-1", provider = "yookassa", status = "active", sealed = true } = {}) {
  const row = {
    id,
    provider,
    name: "test",
    mode: "test",
    status,
    currencies: ["RUB"],
    methodGroups: ["ru_card"],
    settings: {},
    webhookToken: TOKEN,
    has_secret: sealed,
  };
  if (!sealed) return row;
  const secret = { shopId: "123456", secretKey: "test_secret_key" };
  return {
    ...row,
    ...encryptSecret(JSON.stringify(secret), {
      scope: "connection",
      scopeId: id,
      provider,
      id,
      kek: KEK,
    }),
  };
}

function fakeStore(connections) {
  const events = [];
  return {
    events,
    async connectionById(id) {
      return connections[id] ?? null;
    },
    async recordProviderEvent({ connectionId, providerEventKey, type, payload }) {
      const seen = events.some(
        (row) => row.connectionId === connectionId && row.providerEventKey === providerEventKey,
      );
      if (seen) return false;
      events.push({ connectionId, providerEventKey, type, payload });
      return true;
    },
  };
}

function fakeFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(PAYMENT),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function notification(overrides = {}) {
  return JSON.stringify({
    type: "notification",
    event: "payment.succeeded",
    object: { id: "pay_1", status: "succeeded", ...overrides },
  });
}

async function deliver({ store, connectionId = "conn-1", token = TOKEN, request = fakeRequest({ body: notification() }), fetchImpl = fakeFetch(), env = ENV }) {
  const response = fakeResponse();
  await handlePaymentWebhook({
    request,
    response,
    store,
    connectionId,
    token,
    env,
    log: silent,
    fetchImpl,
  });
  return { response, out: response.out };
}

describe("connection secret (§3.1)", () => {
  it("opens only the row the AAD was built for", () => {
    const connection = connectionFor();
    expect(sealedConnectionRow(connection)).toMatchObject({
      scope: "connection",
      scope_id: connection.id,
      provider: "yookassa",
      id: connection.id,
    });
    expect(openConnectionSecret(connection, { kek: KEK })).toEqual({
      shopId: "123456",
      secretKey: "test_secret_key",
    });
    // The ciphertext is bound to the row: moving it to another id must not decrypt.
    expect(() => openConnectionSecret({ ...connection, id: "conn-2" }, { kek: KEK })).toThrow();
  });

  it("names a missing envelope without quoting anything", () => {
    expect(() => openConnectionSecret({ id: "conn-3", provider: "yookassa" }, { kek: KEK })).toThrow(
      "the connection has no sealed secret",
    );
  });
});

describe("route (§5)", () => {
  it("answers the webhook before any session lookup", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const response = fakeResponse();
    const handled = await handleBilling({
      request: fakeRequest({ method: "GET" }),
      response,
      url: new URL("https://remo.example.test/billing/webhooks/conn-1/hook-token"),
      store,
      env: { ...ENV, REMO_BILLING: "on" },
      log: silent,
    });
    // 405, not the generic 404: the path reached the webhook branch, and no cookie was read.
    expect(handled).toBe(true);
    expect(response.out.status).toBe(405);
  });

  it("answers 404 for the whole family when billing is off", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const response = fakeResponse();
    const handled = await handleBilling({
      request: fakeRequest({ body: notification() }),
      response,
      url: new URL("https://remo.example.test/billing/webhooks/conn-1/hook-token"),
      store,
      env: ENV,
      log: silent,
    });
    expect(handled).toBe(true);
    expect(response.out.status).toBe(404);
    expect(store.events).toHaveLength(0);
  });
});

describe("connection and token (§5)", () => {
  it("answers 404 for an unknown connection", async () => {
    const store = fakeStore({});
    const fetchImpl = fakeFetch();
    const { out } = await deliver({ store, connectionId: "missing", fetchImpl });
    expect(out.status).toBe(404);
    expect(store.events).toHaveLength(0);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("answers 404 for a wrong token, exactly like a missing connection", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const { out } = await deliver({ store, token: "wrong-token" });
    expect(out.status).toBe(404);
    expect(store.events).toHaveLength(0);
  });

  it("answers 404 while the connection is still a draft", async () => {
    const store = fakeStore({ "conn-1": connectionFor({ status: "draft" }) });
    const { out } = await deliver({ store });
    expect(out.status).toBe(404);
    expect(store.events).toHaveLength(0);
  });

  it("rejects a method other than POST on a valid URL", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const { out } = await deliver({ store, request: fakeRequest({ method: "GET" }) });
    expect(out.status).toBe(405);
  });
});

describe("verification (§5)", () => {
  it("answers 401 for a sender outside the allowlist and writes nothing", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const fetchImpl = fakeFetch();
    const { out } = await deliver({
      store,
      request: fakeRequest({ body: notification(), remoteAddress: "203.0.113.9" }),
      fetchImpl,
    });
    expect(out.status).toBe(401);
    expect(store.events).toHaveLength(0);
    // The API is the fact check; a rejected sender never gets that far.
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("answers 500 when the connection has no usable secret", async () => {
    const store = fakeStore({ "conn-1": connectionFor({ sealed: false }) });
    const fetchImpl = fakeFetch();
    const { out } = await deliver({ store, fetchImpl });
    // There is no envelope to open and the adapter refuses to call the API without keys.
    expect(out.status).toBe(500);
    expect(fetchImpl.calls).toHaveLength(0);
    expect(store.events).toHaveLength(0);
  });

  it("verifies a pending notification without writing an event", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ...PAYMENT, status: "pending" }),
    });
    const { out } = await deliver({ store, fetchImpl });
    expect(out.status).toBe(200);
    expect(store.events).toHaveLength(0);
  });
});

describe("inbox (§5)", () => {
  it("records a verified event and answers 200 OK", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const fetchImpl = fakeFetch();
    const { out } = await deliver({ store, fetchImpl });
    expect(out.status).toBe(200);
    expect(out.body).toBe("OK");
    expect(fetchImpl.calls[0].url).toBe("https://api.yookassa.ru/v3/payments/pay_1");
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      connectionId: "conn-1",
      providerEventKey: "payment.succeeded:pay_1:succeeded",
      type: "payment.updated",
    });
    expect(store.events[0].payload.payment).toMatchObject({ amount: 10000, currency: "RUB" });
  });

  it("does not write the same delivery twice", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const first = await deliver({ store });
    const second = await deliver({ store });
    expect(first.out.status).toBe(200);
    expect(second.out.status).toBe(200);
    expect(store.events).toHaveLength(1);
  });

  it("answers 413 before reading a body over 64 KiB", async () => {
    const store = fakeStore({ "conn-1": connectionFor() });
    const fetchImpl = fakeFetch();
    const huge = Buffer.alloc(64 * 1024 + 1, 0x61);
    const { out } = await deliver({ store, request: fakeRequest({ body: huge }), fetchImpl });
    expect(out.status).toBe(413);
    expect(store.events).toHaveLength(0);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

/** The same inbox, plus the chain a saved method needs and the calls it makes. */
function billingStore({ connections, chain = null }) {
  const store = fakeStore(connections);
  store.saved = [];
  store.chainRequests = [];
  store.paymentChainFor = async (paymentId) => {
    store.chainRequests.push(paymentId);
    return chain ? { ...chain, payment_id: paymentId } : null;
  };
  store.savePaymentMethod = async (request) => {
    store.saved.push(request);
    return { id: "pm-saved-1" };
  };
  return store;
}

/** A succeeded payment that also carries a reusable method and our payment id. */
function savedFetch({ metadata = { paymentId: "our-payment-1" } } = {}) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        id: "pay_1",
        status: "succeeded",
        amount: { value: "290.00", currency: "RUB" },
        metadata,
        payment_method: {
          id: "pm_provider_1",
          type: "bank_card",
          saved: true,
          card: {
            card_type: "Visa",
            last4: "4242",
            expiry_month: "12",
            expiry_year: "2030",
          },
        },
      }),
  });
}

const CHAIN = {
  org_id: "org-1",
  invoice_id: "inv-1",
  subscription_id: "sub-1",
  lines: [{ kind: "subscription", autopayConsent: { version: "terms-2026-11" } }],
};

describe("saved method after the first payment (§4)", () => {
  it("stores the sealed reference and the consent version", async () => {
    const store = billingStore({ connections: { "conn-1": connectionFor() }, chain: CHAIN });
    const { out } = await deliver({ store, fetchImpl: savedFetch() });

    expect(out.status).toBe(200);
    expect(store.chainRequests).toEqual(["our-payment-1"]);
    expect(store.saved).toEqual([
      {
        orgId: "org-1",
        connectionId: "conn-1",
        ref: "pm_provider_1",
        display: { kind: "card", brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 },
        consentVersion: "terms-2026-11",
        createdBy: null,
      },
    ]);
  });

  it("applies a delivery once, so a repeat cannot save a second method", async () => {
    const store = billingStore({ connections: { "conn-1": connectionFor() }, chain: CHAIN });
    await deliver({ store, fetchImpl: savedFetch() });
    await deliver({ store, fetchImpl: savedFetch() });

    expect(store.events).toHaveLength(1);
    expect(store.saved).toHaveLength(1);
  });

  it("skips a provider token when no autopay consent was recorded", async () => {
    const store = billingStore({
      connections: { "conn-1": connectionFor() },
      chain: { ...CHAIN, lines: [{ kind: "subscription" }] },
    });
    const { out } = await deliver({ store, fetchImpl: savedFetch() });

    expect(out.status).toBe(200);
    expect(store.saved).toHaveLength(0);
  });

  it("skips a saved method that does not name our payment", async () => {
    const store = billingStore({ connections: { "conn-1": connectionFor() }, chain: CHAIN });
    const { out } = await deliver({ store, fetchImpl: savedFetch({ metadata: {} }) });

    expect(out.status).toBe(200);
    expect(store.chainRequests).toHaveLength(0);
    expect(store.saved).toHaveLength(0);
  });

  it("skips a payment whose chain cannot be found", async () => {
    const store = billingStore({ connections: { "conn-1": connectionFor() }, chain: null });
    const { out } = await deliver({ store, fetchImpl: savedFetch() });

    expect(out.status).toBe(200);
    expect(store.chainRequests).toEqual(["our-payment-1"]);
    expect(store.saved).toHaveLength(0);
  });
});
