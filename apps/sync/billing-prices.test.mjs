/**
 * Price-book and grant command lines without a database (ADR-247, `spec/billing.md`
 * §2.1.2, §12 stage 1).
 *
 * The parsers are the part a database test cannot cover cheaply: every refusal below is
 * an operator typo that must stop before a row is written. The database half — versions,
 * publication, the uniqueness of a sale — is `billing-prices.db.test.mjs`.
 */
import { describe, expect, it } from "vitest";
import { parseGrantArgs, parseUntil } from "../../scripts/billing-grant.mjs";
import {
  billingCurrencies,
  defaultPriceId,
  nextVersion,
  parsePriceArgs,
} from "../../scripts/billing-prices.mjs";

const ORG = "2f1a6c3e-5b7d-4c8a-9e0f-1a2b3c4d5e6f";
const NOW = new Date("2026-11-20T12:00:00.000Z");

describe("price versions and ids (§2.1.2)", () => {
  it("numbers the next version above every status of the same key", () => {
    const rows = [
      { plan: "pro", interval: "month", currency: "RUB", version: 1 },
      { plan: "pro", interval: "month", currency: "RUB", version: 3, status: "sale_ended" },
      { plan: "pro", interval: "month", currency: "USD", version: 9 },
      { plan: "pro", interval: "year", currency: "RUB", version: 4 },
      { plan: "team", interval: "month", currency: "RUB", version: 7 },
    ];

    expect(nextVersion(rows, { plan: "pro", interval: "month", currency: "RUB" })).toBe(4);
    expect(nextVersion(rows, { plan: "pro", interval: "month", currency: "EUR" })).toBe(1);
    expect(nextVersion([], { plan: "team", interval: "year", currency: "RUB" })).toBe(1);
  });

  it("builds the documented lowercase id", () => {
    expect(defaultPriceId({ plan: "pro", currency: "RUB", interval: "month", version: 2 })).toBe(
      "pro-rub-month-v2",
    );
    expect(defaultPriceId({ plan: "Team", currency: "USD", interval: "year", version: 10 })).toBe(
      "team-usd-year-v10",
    );
  });
});

describe("REMO_BILLING_CURRENCIES", () => {
  it("keeps the operator's order and upper-cases the codes", () => {
    expect(billingCurrencies({ REMO_BILLING_CURRENCIES: " usd, eur " })).toEqual(["USD", "EUR"]);
  });

  it("falls back to RUB when the variable is absent or empty", () => {
    expect(billingCurrencies({})).toEqual(["RUB"]);
    expect(billingCurrencies({ REMO_BILLING_CURRENCIES: " , " })).toEqual(["RUB"]);
  });
});

describe("billing:prices parsing", () => {
  it("adds a draft for month by default and normalises the currency", () => {
    expect(
      parsePriceArgs([
        "add",
        "--plan",
        "pro",
        "--currency",
        "rub",
        "--amount",
        "29000",
        "--id",
        "PRO-RUB-MONTH-V2",
      ]),
    ).toEqual({
      command: "add",
      plan: "pro",
      interval: "month",
      currency: "RUB",
      amount: 29000,
      id: "pro-rub-month-v2",
      promoOnly: false,
    });
  });

  it("leaves the id to the command when it is omitted", () => {
    const parsed = parsePriceArgs([
      "add",
      "--plan",
      "team",
      "--interval",
      "year",
      "--currency",
      "RUB",
      "--amount",
      "590000",
    ]);

    expect(parsed.id).toBeNull();
    expect(parsed.interval).toBe("year");
  });

  it("rejects a negative amount", () => {
    expect(() =>
      parsePriceArgs(["add", "--plan", "pro", "--currency", "RUB", "--amount", "-29000"]),
    ).toThrow(/whole number of minor units/);
  });

  it("rejects zero and a fractional amount", () => {
    const add = (amount) =>
      parsePriceArgs(["add", "--plan", "pro", "--currency", "RUB", "--amount", amount]);

    expect(() => add("0")).toThrow(/positive integer/);
    expect(() => add("290.00")).toThrow(/whole number of minor units/);
    expect(() => add("2.9e4")).toThrow(/whole number of minor units/);
  });

  it("rejects a plan that has no price row", () => {
    expect(() =>
      parsePriceArgs(["add", "--plan", "free", "--currency", "RUB", "--amount", "0"]),
    ).toThrow(/Free has no price/);
  });

  it("seeds a month and a year for every paid plan", () => {
    const parsed = parsePriceArgs([
      "seed",
      "--currency",
      "RUB",
      "--pro",
      "29000",
      "--team",
      "59000",
      "--business",
      "119000",
    ]);

    expect(parsed.currency).toBe("RUB");
    expect(parsed.entries).toEqual([
      { plan: "pro", interval: "month", amount: 29000 },
      { plan: "pro", interval: "year", amount: 348000 },
      { plan: "team", interval: "month", amount: 59000 },
      { plan: "team", interval: "year", amount: 708000 },
      { plan: "business", interval: "month", amount: 119000 },
      { plan: "business", interval: "year", amount: 1428000 },
    ]);
  });

  it("lets an annual amount be set deliberately", () => {
    const parsed = parsePriceArgs([
      "seed",
      "--currency",
      "RUB",
      "--pro",
      "29000",
      "--team",
      "59000",
      "--business",
      "119000",
      "--year-pro",
      "290000",
    ]);

    expect(parsed.entries.find((entry) => entry.plan === "pro" && entry.interval === "year")).toEqual(
      { plan: "pro", interval: "year", amount: 290000 },
    );
  });

  it("refuses to seed without every monthly amount", () => {
    expect(() =>
      parsePriceArgs(["seed", "--currency", "RUB", "--pro", "29000", "--team", "59000"]),
    ).toThrow(/--business/);
    expect(() => parsePriceArgs(["seed", "--currency", "RUB"])).toThrow(/--pro/);
  });

  it("takes the published id as a positional argument", () => {
    expect(parsePriceArgs(["publish", "pro-rub-month-v2"])).toEqual({
      command: "publish",
      id: "pro-rub-month-v2",
    });
    expect(() => parsePriceArgs(["publish"])).toThrow(/needs a price id/);
  });

  it("checks the installation currencies by default, or the one passed", () => {
    expect(
      parsePriceArgs(["check"], { env: { REMO_BILLING_CURRENCIES: "rub,usd" } }).currencies,
    ).toEqual(["RUB", "USD"]);
    expect(parsePriceArgs(["check"], { env: {} }).currencies).toEqual(["RUB"]);
    expect(parsePriceArgs(["check", "--currency", "eur"]).currencies).toEqual(["EUR"]);
  });

  it("prints help when asked or when invoked without a command", () => {
    expect(parsePriceArgs([])).toEqual({ help: true });
    expect(parsePriceArgs(["--help"])).toEqual({ help: true });
    expect(parsePriceArgs(["add", "--help"])).toEqual({ help: true });
  });
});

describe("billing:grant parsing", () => {
  it("grants a paid plan until the end of the given UTC day", () => {
    const parsed = parseGrantArgs(
      ["--org", ORG, "--plan", "team", "--until", "2027-03-01", "--currency", "rub"],
      { now: NOW },
    );

    expect(parsed).toEqual({
      help: false,
      orgId: ORG,
      end: false,
      plan: "team",
      until: new Date("2027-03-01T23:59:59.999Z"),
      currency: "RUB",
      priceId: null,
    });
  });

  it("accepts an explicit price id and lower-cases it", () => {
    const parsed = parseGrantArgs(
      ["--org", ORG, "--plan", "pro", "--until", "2027-03-01", "--price", "PRO-RUB-MONTH-V1"],
      { now: NOW },
    );

    expect(parsed.priceId).toBe("pro-rub-month-v1");
    expect(parsed.currency).toBeNull();
  });

  it("treats --end and --plan free as the same cancellation", () => {
    expect(parseGrantArgs(["--org", ORG, "--end"])).toMatchObject({ end: true, plan: "free" });
    expect(parseGrantArgs(["--org", ORG, "--plan", "free"])).toMatchObject({
      end: true,
      plan: "free",
    });
  });

  it("refuses a period for free", () => {
    expect(() =>
      parseGrantArgs(["--org", ORG, "--plan", "free", "--until", "2027-03-01"], { now: NOW }),
    ).toThrow(/no period/);
  });

  it("refuses a plan without a period or with a period in the past", () => {
    expect(() => parseGrantArgs(["--org", ORG, "--plan", "team"], { now: NOW })).toThrow(
      /--until/,
    );
    expect(() =>
      parseGrantArgs(["--org", ORG, "--plan", "team", "--until", "2026-11-19"], { now: NOW }),
    ).toThrow(/must be in the future/);
  });

  it("refuses a date that rolled over", () => {
    expect(() => parseUntil("2027-02-30", NOW)).toThrow(/not a real calendar date/);
    expect(() => parseUntil("01.03.2027", NOW)).toThrow(/YYYY-MM-DD/);
  });

  it("refuses an unknown plan and a malformed organisation id", () => {
    expect(() =>
      parseGrantArgs(["--org", ORG, "--plan", "unlimited", "--until", "2027-03-01"], { now: NOW }),
    ).toThrow(/--plan/);
    expect(() =>
      parseGrantArgs(["--org", "not-a-uuid", "--plan", "team", "--until", "2027-03-01"], {
        now: NOW,
      }),
    ).toThrow(/--org/);
  });

  it("refuses flags that contradict --end", () => {
    expect(() =>
      parseGrantArgs(["--org", ORG, "--end", "--plan", "team"], { now: NOW }),
    ).toThrow(/--end does not take --plan/);
  });
});
