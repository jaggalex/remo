/**
 * Money arithmetic without a database (ADR-247, `spec/billing.md` §3.4, §3.5, §4, §11).
 *
 * The table-driven cases below are the contract the store and the routes rely on:
 * invoice numbers, period boundaries (including leap day and month end), proration
 * rounded down, the invoice total never below zero, and every promotion refusal that a
 * checkout can show to a customer.
 */
import { describe, expect, it } from "vitest";
import {
  assertMinorUnits,
  invoiceNumber,
  periodEnd,
  priceInvoice,
  promoDiscount,
  prorationCredit,
} from "./billing-money.mjs";

const NOW = new Date("2026-11-20T12:00:00.000Z");

describe("invoiceNumber", () => {
  it.each([
    [{ year: 2026, seq: 123 }, "RU-2026-000123"],
    [{ year: 2026, seq: 1 }, "RU-2026-000001"],
    [{ year: 2026, seq: 999_999 }, "RU-2026-999999"],
    [{ year: 2026, seq: 42, region: "eu" }, "EU-2026-000042"],
    [{ year: 2024, seq: 7, region: "RU" }, "RU-2024-000007"],
  ])("formats %o as %s", (input, expected) => {
    expect(invoiceNumber(input)).toBe(expected);
  });

  it.each([
    [{ year: 2026, seq: 0 }],
    [{ year: 2026, seq: -1 }],
    [{ year: 2026, seq: 1_000_000 }],
    [{ year: 2026, seq: 1.5 }],
    [{ year: 26, seq: 1 }],
    [{ year: 2026.5, seq: 1 }],
    [{ year: 2026, seq: 1, region: "RUS" }],
    [{ year: 2026, seq: 1, region: "1U" }],
  ])("refuses %o", (input) => {
    expect(() => invoiceNumber(input)).toThrow();
  });
});

describe("periodEnd", () => {
  it.each([
    [
      "2026-01-15T10:30:45.123Z",
      "month",
      "2026-02-15T10:30:45.123Z",
      "keeps the wall clock",
    ],
    ["2026-01-31T00:00:00.000Z", "month", "2026-02-28T00:00:00.000Z", "clamps January 31"],
    ["2024-01-31T00:00:00.000Z", "month", "2024-02-29T00:00:00.000Z", "uses the leap day"],
    ["2024-02-29T00:00:00.000Z", "month", "2024-03-29T00:00:00.000Z", "leap day plus month"],
    ["2024-02-29T00:00:00.000Z", "year", "2025-02-28T00:00:00.000Z", "leap day plus year"],
    ["2028-02-29T00:00:00.000Z", "year", "2029-02-28T00:00:00.000Z", "next year is not leap"],
    ["2026-03-31T00:00:00.000Z", "month", "2026-04-30T00:00:00.000Z", "April is shorter"],
    ["2026-12-31T00:00:00.000Z", "month", "2027-01-31T00:00:00.000Z", "crosses the year"],
    ["2026-12-31T23:59:59.999Z", "year", "2027-12-31T23:59:59.999Z", "year boundary"],
  ])("%s + %s = %s (%s)", (start, interval, expected) => {
    expect(periodEnd(new Date(start), interval).toISOString()).toBe(expected);
  });

  it("does not mutate the input", () => {
    const start = new Date("2026-01-31T08:00:00.000Z");
    const before = start.getTime();

    periodEnd(start, "month");

    expect(start.getTime()).toBe(before);
  });

  it("accepts a date-like input and returns a new Date", () => {
    const result = periodEnd("2026-01-31T00:00:00Z", "month");

    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("refuses an unknown interval and an invalid date", () => {
    expect(() => periodEnd(new Date("2026-01-01T00:00:00Z"), "week")).toThrow(RangeError);
    expect(() => periodEnd("not a date", "month")).toThrow(TypeError);
  });
});

describe("prorationCredit", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const end = "2026-02-01T00:00:00.000Z";

  it.each([
    [{ at: "2025-12-31T23:59:59.999Z" }, 0, "before the period"],
    [{ at: start }, 0, "exactly at the start"],
    [{ at: "2026-01-17T00:00:00.000Z" }, 483, "15 of 31 days"],
    [{ at: "2026-01-16T00:00:00.000Z" }, 516, "rounds 516.129 down"],
    [{ at: "2026-01-15T12:00:00.000Z" }, 532, "rounds 532.258 down"],
    [{ at: "2026-01-31T12:00:00.000Z" }, 16, "half a day is still rounded down"],
    [{ at: end }, 1000, "exactly at the end"],
    [{ at: "2026-02-02T00:00:00.000Z" }, 1000, "after the end"],
  ])("credits $1 for $0 ($2)", ({ at }, expected) => {
    const credit = prorationCredit({
      amount: 1000,
      periodStart: start,
      periodEnd: end,
      at,
    });

    expect(credit).toBe(expected);
    expect(Number.isSafeInteger(credit)).toBe(true);
  });

  it("uses the real length of February in a leap year", () => {
    expect(
      prorationCredit({
        amount: 2900,
        periodStart: "2024-02-01T00:00:00.000Z",
        periodEnd: "2024-03-01T00:00:00.000Z",
        at: "2024-02-15T00:00:00.000Z",
      }),
    ).toBe(1500);
  });

  it("computes the exact case used by the price table", () => {
    expect(
      prorationCredit({
        amount: 3100,
        periodStart: start,
        periodEnd: end,
        at: "2026-01-17T00:00:00.000Z",
      }),
    ).toBe(1500);
  });

  it("does not mutate any date it was given", () => {
    const periodStart = new Date(start);
    const periodEndDate = new Date(end);
    const at = new Date("2026-01-16T00:00:00.000Z");

    prorationCredit({ amount: 1000, periodStart, periodEnd: periodEndDate, at });

    expect(periodStart.toISOString()).toBe(start);
    expect(periodEndDate.toISOString()).toBe(end);
    expect(at.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  it("refuses an empty period and a fractional amount", () => {
    expect(() =>
      prorationCredit({
        amount: 1000,
        periodStart: end,
        periodEnd: start,
        at: start,
      }),
    ).toThrow(RangeError);
    expect(() =>
      prorationCredit({
        amount: 10.5,
        periodStart: start,
        periodEnd: end,
        at: start,
      }),
    ).toThrow(RangeError);
    expect(() =>
      prorationCredit({
        amount: -1,
        periodStart: start,
        periodEnd: end,
        at: start,
      }),
    ).toThrow(RangeError);
  });

  it("credits zero for a zero invoice", () => {
    expect(
      prorationCredit({ amount: 0, periodStart: start, periodEnd: end, at: "2026-01-16T00:00:00Z" }),
    ).toBe(0);
  });
});

describe("priceInvoice", () => {
  it.each([
    [{ amount: 29000 }, { subtotal: 29000, discount: 0, creditApplied: 0, total: 29000 }],
    [
      { amount: 29000, discount: 3000, credit: 1000 },
      { subtotal: 29000, discount: 3000, creditApplied: 1000, total: 25000 },
    ],
    [
      { amount: 29000, discount: 28000, credit: 5000 },
      { subtotal: 29000, discount: 28000, creditApplied: 1000, total: 0 },
    ],
    [
      { amount: 1000, discount: 2000 },
      { subtotal: 1000, discount: 1000, creditApplied: 0, total: 0 },
    ],
    [
      { amount: 1000, discount: 2000, credit: 500 },
      { subtotal: 1000, discount: 1000, creditApplied: 0, total: 0 },
    ],
    [
      { amount: 0, discount: 100, credit: 100 },
      { subtotal: 0, discount: 0, creditApplied: 0, total: 0 },
    ],
    [
      { amount: 100, discount: 100, credit: 100 },
      { subtotal: 100, discount: 100, creditApplied: 0, total: 0 },
    ],
  ])("prices %o", (input, expected) => {
    expect(priceInvoice(input)).toEqual(expected);
  });

  it("never returns a float or a negative field", () => {
    const invoice = priceInvoice({ amount: 10001, discount: 3333, credit: 9999 });
    for (const value of Object.values(invoice)) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses negative and fractional inputs", () => {
    expect(() => priceInvoice({ amount: -1 })).toThrow(RangeError);
    expect(() => priceInvoice({ amount: 1, discount: 2.5 })).toThrow(RangeError);
    expect(() => priceInvoice({ amount: 1, credit: -2 })).toThrow(RangeError);
  });
});

describe("promoDiscount", () => {
  const percent = (value, extra = {}) => ({ kind: "percent", value, ...extra });
  const amountCode = (value, extra = {}) => ({ kind: "amount", value, currency: "RUB", ...extra });

  it.each([
    [percent(30), 29000, "RUB", 8700],
    [percent(33), 10001, "RUB", 3300],
    [percent(1), 100, "RUB", 1],
    [percent(100), 29000, "RUB", 29000],
    [percent(30), 0, "RUB", 0],
    [percent(30, { currency: "RUB" }), 29000, "USD", 8700],
    [amountCode(10000), 29000, "RUB", 10000],
    [amountCode(10000), 5000, "RUB", 5000],
    [amountCode(10000, { currency: "rub" }), 29000, "RUB", 10000],
    [{ kind: "price_override", targetAmount: 20000 }, 29000, "RUB", 9000],
    [{ kind: "price_override", targetAmount: 40000 }, 29000, "RUB", 0],
    [{ kind: "price_override", target_amount: 20000, target_currency: "rub" }, 29000, "RUB", 9000],
    [{ kind: "price_override", targetAmount: 20000, targetCurrency: "USD" }, 29000, "USD", 9000],
  ])("applies %o to %i %s", (promo, amount, currency, expected) => {
    expect(promoDiscount({ promo, amount, currency, now: NOW })).toEqual({
      ok: true,
      discount: expected,
    });
  });

  it.each([
    [percent(0), "PROMO_INVALID"],
    [percent(101), "PROMO_INVALID"],
    [percent(30.5), "PROMO_INVALID"],
    [percent("30"), "PROMO_INVALID"],
    [{ kind: "percent" }, "PROMO_INVALID"],
    [{ kind: "unknown", value: 10 }, "PROMO_INVALID"],
    [null, "PROMO_INVALID"],
    [{ kind: "amount", value: 100 }, "PROMO_INVALID"],
    [{ kind: "amount", value: 0, currency: "RUB" }, "PROMO_INVALID"],
    [{ kind: "amount", value: 10.5, currency: "RUB" }, "PROMO_INVALID"],
    [{ kind: "price_override" }, "PROMO_INVALID"],
    [{ kind: "price_override", targetAmount: "20000" }, "PROMO_INVALID"],
    [{ kind: "price_override", targetAmount: -1 }, "PROMO_INVALID"],
  ])("refuses %o as %s", (promo, code) => {
    expect(promoDiscount({ promo, amount: 29000, currency: "RUB", now: NOW })).toEqual({
      ok: false,
      code,
    });
  });

  it("reports a currency mismatch for a fixed amount", () => {
    expect(
      promoDiscount({ promo: amountCode(10000), amount: 29000, currency: "USD", now: NOW }),
    ).toEqual({ ok: false, code: "PROMO_CURRENCY_MISMATCH" });
  });

  it("accepts the invoice currency carried on the promo", () => {
    expect(
      promoDiscount({
        promo: amountCode(10000, { priceCurrency: "RUB" }),
        amount: 29000,
        now: NOW,
      }),
    ).toEqual({ ok: true, discount: 10000 });
    expect(
      promoDiscount({
        promo: amountCode(10000, { priceCurrency: "USD" }),
        amount: 29000,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "PROMO_CURRENCY_MISMATCH" });
  });

  it("reports a currency mismatch for a price override target", () => {
    expect(
      promoDiscount({
        promo: { kind: "price_override", targetAmount: 20000, targetCurrency: "USD" },
        amount: 29000,
        currency: "RUB",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "PROMO_CURRENCY_MISMATCH" });
  });

  it.each([
    [{ expiresAt: "2026-11-19T00:00:00.000Z" }, "PROMO_EXPIRED"],
    [{ expiresAt: "2026-11-20T12:00:00.000Z" }, "PROMO_EXPIRED"],
    [{ expires_at: "2026-11-19T00:00:00.000Z" }, "PROMO_EXPIRED"],
    [{ maxRedemptions: 5, redeemed: 5 }, "PROMO_NOT_APPLICABLE"],
    [{ max_redemptions: 0, redeemed: 0 }, "PROMO_NOT_APPLICABLE"],
    [{ disabled: true }, "PROMO_NOT_APPLICABLE"],
    [{ active: false }, "PROMO_NOT_APPLICABLE"],
    [{ currencies: ["USD"] }, "PROMO_NOT_APPLICABLE"],
    [{ currencies: ["USD", "EUR"] }, "PROMO_NOT_APPLICABLE"],
  ])("refuses %o with %s", (extra, code) => {
    expect(
      promoDiscount({ promo: percent(30, extra), amount: 29000, currency: "RUB", now: NOW }),
    ).toEqual({ ok: false, code });
  });

  it("accepts a live code inside its redemption limit and currency list", () => {
    expect(
      promoDiscount({
        promo: percent(30, {
          maxRedemptions: 5,
          redeemed: 4,
          currencies: ["RUB", "USD"],
          expiresAt: "2026-11-21T00:00:00.000Z",
        }),
        amount: 29000,
        currency: "RUB",
        now: NOW,
      }),
    ).toEqual({ ok: true, discount: 8700 });
  });

  it("does not convert an amount code when no invoice currency is passed", () => {
    expect(promoDiscount({ promo: amountCode(10000, { currency: "USD" }), amount: 29000 })).toEqual({
      ok: true,
      discount: 10000,
    });
  });

  it("refuses a fractional invoice amount", () => {
    expect(() => promoDiscount({ promo: percent(30), amount: 10.5, now: NOW })).toThrow(RangeError);
    expect(() => promoDiscount({ promo: percent(30), amount: -1, now: NOW })).toThrow(RangeError);
  });

  it("keeps percent discounts integral", () => {
    const result = promoDiscount({ promo: percent(7), amount: 10_001, currency: "RUB", now: NOW });

    expect(result.ok).toBe(true);
    expect(Number.isSafeInteger(result.discount)).toBe(true);
    expect(result.discount).toBe(700);
  });
});

describe("assertMinorUnits", () => {
  it("accepts zero and positive safe integers", () => {
    expect(assertMinorUnits(0)).toBe(0);
    expect(assertMinorUnits(29000)).toBe(29000);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null])("refuses %o", (value) => {
    expect(() => assertMinorUnits(value)).toThrow(RangeError);
  });
});
