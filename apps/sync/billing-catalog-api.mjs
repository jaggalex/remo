/**
 * The billing HTTP surface, stage 2: the public catalogue, the organisation's billing
 * summary and the frozen-room switch (ADR-247 §2.1.1, `spec/billing.md` §6).
 *
 * This file owns only what can be answered before checkout exists: which currencies and
 * payment methods an anonymous visitor may be offered, and what plan an organisation is
 * on. Money — invoices, payments, refunds — stays in the money module when it lands; no
 * route here invents an amount or a balance.
 *
 * `REMO_BILLING=off` is the self-host default. Every route in this family is then a
 * `404`, not an empty catalogue: the feature is absent, not "not configured yet".
 */
import { billingEnabled, entitlementsFor } from "./billing.mjs";
import { handleFakeBilling } from "./billing-fake-api.mjs";
import { checkPromo, handleCheckoutRoutes } from "./billing-checkout-api.mjs";
import { handleSubscriptionRoutes } from "./billing-subscription-api.mjs";
import { PLAN_NAMES, PLANS } from "./billing-catalog.mjs";
import { handlePaymentWebhook } from "./payment-webhooks.mjs";
import { PAID_PLANS, billingCurrencies } from "../../scripts/billing-prices.mjs";
import { fail, json, sessionFromRequest } from "./iam-http.mjs";
import { readJsonBody } from "./http-body.mjs";

const INTERVALS = Object.freeze(["month", "year"]);
const CURRENCY = /^[A-Z]{3}$/;

/** The limit fields of a plan, and nothing else: `trialDays` is not an entitlement. */
function planLimits(plans = PLANS) {
  return Object.fromEntries(
    PLAN_NAMES.map((name) => [
      name,
      {
        seats: plans[name].seats,
        rooms: plans[name].rooms,
        agentTasksPerMonth: plans[name].agentTasksPerMonth,
        trashDays: plans[name].trashDays,
        storageBytes: plans[name].storageBytes,
      },
    ]),
  );
}

/**
 * Prices a new buyer may pay. A promotion-only version never answers here: it is
 * reachable only through a promo code, so a public catalogue lists one amount per
 * (plan, interval, currency). The highest version wins if a database was edited by hand.
 */
export function forSalePrices(prices, currency) {
  const best = new Map();
  for (const price of prices) {
    if (price.currency !== currency) continue;
    if (price.status !== "for_sale" || price.promo_only) continue;
    const key = `${price.plan}/${price.interval}`;
    const seen = best.get(key);
    if (!seen || Number(price.version) > Number(seen.version)) best.set(key, price);
  }
  return [...best.values()]
    .sort((a, b) => {
      const plan = PLAN_NAMES.indexOf(a.plan) - PLAN_NAMES.indexOf(b.plan);
      if (plan !== 0) return plan;
      return INTERVALS.indexOf(a.interval) - INTERVALS.indexOf(b.interval);
    })
    .map((price) => ({
      id: price.id,
      plan: price.plan,
      interval: price.interval,
      amount: Number(price.amount),
      currency: price.currency,
    }));
}

/**
 * A currency is sold only with a complete price list (§2.1.1): every paid plan and every
 * interval needs a `for_sale` amount. A missing line hides the whole currency instead of
 * showing a tariff the payer cannot buy.
 */
export function hasCompletePriceList(prices, currency, { plans = PAID_PLANS, intervals = INTERVALS } = {}) {
  const available = new Set(
    prices
      .filter(
        (price) => price.currency === currency && price.status === "for_sale" && !price.promo_only,
      )
      .map((price) => `${price.plan}/${price.interval}`),
  );
  return plans.every((plan) => intervals.every((interval) => available.has(`${plan}/${interval}`)));
}

/**
 * The catalogue body, pure so the two hiding rules — no payment route, incomplete price
 * list — are testable without a database. `methodGroups` is `{ RUB: ["invoice"] }`.
 */
export function buildCatalog({ currencies, prices, methodGroups, plans = PLANS }) {
  const limits = planLimits(plans);
  const offered = [];
  for (const currency of currencies) {
    const groups = methodGroups[currency] ?? [];
    if (groups.length === 0) continue;
    if (!hasCompletePriceList(prices, currency)) continue;
    offered.push({
      currency,
      prices: forSalePrices(prices, currency),
      methodGroups: groups,
      plans: limits,
    });
  }
  return { currencies: offered };
}

function subscriptionDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    plan: row.plan,
    status: row.status,
    interval: row.interval,
    amount: Number(row.amount),
    currency: row.currency,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end ?? null,
  };
}

/**
 * The five display facts of a saved method, rebuilt field by field (§1 rule 9). The store
 * row also carries the sealed provider reference; it stops here, because what the screen
 * shows is all a client may ever see.
 */
function paymentMethodDto(method) {
  const display = method?.display;
  if (!display) return null;
  return {
    kind: display.kind ?? null,
    brand: display.brand ?? null,
    last4: display.last4 ?? null,
    expMonth: display.expMonth ?? null,
    expYear: display.expYear ?? null,
  };
}

/**
 * @returns {Promise<boolean>} true when the request belonged to the billing surface.
 */
export async function handleBilling({
  request,
  response,
  url,
  store,
  log = console,
  env = process.env,
}) {
  const isCatalog = url.pathname === "/billing/catalog";
  const orgMatch = /^\/orgs\/([^/]+)\/billing(?:\/(.*))?$/.exec(url.pathname);
  // Storage is a read of the same tenant rows the billing page sums, so it lives in this
  // family: with billing off there is no quota and no page to show it on (§9.8).
  const storageMatch = /^\/orgs\/([^/]+)\/storage$/.exec(url.pathname);
  const isBillingPath = url.pathname === "/billing" || url.pathname.startsWith("/billing/");
  if (!isCatalog && !orgMatch && !storageMatch && !isBillingPath) return false;

  if (!billingEnabled(env)) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }

  const method = request.method ?? "GET";

  // The development fake provider answers 404 unless its gate is on; the call comes
  // before every session-bearing route because its two paths carry no organisation.
  if (await handleFakeBilling({ request, response, url, store, env })) return true;

  // Provider webhooks carry a connection token instead of a session, so they are handled
  // before the organisation match. Billing being off still answers 404 above: the whole
  // family is absent, and a live webhook URL must not survive a feature switch.
  const webhookMatch = /^\/billing\/webhooks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (webhookMatch) {
    if (method !== "POST") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "use POST");
      return true;
    }
    let connectionId;
    let token;
    try {
      connectionId = decodeURIComponent(webhookMatch[1]);
      token = decodeURIComponent(webhookMatch[2]);
    } catch {
      fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
      return true;
    }
    return handlePaymentWebhook({ request, response, store, connectionId, token, env });
  }

  if (url.pathname === "/billing/promo/check" && method === "POST") {
    if (typeof store.promoByCode !== "function" || typeof store.priceById !== "function") {
      fail(response, 501, "BILLING_UNAVAILABLE", "the price book needs the postgres store");
      return true;
    }
    return checkPromo({ request, response, store });
  }

  /* --------------------------------------------------------------- catalog -- */

  if (isCatalog) {
    if (method !== "GET") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "the catalogue is read-only");
      return true;
    }
    if (typeof store.listPrices !== "function" || typeof store.methodGroupsFor !== "function") {
      fail(response, 501, "BILLING_UNAVAILABLE", "the catalogue needs the postgres store");
      return true;
    }

    const requested = url.searchParams.get("currency");
    const available = billingCurrencies(env);
    let currencies = available;
    if (requested !== null && requested.trim() !== "") {
      const code = requested.trim().toUpperCase();
      if (!CURRENCY.test(code)) {
        fail(response, 422, "BAD_CURRENCY", "currency must be a three-letter ISO 4217 code");
        return true;
      }
      currencies = available.includes(code) ? [code] : [];
    }

    const prices = await store.listPrices({});
    const methodGroups = {};
    for (const currency of currencies) {
      // The public catalogue is for new buyers, so it offers live routes only: a test
      // connection must never appear as a way to pay real money.
      methodGroups[currency] = await store.methodGroupsFor({ currency, testMode: false });
    }
    json(response, 200, buildCatalog({ currencies, prices, methodGroups }));
    return true;
  }

  /* -------------------------------------------------- organisation billing -- */

  const orgPath = orgMatch ?? storageMatch;
  if (!orgPath) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }

  let orgId;
  try {
    orgId = decodeURIComponent(orgPath[1]);
  } catch {
    fail(response, 400, "BAD_REQUEST", "the organisation id is not valid");
    return true;
  }
  const rest = orgMatch?.[2] ?? "";

  if (typeof store.findSession !== "function" || typeof store.getOrgMembership !== "function") {
    fail(response, 501, "BILLING_UNAVAILABLE", "billing needs the postgres store");
    return true;
  }

  const session = await sessionFromRequest(request, store);
  if (!session) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return true;
  }
  // A stranger gets the same answer as a missing organisation: whether an id exists is
  // not something an outsider may learn from the billing page.
  const membership = await store.getOrgMembership(orgId, session.user.id);
  if (!membership || membership.state !== "active") {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }

  if (storageMatch) {
    if (method !== "GET") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "the storage view is read-only");
      return true;
    }
    // The list names rooms, so it is for the people who administer the organisation
    // (§9.8); a member sees the total on the plan tab and asks the owner.
    const admin = await store.hasOrgRole(orgId, session.user.id, "org_admin");
    if (!admin) {
      fail(response, 403, "FORBIDDEN", "only the owner or an organisation admin sees the rooms");
      return true;
    }
    if (
      typeof store.storedBytesForOrg !== "function" ||
      typeof store.storageByRoom !== "function"
    ) {
      fail(response, 501, "BILLING_UNAVAILABLE", "storage needs the postgres store");
      return true;
    }
    const entitlements = await entitlementsFor(store, orgId, { env });
    // The same sum the upload's quota check reads, plus the top rooms under the same
    // tenant. `null` is "no limit", the spelling the rest of the family uses.
    const [usedBytes, rooms] = await Promise.all([
      store.storedBytesForOrg(),
      store.storageByRoom(5),
    ]);
    json(response, 200, {
      usedBytes,
      limitBytes: entitlements.limits.storageBytes ?? null,
      rooms,
    });
    return true;
  }

  if (rest !== "" && (await handleCheckoutRoutes({ request, response, url, store, orgId, rest }))) {
    return true;
  }

  const subscriptionRoutes = await handleSubscriptionRoutes({
    request,
    response,
    store,
    orgId,
    rest,
    session,
  });
  if (subscriptionRoutes) return true;

  if (rest === "") {
    if (method !== "GET") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "use PUT /orgs/:id/billing/frozen-rooms");
      return true;
    }
    const entitlements = await entitlementsFor(store, orgId, { env });
    // §3.2: a member sees the plan and the limits; the card is the payer's data.
    const isAdmin = await store.hasOrgRole(orgId, session.user.id, "org_admin");
    const [seats, rooms, storedBytes, subscription, account, savedMethod] = await Promise.all([
      store.seatUsage(orgId),
      store.activeRoomCount(orgId),
      // §7 of the image spec: usage is the same row sum the upload's quota check reads,
      // so the screen never needs a second route or a second definition of "stored".
      // A store from before `files` answers zero, exactly like an organisation with no
      // pictures, rather than failing the whole page.
      typeof store.storedBytesForOrg === "function" ? store.storedBytesForOrg() : 0,
      store.liveSubscription(orgId),
      // The money module owns `billing_accounts`. The guard keeps this page readable
      // before that module is registered (an earlier stage or a test double): no account
      // means no currency yet, never a guessed one.
      typeof store.billingAccount === "function" ? store.billingAccount(orgId) : null,
      // The card is the money module's row too; the same guard keeps an older store
      // readable instead of failing the whole page.
      typeof store.paymentMethod === "function" ? store.paymentMethod(orgId) : null,
    ]);
    // `read_only_at` lives on `orgs`; the billing read includes it once the org read
    // selects the column. A missing column is "not read-only", never an error.
    const org = typeof store.billingOrg === "function" ? await store.billingOrg(orgId) : null;

    // Credit lives in the organisation's one currency (§2.1.1); without a currency there
    // is no balance to name, and a zero balance is not shown at all (§8.1).
    let credit = null;
    if (account?.currency && typeof store.creditBalance === "function") {
      const amount = await store.creditBalance(orgId, account.currency);
      if (amount !== 0) credit = { amount, currency: account.currency };
    }

    json(response, 200, {
      plan: entitlements.plan,
      status: entitlements.status,
      limits: entitlements.limits,
      features: [...entitlements.features],
      usage: { seats, rooms },
      // `null` is "no limit", the same spelling the catalogue and the upload use; when
      // billing is off the family is a 404 and this body never answers (`spec/images.md` §7).
      storage: { usedBytes: storedBytes, limitBytes: entitlements.limits.storageBytes ?? null },
      subscription: subscriptionDto(subscription),
      currency: account?.currency ?? null,
      paymentMethod: isAdmin ? paymentMethodDto(savedMethod) : null,
      credit,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
      trialEnd: subscription?.trial_end ?? null,
      // The chooser is not shipped yet; the PUT below says so. Frozen rooms are still
      // reconciled by the plan guard, so the list is a view that arrives with the UI.
      frozenRooms: [],
      readOnly: Boolean(org?.read_only_at),
    });
    return true;
  }

  if (rest === "frozen-rooms") {
    if (method !== "PUT") {
      fail(response, 405, "METHOD_NOT_ALLOWED", "use PUT");
      return true;
    }
    const admin = await store.hasOrgRole(orgId, session.user.id, "org_admin");
    if (!admin) {
      fail(response, 403, "FORBIDDEN", "only the owner or an organisation admin can choose rooms");
      return true;
    }
    const body = await readJsonBody(request);
    if (!body || !Array.isArray(body.boardIds)) {
      fail(response, 422, "BAD_BOARD_LIST", "expected { boardIds: string[] }");
      return true;
    }
    const entitlements = await entitlementsFor(store, orgId, { env });
    const max = entitlements.limits.rooms;
    if (max !== null && body.boardIds.length > max) {
      fail(response, 422, "BAD_BOARD_LIST", `the plan keeps at most ${max} active rooms`);
      return true;
    }
    try {
      await store.setFrozenRooms(orgId, body.boardIds.map(String));
    } catch (error) {
      if (error?.code === "BOARD_NOT_FOUND") {
        fail(response, 404, "RESOURCE_NOT_AVAILABLE", "a room does not belong to this organisation");
        return true;
      }
      throw error;
    }
    log.log(`[billing] ${orgId}: ${body.boardIds.length} room(s) left active by the owner`);
    json(response, 200, { activeRooms: body.boardIds.length });
    return true;
  }

  fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
  return true;
}
