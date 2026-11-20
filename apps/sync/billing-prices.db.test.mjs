/**
 * Price-book behaviour against a real database (ADR-247, `spec/billing.md` §2.1.2, §5).
 *
 * What a parser test cannot prove: `addPrice` really numbers versions, `publishPrice`
 * ends the previous `for_sale` row inside one transaction (`prices_for_sale_idx` would
 * reject two), promotion-only prices live beside the public one, and `checkPriceLists`
 * finds every missing pair for a currency the operator has not finished selling.
 *
 * `prices` and `price_events` are installation-level tables, so the suite uses XTS (the
 * ISO 4217 test code) and ZZZ and removes only its own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("billing price lists");
const store = opened?.store ?? null;

const CURRENCY = "XTS";
const UNSOLD = "ZZZ";

let counter = 0;

function nextId(plan, interval) {
  counter += 1;
  return `${plan}-xts-${interval}-test-${counter}`;
}

async function add(plan, interval, amount, extra = {}) {
  return store.addPrice({
    id: nextId(plan, interval),
    plan,
    interval,
    currency: CURRENCY,
    amount,
    ...extra,
  });
}

/** Remove the fixture's rows; `price_events` references `prices`, so it goes first. */
async function clear() {
  await store.pool.query(
    `delete from price_events
      where price_id in (select id from prices where currency = any($1::text[]))`,
    [[CURRENCY, UNSOLD]],
  );
  await store.pool.query("delete from prices where currency = any($1::text[])", [
    [CURRENCY, UNSOLD],
  ]);
}

describe.skipIf(!store)("db:billing price lists (ADR-247)", () => {
  beforeAll(async () => {
    await clear();
  });

  afterAll(async () => {
    if (!store) return;
    await clear();
    await store.close();
  });

  it("creates a draft and keeps it out of the sale", async () => {
    const price = await store.addPrice({
      id: "pro-xts-month-v1",
      plan: "pro",
      interval: "month",
      currency: CURRENCY,
      amount: 29000,
    });

    expect(price).toMatchObject({
      id: "pro-xts-month-v1",
      plan: "pro",
      interval: "month",
      currency: CURRENCY,
      amount: 29000,
      version: 1,
      status: "draft",
      promo_only: false,
    });
    // node-postgres returns bigint as text; the method hands callers a number.
    expect(typeof price.amount).toBe("number");
    await expect(store.priceForSale({ plan: "pro", currency: CURRENCY })).resolves.toBeNull();
  });

  it("numbers the next version above the previous one", async () => {
    const price = await add("pro", "month", 34900);

    expect(price.version).toBe(2);
    expect(price.status).toBe("draft");
  });

  it("publishing a version takes the previous one off sale", async () => {
    await store.publishPrice("pro-xts-month-v1");

    let forSale = await store.priceForSale({ plan: "pro", interval: "month", currency: CURRENCY });
    expect(forSale.id).toBe("pro-xts-month-v1");

    const v2 = (await store.listPrices({ currency: CURRENCY })).find(
      (row) => row.plan === "pro" && row.interval === "month" && row.version === 2,
    );
    await store.publishPrice(v2.id);

    forSale = await store.priceForSale({ plan: "pro", interval: "month", currency: CURRENCY });
    expect(forSale.id).toBe(v2.id);
    expect(forSale.amount).toBe(34900);

    const { rows: statuses } = await store.pool.query(
      "select id, status from prices where currency = $1 and plan = 'pro' and interval = 'month'",
      [CURRENCY],
    );
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: "pro-xts-month-v1", status: "sale_ended" },
        { id: v2.id, status: "for_sale" },
      ]),
    );

    const { rows: events } = await store.pool.query(
      `select price_id, type from price_events
        where price_id = any($1::text[]) order by occurred_at, type`,
      [["pro-xts-month-v1", v2.id]],
    );
    expect(events).toEqual(
      expect.arrayContaining([
        { price_id: "pro-xts-month-v1", type: "published" },
        { price_id: "pro-xts-month-v1", type: "sale_ended" },
        { price_id: v2.id, type: "published" },
      ]),
    );
  });

  it("a promo-only price is published beside the public one, not instead of it", async () => {
    const promo = await add("pro", "month", 19000, { promoOnly: true });
    const published = await store.publishPrice(promo.id);

    expect(published).toMatchObject({ status: "for_sale", promo_only: true });

    const forSale = await store.priceForSale({ plan: "pro", interval: "month", currency: CURRENCY });
    expect(forSale.promo_only).toBe(false);
    expect(forSale.amount).toBe(34900);
  });

  it("lists one currency with integer amounts", async () => {
    const rows = await store.listPrices({ currency: CURRENCY });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.currency === CURRENCY)).toBe(true);
    expect(rows.every((row) => Number.isSafeInteger(row.amount))).toBe(true);
  });

  it("reports every pair a currency is missing", async () => {
    const report = await store.checkPriceLists([CURRENCY, UNSOLD]);
    const partial = report.find((entry) => entry.currency === CURRENCY);
    const empty = report.find((entry) => entry.currency === UNSOLD);

    expect(partial.missing).toEqual([
      "pro/year",
      "team/month",
      "team/year",
      "business/month",
      "business/year",
    ]);
    expect(partial.missing).not.toContain("pro/month");
    expect(empty.missing).toHaveLength(6);
  });

  it("is complete once every paid plan sells both intervals", async () => {
    for (const plan of ["pro", "team", "business"]) {
      for (const interval of ["month", "year"]) {
        const forSale = await store.priceForSale({ plan, interval, currency: CURRENCY });
        if (forSale) continue;
        const draft = await add(plan, interval, interval === "month" ? 29000 : 290000);
        await store.publishPrice(draft.id);
      }
    }

    const report = await store.checkPriceLists([CURRENCY]);
    expect(report).toEqual([{ currency: CURRENCY, missing: [] }]);
  });

  it("refuses a negative amount before it reaches the check constraint", async () => {
    await expect(
      store.addPrice({
        id: "pro-xts-month-negative",
        plan: "pro",
        interval: "month",
        currency: CURRENCY,
        amount: -1,
      }),
    ).rejects.toThrow(/positive integer/);
  });
});
