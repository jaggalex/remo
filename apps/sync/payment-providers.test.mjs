/**
 * Payment connections without a database: the lifecycle edges, routing predicate, the
 * manual adapter and the public catalogue (ADR-248, `spec/payment-providers.md` §2–§4,
 * `spec/billing.md` §2.1.1, §6).
 *
 * The database half — real SQL priority order, the sealed envelope, the disable guard and
 * the operator grant — is `payment-providers.db.test.mjs`. Everything here is a rule that
 * must hold even when no row exists yet.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  canTransition,
  mapConnection,
  routeMatches,
} from "./pg/payment-providers.mjs";
import { manualAdapter } from "./pay-manual.mjs";
import {
  buildCatalog,
  forSalePrices,
  handleBilling,
  hasCompletePriceList,
} from "./billing-catalog-api.mjs";
import { resetEntitlementCache } from "./billing.mjs";
import { handleBilling as handleBillingEntry } from "./billing-api.mjs";
import { parseProviderArgs, parseSettings } from "../../scripts/billing-providers.mjs";

const ORG = "2f1a6c3e-5b7d-4c8a-9e0f-1a2b3c4d5e6f";

/* ------------------------------------------------------------------ helpers -- */

function fakeResponse() {
  const out = { status: 0, body: null, headers: {} };
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers ?? {};
    },
    end(payload) {
      out.body = payload ? JSON.parse(payload) : null;
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

function fakeRequest(method = "GET", { cookie = "", body = null } = {}) {
  return {
    method,
    headers: cookie ? { cookie } : {},
    async *[Symbol.asyncIterator]() {
      if (body !== null) yield Buffer.from(JSON.stringify(body));
    },
  };
}

const PRICES = ["pro", "team", "business"].flatMap((plan) =>
  ["month", "year"].map((interval) => ({
    plan,
    interval,
    currency: "RUB",
    amount: 29_000,
    version: 1,
    status: "for_sale",
    promo_only: false,
  })),
);

function catalogStore({ prices = PRICES, groups = { RUB: ["invoice"] } } = {}) {
  return {
    async listPrices() {
      return prices;
    },
    async methodGroupsFor({ currency }) {
      return groups[currency] ?? [];
    },
  };
}

function orgStore({ member = true, account = { currency: "RUB" } } = {}) {
  return {
    async withTenant(_orgId, fn) {
      return fn();
    },
    async billingOrg() {
      return { id: ORG, kind: "shared", read_only_at: null };
    },
    async liveSubscription() {
      return null;
    },
    async getOrgMembership(_orgId, userId) {
      return member && userId === "member"
        ? { state: "active", relation: "member" }
        : { state: "removed", relation: "member" };
    },
    async hasOrgRole() {
      return true;
    },
    async seatUsage() {
      return 3;
    },
    async activeRoomCount() {
      return 2;
    },
    async storedBytesForOrg() {
      return 1_234;
    },
    async setFrozenRooms() {},
    async billingAccount() {
      return account;
    },
    async findSession() {
      return {
        id: "session-1",
        user_id: "member",
        email: "member@example.test",
        name: "Member",
        handle: "member",
      };
    },
  };
}

beforeEach(() => {
  resetEntitlementCache();
});

describe("billing entry", () => {
  it("exports the same handler the server wires", () => {
    expect(handleBillingEntry).toBe(handleBilling);
  });
});

/* ------------------------------------------------------------------ routing -- */

describe("connection lifecycle (§2)", () => {
  it("allows the documented edges, including draft → active for manual", () => {
    expect(canTransition("draft", "ready")).toBe(true);
    expect(canTransition("draft", "active")).toBe(true);
    expect(canTransition("ready", "active")).toBe(true);
    expect(canTransition("active", "paused")).toBe(true);
    expect(canTransition("paused", "active")).toBe(true);
    expect(canTransition("active", "retiring")).toBe(true);
    expect(canTransition("retiring", "disabled")).toBe(true);
  });

  it("refuses a jump back and anything out of disabled", () => {
    expect(canTransition("paused", "ready")).toBe(false);
    expect(canTransition("disabled", "active")).toBe(false);
    expect(canTransition("retiring", "active")).toBe(false);
  });
});

describe("routesFor predicate (§3.3)", () => {
  const base = {
    status: "active",
    mode: "live",
    currencies: ["RUB"],
    methodGroups: ["invoice"],
  };

  it("matches only an active connection of the right mode, currency and group", () => {
    const query = { methodGroup: "invoice", currency: "RUB", testMode: false };
    expect(routeMatches(base, query)).toBe(true);
    expect(routeMatches({ ...base, status: "paused" }, query)).toBe(false);
    expect(routeMatches({ ...base, status: "draft" }, query)).toBe(false);
    expect(routeMatches({ ...base, status: "disabled" }, query)).toBe(false);
    expect(routeMatches({ ...base, mode: "test" }, query)).toBe(false);
    expect(routeMatches({ ...base, currencies: ["USD"] }, query)).toBe(false);
    expect(routeMatches({ ...base, methodGroups: ["ru_card"] }, query)).toBe(false);
  });

  it("routes a test-mode payer to the test connection only", () => {
    expect(
      routeMatches({ ...base, mode: "test" }, { methodGroup: "invoice", currency: "RUB", testMode: true }),
    ).toBe(true);
    expect(
      routeMatches(base, { methodGroup: "invoice", currency: "RUB", testMode: true }),
    ).toBe(false);
  });

  it("keeps the column name accepted too, so a raw row needs no translation", () => {
    const raw = { status: "active", mode: "live", currencies: ["RUB"], method_groups: ["invoice"] };
    expect(routeMatches(raw, { methodGroup: "invoice", currency: "RUB", testMode: false })).toBe(true);
  });
});

describe("public connection shape (§1 rule 3)", () => {
  it("never carries the envelope or the webhook token", () => {
    const row = {
      id: "c1",
      provider: "manual",
      name: "Счёт",
      mode: "live",
      status: "active",
      currencies: ["RUB"],
      method_groups: ["invoice"],
      priority: 10,
      settings: { requisites: "р/с 407…" },
      ciphertext: Buffer.from("cipher"),
      nonce: Buffer.from("nonce"),
      dek_wrapped: Buffer.from("dek"),
      dek_nonce: Buffer.from("dek-nonce"),
      kek_id: "v1",
      fingerprint: "abc123",
      webhook_token: "should-not-leak",
    };
    const shown = mapConnection(row);
    expect(shown.has_secret).toBe(true);
    expect(shown.secret_fingerprint).toBe("abc123");
    expect(shown).not.toHaveProperty("ciphertext");
    expect(shown).not.toHaveProperty("webhookToken");
    expect(JSON.stringify(shown)).not.toContain("should-not-leak");
    expect(JSON.stringify(shown)).not.toContain("cipher");
  });

  it("offers the token only when the operator command asks for it", () => {
    const row = { id: "c1", webhook_token: "tok", currencies: [], method_groups: [] };
    expect(mapConnection(row, { withToken: true }).webhookToken).toBe("tok");
  });
});

/* ------------------------------------------------------------- pay-manual -- */

describe("manual adapter (§7)", () => {
  it("declares the manual capabilities", () => {
    expect(manualAdapter.provider).toBe("manual");
    expect(manualAdapter.capabilities).toEqual({
      model: "merchant_scheduled",
      saveMethod: false,
      verifyMethodWithoutCharge: false,
      refunds: "none",
      receipts54fz: false,
      currencies: [],
    });
  });

  it("accepts requisites or instructions and refuses an empty config", () => {
    expect(manualAdapter.validateConfig({ requisites: "р/с 40702810…" })).toEqual([]);
    expect(manualAdapter.validateConfig({ instructions: "Переведите сумму на счёт" })).toEqual([]);
    const problems = manualAdapter.validateConfig({});
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("requisites");
  });

  it("returns instructions instead of a redirect", async () => {
    const conn = { settings: { instructions: "Оплатите счёт", requisites: "р/с 1" } };
    const out = await manualAdapter.createCheckout(conn, { paymentId: "p-1" });
    expect(out.providerPaymentId).toBe("manual:p-1");
    expect(out.redirectUrl).toBeUndefined();
    expect(out.widget).toEqual({ kind: "instructions", text: "Оплатите счёт" });
  });

  it("has no webhooks and no status to poll", async () => {
    expect((await manualAdapter.parseWebhook()).verified).toBe(false);
    expect(await manualAdapter.getPayment({}, "manual:p-1")).toEqual({
      providerPaymentId: "manual:p-1",
      status: "pending",
    });
  });

  it("is healthy without a provider API", async () => {
    expect((await manualAdapter.healthCheck()).ok).toBe(true);
  });
});

/* ---------------------------------------------------------------- catalogue -- */

describe("catalogue hiding rules (§2.1.1)", () => {
  it("needs every paid plan and interval before selling a currency", () => {
    expect(hasCompletePriceList(PRICES, "RUB")).toBe(true);
    const incomplete = PRICES.filter((p) => !(p.plan === "team" && p.interval === "year"));
    expect(hasCompletePriceList(incomplete, "RUB")).toBe(false);
  });

  it("lists one price per plan and interval, highest version", () => {
    const prices = [
      ...PRICES,
      { plan: "pro", interval: "month", currency: "RUB", amount: 34_900, version: 2, status: "for_sale", promo_only: false },
      { plan: "pro", interval: "month", currency: "RUB", amount: 1, version: 3, status: "for_sale", promo_only: true },
    ];
    const pro = forSalePrices(prices, "RUB").find((p) => p.plan === "pro" && p.interval === "month");
    expect(pro.amount).toBe(34_900);
  });

  it("hides a currency with no route and a currency with a gap", () => {
    const incomplete = PRICES.filter((p) => !(p.plan === "team" && p.interval === "year"));
    const catalog = buildCatalog({
      currencies: ["RUB", "USD"],
      prices: incomplete,
      methodGroups: { RUB: ["invoice"], USD: ["ru_card"] },
    });
    expect(catalog.currencies).toEqual([]);
  });

  it("keeps only currencies that can actually be paid", () => {
    const catalog = buildCatalog({
      currencies: ["RUB", "USD"],
      prices: PRICES,
      methodGroups: { RUB: ["invoice"], USD: [] },
    });
    expect(catalog.currencies.map((entry) => entry.currency)).toEqual(["RUB"]);
    expect(catalog.currencies[0].methodGroups).toEqual(["invoice"]);
    expect(catalog.currencies[0].plans.team.seats).toBe(20);
  });

  it("is a 404 for the whole family when billing is off", async () => {
    for (const path of ["/billing/catalog", `/orgs/${ORG}/billing`]) {
      const response = fakeResponse();
      const handled = await handleBilling({
        request: fakeRequest("GET"),
        response,
        url: new URL(`http://localhost${path}`),
        store: catalogStore(),
        env: { REMO_BILLING: "off" },
      });
      expect(handled).toBe(true);
      expect(response.out.status).toBe(404);
    }
  });

  it("serves a currency with routes and a complete price list", async () => {
    const response = fakeResponse();
    await handleBilling({
      request: fakeRequest("GET"),
      response,
      url: new URL("http://localhost/billing/catalog"),
      store: catalogStore(),
      env: { REMO_BILLING: "on", REMO_BILLING_CURRENCIES: "RUB" },
    });
    expect(response.out.status).toBe(200);
    expect(response.out.body.currencies).toHaveLength(1);
    expect(response.out.body.currencies[0].prices).toHaveLength(6);
    expect(response.out.body.currencies[0].plans.pro.rooms).toBeNull();
  });

  it("does not advertise a currency whose price list has a gap", async () => {
    const response = fakeResponse();
    await handleBilling({
      request: fakeRequest("GET"),
      response,
      url: new URL("http://localhost/billing/catalog"),
      store: catalogStore({
        prices: PRICES.filter((p) => !(p.plan === "business" && p.interval === "month")),
      }),
      env: { REMO_BILLING: "on", REMO_BILLING_CURRENCIES: "RUB" },
    });
    expect(response.out.status).toBe(200);
    expect(response.out.body.currencies).toEqual([]);
  });
});

/* -------------------------------------------------------- org billing read -- */

describe("GET /orgs/:id/billing", () => {
  const call = async ({ member = true } = {}) => {
    const response = fakeResponse();
    const handled = await handleBilling({
      request: fakeRequest("GET", { cookie: "remo_session=token" }),
      response,
      url: new URL(`http://localhost/orgs/${ORG}/billing`),
      store: orgStore({ member }),
      env: { REMO_BILLING: "on" },
    });
    return { handled, response };
  };

  it("returns the plan, usage and currency without money", async () => {
    const { handled, response } = await call();
    expect(handled).toBe(true);
    expect(response.out.status).toBe(200);
    expect(response.out.body).toMatchObject({
      plan: "free",
      usage: { seats: 3, rooms: 2 },
      // Storage is a field of the same summary (§7): the bytes this organisation holds
      // and its plan's ceiling. Free's `storageBytes` is still `null` in the catalogue.
      storage: { usedBytes: 1_234, limitBytes: null },
      currency: "RUB",
      subscription: null,
      frozenRooms: [],
      readOnly: false,
    });
    expect(response.out.body.features).toEqual([]);
  });

  it("answers 404 for someone outside the organisation", async () => {
    const { response } = await call({ member: false });
    expect(response.out.status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const response = fakeResponse();
    await handleBilling({
      request: fakeRequest("GET"),
      response,
      url: new URL(`http://localhost/orgs/${ORG}/billing`),
      store: orgStore(),
      env: { REMO_BILLING: "on" },
    });
    expect(response.out.status).toBe(401);
  });

  it("stores the owner's frozen-room choice", async () => {
    const response = fakeResponse();
    await handleBilling({
      request: fakeRequest("PUT", { cookie: "remo_session=token", body: { boardIds: [] } }),
      response,
      url: new URL(`http://localhost/orgs/${ORG}/billing/frozen-rooms`),
      store: orgStore(),
      env: { REMO_BILLING: "on" },
    });
    expect(response.out.status).toBe(200);
    expect(response.out.body.activeRooms).toBe(0);
  });
});

/* ------------------------------------------------------------------ CLI ----- */

describe("billing:providers parsing (§6.2)", () => {
  it("reads the documented create line", () => {
    const args = parseProviderArgs([
      "create",
      "--provider",
      "manual",
      "--mode",
      "live",
      "--currency",
      "RUB",
      "--groups",
      "invoice",
      "--name",
      "Счёт",
      "--activate",
    ]);
    expect(args).toMatchObject({
      command: "create",
      provider: "manual",
      mode: "live",
      currencies: ["RUB"],
      methodGroups: ["invoice"],
      activate: true,
      priority: 100,
    });
  });

  it("accepts repeated currencies and comma-separated groups", () => {
    const args = parseProviderArgs([
      "create",
      "--provider",
      "manual",
      "--mode",
      "test",
      "--currency",
      "rub,usd",
      "--groups",
      "invoice,foreign_card",
      "--name",
      "x",
    ]);
    expect(args.currencies).toEqual(["RUB", "USD"]);
    expect(args.methodGroups).toEqual(["invoice", "foreign_card"]);
  });

  it("refuses a lifecycle move without a reason", () => {
    expect(() => parseProviderArgs(["pause", ORG])).toThrow(/--reason/);
    const args = parseProviderArgs(["disable", ORG, "--reason", "closed the shop"]);
    expect(args).toMatchObject({ command: "disable", id: ORG, to: "disabled" });
  });

  it("refuses an unknown group, mode and provider before touching a database", () => {
    const base = ["create", "--mode", "live", "--currency", "RUB", "--name", "x"];
    expect(() =>
      parseProviderArgs([...base, "--provider", "manual", "--groups", "crypto"]),
    ).toThrow(/--groups/);
    expect(() =>
      parseProviderArgs(["create", "--provider", "manual", "--mode", "prod", "--currency", "RUB", "--groups", "invoice", "--name", "x"]),
    ).toThrow(/--mode/);
    expect(() =>
      parseProviderArgs(["create", "--provider", "stripe", "--mode", "live", "--currency", "RUB", "--groups", "invoice", "--name", "x"]),
    ).toThrow(/--provider/);
  });

  it("requires a connection id", () => {
    expect(() => parseProviderArgs(["webhook-url"])).toThrow(/connection id/);
    expect(() => parseProviderArgs(["set", "nope", "--priority", "10"])).toThrow(/connection id/);
  });

  it("parses settings as typed key=value pairs", () => {
    expect(parseSettings("vat_code=1,receipt=true,note=hello")).toEqual({
      vat_code: 1,
      receipt: true,
      note: "hello",
    });
    expect(() => parseSettings("broken")).toThrow(/key=value/);
    // A long account number is text; parsing it as a number would drop its tail.
    expect(parseSettings("account=40702810123456789012")).toEqual({
      account: "40702810123456789012",
    });
  });
});
