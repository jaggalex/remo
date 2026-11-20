#!/usr/bin/env node
/**
 * The operator's price book (`spec/billing.md` §2.1, §2.1.2, §12 stage 1).
 *
 *   pnpm billing:prices list [--currency RUB]
 *   pnpm billing:prices add --plan pro --interval month --currency RUB --amount 29000
 *   pnpm billing:prices publish <id>
 *   pnpm billing:prices seed --currency RUB --pro 29000 --team 59000 --business 119000
 *   pnpm billing:prices check
 *
 * A published amount is never edited (§2.1.2): a new version replaces it, and a live
 * subscription keeps its snapshot. The command therefore only creates drafts and flips
 * a draft to `for_sale`; there is no `edit`. Amounts are whole minor units, never floats.
 *
 * Parsing is exported so a unit test covers it without a database, and so the grant
 * command can read `REMO_BILLING_CURRENCIES` through the same function.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The plans that have a row in `prices`; Free is free by definition (§2.1). */
export const PAID_PLANS = Object.freeze(["pro", "team", "business"]);
export const INTERVALS = Object.freeze(["month", "year"]);
export const DEFAULT_CURRENCIES = Object.freeze(["RUB"]);

const CURRENCY = /^[A-Z]{3}$/;
const AMOUNT = /^[0-9]+$/;
const PRICE_ID = /^[a-z0-9][a-z0-9._-]*$/;

export const PRICE_USAGE = `usage:
  pnpm billing:prices list [--currency RUB]
  pnpm billing:prices add --plan <${PAID_PLANS.join("|")}> [--interval month|year] --currency <ISO> --amount <minor units> [--id <price-id>] [--promo-only]
  pnpm billing:prices publish <price-id>
  pnpm billing:prices seed --currency <ISO> --pro <minor> --team <minor> --business <minor>
                          [--year-pro <minor>] [--year-team <minor>] [--year-business <minor>]
  pnpm billing:prices check [--currency <ISO>]

  seed creates drafts for a month and a year of each paid plan. A year defaults to
  twelve monthly amounts; pass --year-<plan> to set an annual price deliberately.
  check reads REMO_BILLING_CURRENCIES (${DEFAULT_CURRENCIES.join(",")} when unset) and
  exits 1 when any currency lacks a price for sale for every paid plan and interval.`;

/**
 * Currencies this installation sells (§2.1.1). The first one is the default, so the
 * order in the variable is meaningful and must not be sorted here.
 */
export function billingCurrencies(env = process.env) {
  const list = String(env.REMO_BILLING_CURRENCIES ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_CURRENCIES];
}

/** Minor units only: a decimal point or a sign is a typo, not a rounding instruction. */
export function parseAmount(raw, label = "amount") {
  const text = String(raw ?? "").trim();
  if (!AMOUNT.test(text)) {
    throw new Error(`${label} must be a whole number of minor units (integer, no sign)`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${label} must be a positive integer; zero is only for Free, which has no price`,
    );
  }
  return value;
}

/** The next free version for one (plan, interval, currency) — versions never reuse. */
export function nextVersion(rows, { plan, interval, currency }) {
  let highest = 0;
  for (const row of rows) {
    if (row.plan !== plan || row.interval !== interval || row.currency !== currency) continue;
    if (Number(row.version) > highest) highest = Number(row.version);
  }
  return highest + 1;
}

/** `pro / month / RUB / v2` → `pro-rub-month-v2` (§2.1.2). */
export function defaultPriceId({ plan, currency, interval, version }) {
  return `${plan}-${currency}-${interval}-v${version}`.toLowerCase();
}

/** Two decimals for display; the value itself stays an integer (§1.4). */
export function formatAmount(amount, currency) {
  const value = Math.trunc(Number(amount));
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${currency}`;
}

function readFlags(args, booleans = new Set()) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (booleans.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    flags.set(name, value);
    index += 1;
  }
  return { flags, positionals };
}

function rejectUnknown(flags, allowed, command) {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`${command} does not take --${name}`);
  }
}

/**
 * A currency code is an ISO 4217 three-letter token, upper-cased; the operator may type
 * `rub`, but the price book and `billing_accounts.currency` store `RUB`.
 */
export function parseCurrency(raw, { required = true } = {}) {
  if (raw === undefined) {
    if (!required) return null;
    throw new Error("--currency is required (a three-letter ISO 4217 code, e.g. RUB)");
  }
  const currency = String(raw).trim().toUpperCase();
  if (!CURRENCY.test(currency)) {
    throw new Error(`--currency ${JSON.stringify(raw)} is not a three-letter ISO 4217 code`);
  }
  return currency;
}

function readPlan(raw) {
  const plan = String(raw ?? "").trim();
  if (!PAID_PLANS.includes(plan)) {
    throw new Error(`--plan must be one of ${PAID_PLANS.join(", ")}; Free has no price`);
  }
  return plan;
}

function readInterval(raw) {
  const interval = String(raw ?? "month").trim();
  if (!INTERVALS.includes(interval)) {
    throw new Error(`--interval must be one of ${INTERVALS.join(", ")}`);
  }
  return interval;
}

/**
 * Parse one command line into a plain object, or `{ help: true }`. Pure: no environment,
 * no database, so every branch is a unit test.
 */
export function parsePriceArgs(argv, { env = process.env } = {}) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const [command, ...rest] = argv;
  const { flags, positionals } = readFlags(rest, new Set(["promo-only"]));

  if (command === "list") {
    rejectUnknown(flags, ["currency"], "list");
    if (positionals.length > 0) throw new Error(`list does not take ${positionals[0]}`);
    return { command, currency: parseCurrency(flags.get("currency"), { required: false }) };
  }

  if (command === "add") {
    rejectUnknown(flags, ["plan", "interval", "currency", "amount", "id"], "add");
    if (positionals.length > 0) throw new Error(`add does not take ${positionals[0]}`);
    const plan = readPlan(flags.get("plan"));
    const interval = readInterval(flags.get("interval"));
    const currency = parseCurrency(flags.get("currency"));
    const amount = parseAmount(flags.get("amount"));
    let id = null;
    if (flags.has("id")) {
      id = String(flags.get("id")).trim().toLowerCase();
      if (!PRICE_ID.test(id)) {
        throw new Error(`--id ${JSON.stringify(flags.get("id"))} must be a lowercase price id`);
      }
    }
    return { command, plan, interval, currency, amount, id, promoOnly: flags.has("promo-only") };
  }

  if (command === "publish") {
    rejectUnknown(flags, ["id"], "publish");
    const id = String(positionals[0] ?? flags.get("id") ?? "").trim().toLowerCase();
    if (!id) throw new Error("publish needs a price id: pnpm billing:prices publish <price-id>");
    if (positionals.length > 1) throw new Error(`publish takes one price id, not ${positionals.length}`);
    return { command, id };
  }

  if (command === "seed") {
    rejectUnknown(
      flags,
      ["currency", "pro", "team", "business", "year-pro", "year-team", "year-business"],
      "seed",
    );
    if (positionals.length > 0) throw new Error(`seed does not take ${positionals[0]}`);
    const currency = parseCurrency(flags.get("currency"));
    const entries = [];
    for (const plan of PAID_PLANS) {
      if (!flags.has(plan)) throw new Error(`seed needs --${plan} <minor units>`);
      const monthly = parseAmount(flags.get(plan), `--${plan}`);
      // Twelve months at the monthly price is no discount and no invented number; an
      // annual price is a commercial decision and arrives through --year-<plan>.
      const yearly = flags.has(`year-${plan}`)
        ? parseAmount(flags.get(`year-${plan}`), `--year-${plan}`)
        : monthly * 12;
      if (!Number.isSafeInteger(yearly)) throw new Error(`--year-${plan} is too large`);
      entries.push({ plan, interval: "month", amount: monthly });
      entries.push({ plan, interval: "year", amount: yearly });
    }
    return { command, currency, entries };
  }

  if (command === "check") {
    rejectUnknown(flags, ["currency"], "check");
    if (positionals.length > 0) throw new Error(`check does not take ${positionals[0]}`);
    const currencies = flags.has("currency")
      ? [parseCurrency(flags.get("currency"))]
      : billingCurrencies(env);
    return { command, currencies };
  }

  throw new Error(`unknown command ${JSON.stringify(command)}`);
}

function openStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: the price book lives in Postgres");
  }
  return new PostgresStore({
    connectionString,
    migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

async function addOne(store, rows, { plan, interval, currency, amount, id, promoOnly }) {
  const version = nextVersion(rows, { plan, interval, currency });
  const priceId = id ?? defaultPriceId({ plan, currency, interval, version });
  const price = await store.addPrice({
    id: priceId,
    plan,
    interval,
    currency,
    amount,
    version,
    promoOnly,
  });
  rows.push(price);
  return price;
}

async function main(argv) {
  const args = parsePriceArgs(argv);
  if (args.help) {
    console.log(PRICE_USAGE);
    return;
  }

  const store = openStore();
  await store.connect();
  try {
    if (args.command === "list") {
      const rows = await store.listPrices({ currency: args.currency });
      if (rows.length === 0) {
        console.log("[billing:prices] no prices yet; run `pnpm billing:prices seed ...`");
        return;
      }
      for (const row of rows) {
        const promo = row.promo_only ? " promo-only" : "";
        console.log(
          `${row.status.padEnd(9)} ${row.id}  ${row.plan}/${row.interval}  ` +
            `${formatAmount(row.amount, row.currency)}  v${row.version}${promo}`,
        );
      }
      return;
    }

    if (args.command === "add") {
      const rows = await store.listPrices({});
      const price = await addOne(store, rows, args);
      console.log(
        `[billing:prices] draft ${price.id}: ${price.plan}/${price.interval} ` +
          `${formatAmount(price.amount, price.currency)} (${price.amount} minor units, v${price.version})`,
      );
      console.log(`[billing:prices] publish it with: pnpm billing:prices publish ${price.id}`);
      return;
    }

    if (args.command === "publish") {
      const price = await store.publishPrice(args.id);
      console.log(
        `[billing:prices] ${price.id} is for sale: ${price.plan}/${price.interval} ` +
          `${formatAmount(price.amount, price.currency)}`,
      );
      return;
    }

    if (args.command === "seed") {
      const rows = await store.listPrices({ currency: args.currency });
      const created = [];
      const skipped = [];
      for (const entry of args.entries) {
        // Re-running seed with the same numbers must not pile up v2, v3 … drafts.
        const same = rows.find(
          (row) =>
            row.plan === entry.plan &&
            row.interval === entry.interval &&
            row.currency === args.currency &&
            row.status === "draft" &&
            !row.promo_only &&
            row.amount === entry.amount,
        );
        if (same) {
          skipped.push(same.id);
          continue;
        }
        created.push(
          await addOne(store, rows, {
            ...entry,
            currency: args.currency,
            id: null,
            promoOnly: false,
          }),
        );
      }
      for (const price of created) {
        console.log(
          `[billing:prices] draft ${price.id}: ${price.plan}/${price.interval} ` +
            `${formatAmount(price.amount, price.currency)}`,
        );
      }
      for (const id of skipped) console.log(`[billing:prices] kept existing draft ${id}`);
      if (created.length > 0) {
        console.log(
          "[billing:prices] publish each draft when the currency's list is complete: " +
            "pnpm billing:prices publish <id>",
        );
      }
      return;
    }

    if (args.command === "check") {
      const report = await store.checkPriceLists(args.currencies);
      const gaps = report.filter((entry) => entry.missing.length > 0);
      for (const entry of report) {
        if (entry.missing.length === 0) {
          console.log(`[billing:prices] ${entry.currency}: complete`);
        } else {
          console.error(
            `[billing:prices] ${entry.currency}: incomplete, missing ${entry.missing.join(", ")}`,
          );
        }
      }
      if (gaps.length > 0) {
        console.error(
          "[billing:prices] a currency without a complete price list is not offered for sale",
        );
        process.exitCode = 1;
      }
    }
  } finally {
    await store.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[billing:prices] ${error.message}`);
    process.exitCode = 1;
  });
}
