#!/usr/bin/env node
/**
 * Give an organisation a plan by hand (`spec/billing.md` §2.1, §2.4, §12 stage 1).
 *
 *   pnpm billing:grant --org <id> --plan team --until 2027-03-01 [--currency RUB] [--price <id>]
 *   pnpm billing:grant --org <id> --end
 *
 * Stage 1 has no checkout: the operator is the seller. The plan and its period are a
 * subscription row; the price is a snapshot copied from the price book, so a later
 * catalogue change never rewrites this organisation's history.
 *
 * `free` is the same act as `--end` (there is no Free price row and no period): it
 * cancels the live subscription and thaws every room the limits had frozen.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PLANS, PLAN_NAMES } from "../apps/sync/billing-catalog.mjs";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import { billingCurrencies, formatAmount, parseCurrency } from "./billing-prices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GRANT_USAGE = `usage:
  pnpm billing:grant --org <organisation-id> --plan <${PLAN_NAMES.join("|")}> --until YYYY-MM-DD
                     [--currency RUB] [--price <price-id>]
  pnpm billing:grant --org <organisation-id> --end

  --until is the last day of the grant, inclusive, interpreted as the end of that day in UTC.
  It must be in the future. Without --price the command picks the for-sale price of the
  plan for one month in --currency (default: the first REMO_BILLING_CURRENCIES entry, else RUB).
  --plan free and --end both cancel the live subscription; no price is read.`;

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

function rejectUnknown(flags, allowed) {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`billing:grant does not take --${name}`);
  }
}

/**
 * End of `YYYY-MM-DD` in UTC. `noUnchecked` dates such as 2027-02-30 roll over silently
 * in `Date`, so the parsed value must name the same calendar day that was typed.
 */
export function parseUntil(raw, now = new Date()) {
  const text = String(raw ?? "").trim();
  if (!DATE.test(text)) throw new Error("--until must be a date in the form YYYY-MM-DD");
  const until = new Date(`${text}T23:59:59.999Z`);
  if (Number.isNaN(until.getTime()) || until.toISOString().slice(0, 10) !== text) {
    throw new Error(`--until ${text} is not a real calendar date`);
  }
  if (until.getTime() <= now.getTime()) {
    throw new Error(`--until ${text} must be in the future`);
  }
  return until;
}

/**
 * Parse the grant command line. Pure apart from the clock, which is a parameter so a
 * test can pin "future" without depending on the day it runs.
 */
export function parseGrantArgs(argv, { now = new Date() } = {}) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv, new Set(["end"]));
  rejectUnknown(flags, ["org", "plan", "until", "currency", "price", "end"]);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);

  const orgId = String(flags.get("org") ?? "").trim();
  if (!UUID.test(orgId)) {
    throw new Error("--org <organisation id> is required and must be a UUID");
  }

  if (flags.has("end")) {
    for (const name of ["plan", "until", "currency", "price"]) {
      if (flags.has(name)) throw new Error(`--end does not take --${name}`);
    }
    return { help: false, orgId, end: true, plan: "free", until: null, currency: null, priceId: null };
  }

  const plan = String(flags.get("plan") ?? "").trim();
  if (!PLAN_NAMES.includes(plan)) {
    throw new Error(`--plan must be one of ${PLAN_NAMES.join(", ")}`);
  }

  // Free is not a subscription: it is the absence of one. Reusing the end path keeps
  // `subscriptions.plan` from ever holding a row that `entitlementsFor` would ignore.
  if (plan === "free") {
    for (const name of ["until", "currency", "price"]) {
      if (flags.has(name)) throw new Error(`--plan free has no period and no price; use --end`);
    }
    return { help: false, orgId, end: true, plan: "free", until: null, currency: null, priceId: null };
  }

  if (!flags.has("until")) throw new Error("--until YYYY-MM-DD is required for a paid plan");
  const until = parseUntil(flags.get("until"), now);
  const currency = flags.has("currency") ? parseCurrency(flags.get("currency")) : null;
  let priceId = null;
  if (flags.has("price")) {
    priceId = String(flags.get("price")).trim().toLowerCase();
    if (!priceId) throw new Error("--price needs a price id");
  }
  return { help: false, orgId, end: false, plan, until, currency, priceId };
}

function openStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: subscriptions live in Postgres");
  }
  return new PostgresStore({
    connectionString,
    migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

async function resolvePrice(store, args) {
  if (args.priceId) {
    const prices = await store.listPrices({});
    const price = prices.find((row) => row.id === args.priceId);
    if (!price) throw new Error(`no price ${args.priceId}; see \`pnpm billing:prices list\``);
    if (price.plan !== args.plan) {
      throw new Error(`price ${price.id} belongs to ${price.plan}, not ${args.plan}`);
    }
    if (price.status !== "for_sale") {
      throw new Error(`price ${price.id} is ${price.status}, not for sale`);
    }
    if (price.promo_only) {
      throw new Error(`price ${price.id} is promo-only; it is sold through a promo code only`);
    }
    if (args.currency && price.currency !== args.currency) {
      throw new Error(`price ${price.id} is in ${price.currency}, not ${args.currency}`);
    }
    return price;
  }

  const currency = args.currency ?? billingCurrencies()[0];
  const price = await store.priceForSale({ plan: args.plan, interval: "month", currency });
  if (!price) {
    throw new Error(
      `no price for sale for ${args.plan}/month/${currency}; seed prices first: ` +
        `pnpm billing:prices seed --currency ${currency} --${args.plan} <minor units>`,
    );
  }
  return price;
}

async function main(argv) {
  const args = parseGrantArgs(argv);
  if (args.help) {
    console.log(GRANT_USAGE);
    return;
  }

  const store = openStore();
  await store.connect();
  try {
    if (args.end) {
      const canceled = await store.withTenant(args.orgId, async () => {
        const ended = await store.endOperatorPlan(args.orgId);
        await store.reconcileFrozenRooms(args.orgId, null);
        return ended;
      });
      console.log(
        `[billing:grant] org ${args.orgId}: Free` +
          (canceled ? " (live subscription canceled)" : " (there was no live subscription)"),
      );
      console.log("[billing:grant] every room freeze was removed; the entitlements cache expires within 60 s");
      return;
    }

    const { price, subscription } = await store.withTenant(args.orgId, async () => {
      const chosen = await resolvePrice(store, args);
      const row = await store.upsertOperatorPlan({
        orgId: args.orgId,
        plan: args.plan,
        priceId: chosen.id,
        amount: chosen.amount,
        currency: chosen.currency,
        interval: chosen.interval,
        until: args.until,
      });
      await store.reconcileFrozenRooms(args.orgId, PLANS[args.plan].rooms);
      return { price: chosen, subscription: row };
    });

    const rooms = PLANS[args.plan].rooms;
    console.log(
      `[billing:grant] org ${args.orgId}: ${args.plan} until ` +
        `${args.until.toISOString()} for ${formatAmount(price.amount, price.currency)} ` +
        `(${price.id}, ${subscription.interval})`,
    );
    console.log(
      `[billing:grant] rooms ${rooms === null ? "unlimited" : `limited to ${rooms}`}; ` +
        "the entitlements cache in this and other processes expires within 60 s",
    );
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
    console.error(`[billing:grant] ${error.message}`);
    process.exitCode = 1;
  });
}
