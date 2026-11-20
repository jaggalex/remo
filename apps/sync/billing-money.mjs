/**
 * Money arithmetic for billing (ADR-247, `spec/billing.md` §3.4, §3.5, §4).
 *
 * Every amount is a whole number of minor units (kopecks, cents) plus an ISO 4217
 * currency held next to it. No function here returns a fractional amount: percentages
 * and proration use integer division on `BigInt`, and every input and output is checked
 * with `Number.isSafeInteger`. A float that reaches an invoice is a ledger defect, not a
 * rounding preference.
 *
 * This module is pure: it touches no database, never mutates a `Date` it was given, and
 * reads the clock only to decide whether a promotion has expired (`now` overrides it).
 * The database half is `pg/billing-money.mjs`; routes combine the two.
 */

const PROMO_KINDS = new Set(["percent", "amount", "price_override"]);

/**
 * A money amount. Negative values are refused because every field this module accepts
 * is a price, a discount or a credit — a sign is carried by the journal row, not by an
 * amount that a subtraction could turn into a refund by accident.
 */
export function assertMinorUnits(value, name = "amount") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer in minor units`);
  }
  return value;
}

/** Signed amounts exist only in the credit journal; zero writes no information. */
export function assertSignedMinorUnits(value, name = "amount") {
  if (!Number.isSafeInteger(value) || value === 0) {
    throw new RangeError(`${name} must be a non-zero safe integer in minor units`);
  }
  return value;
}

/** The same safe-integer promise for a value read back from a `bigint` column. */
function checkedResult(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return value;
}

function instant(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) throw new TypeError(`${name} must be a valid date`);
  return time;
}

function normalCurrency(currency, name = "currency") {
  const value = String(currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError(`${name} must be an ISO 4217 code`);
  return value;
}

/** `2026-000123` for the RU book: the region is a prefix, not part of the sequence. */
export function invoiceNumber({ year, seq, region = "RU" }) {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError("year must be a four-digit integer");
  }
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > 999_999) {
    throw new RangeError("seq must be an integer between 1 and 999999");
  }
  if (!/^[A-Za-z]{2}$/.test(String(region))) {
    throw new RangeError("region must be a two-letter code");
  }
  return `${String(region).toUpperCase()}-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * End of the paid period: the same wall-clock date one month or one year later, clamped
 * to the last day of the target month. 31 January ends on 28/29 February instead of
 * spilling into March, which is what a customer reading "one month" expects.
 *
 * All arithmetic is UTC: a period boundary is an instant, and a local `Date` shifted by
 * DST would make one month 743 or 745 hours long depending on the server's timezone.
 */
export function periodEnd(start, interval) {
  const source = start instanceof Date ? new Date(start.getTime()) : new Date(start);
  if (Number.isNaN(source.getTime())) throw new TypeError("start must be a valid date");
  if (interval !== "month" && interval !== "year") {
    throw new RangeError('interval must be "month" or "year"');
  }

  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + (interval === "year" ? 12 : 1);
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(source.getUTCDate(), lastDay);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds(),
    ),
  );
}

/**
 * The unused part of a period, in minor units, rounded **down** so the customer is never
 * charged for a fraction of a day they did not get. The calculation is time-based rather
 * than calendar-based so a period that starts and ends at noon is credited exactly.
 *
 * `at <= periodStart` credits nothing (the period has not started) and `at >= periodEnd`
 * credits everything; both are checked before dividing, so a zero-length period cannot
 * reach the division.
 */
export function prorationCredit({ amount, periodStart, periodEnd: end, at }) {
  const total = assertMinorUnits(amount, "amount");
  const startTime = instant(periodStart, "periodStart");
  const endTime = instant(end, "periodEnd");
  const when = instant(at, "at");
  if (endTime <= startTime) throw new RangeError("periodEnd must be after periodStart");

  if (when <= startTime) return 0;
  if (when >= endTime) return total;

  const unused = BigInt(endTime - when);
  const span = BigInt(endTime - startTime);
  return checkedResult(Number((BigInt(total) * unused) / span), "proration credit");
}

/**
 * The one invoice calculation (`spec/billing.md` §3.5): discount first, then credit, and
 * never below zero. A discount larger than the invoice is capped instead of turning into
 * a negative subtotal; the capped value is what the invoice stores, so the arithmetic
 * that produced the total can be replayed from the document.
 */
export function priceInvoice({ amount, discount = 0, credit = 0 }) {
  const subtotal = assertMinorUnits(amount, "amount");
  const requestedDiscount = assertMinorUnits(discount, "discount");
  const requestedCredit = assertMinorUnits(credit, "credit");

  const appliedDiscount = Math.min(requestedDiscount, subtotal);
  const afterDiscount = subtotal - appliedDiscount;
  const creditApplied = Math.min(requestedCredit, afterDiscount);
  const total = afterDiscount - creditApplied;

  return { subtotal, discount: appliedDiscount, creditApplied, total };
}

function promoCode(code) {
  return { ok: false, code };
}

/**
 * Apply one promotion to a price (`spec/billing.md` §3.5).
 *
 * `currency` is the currency of the price being paid. A percent code has no currency and
 * works in every book; an amount code is denominated in one currency, and paying in
 * another is `PROMO_CURRENCY_MISMATCH` rather than a silently converted discount. A
 * `price_override` compares the invoice against the frozen target amount, so a later
 * change to the target price cannot move an already-issued discount.
 *
 * The promo shape is the `promo_codes` row with its target price joined in:
 * `{ kind, value, currency, targetAmount, targetCurrency, currencies, expiresAt,
 *    maxRedemptions, redeemed, disabled }`. Snake-case aliases are accepted because the
 * database hands rows back that way. The invoice currency is the `currency` argument;
 * `promo.priceCurrency` is an alias for callers that carry it with the code.
 */
export function promoDiscount({ promo, amount, currency = null, now = Date.now() }) {
  const price = assertMinorUnits(amount, "amount");
  const suppliedCurrency =
    currency ??
    promo?.priceCurrency ??
    promo?.price_currency ??
    promo?.invoiceCurrency ??
    promo?.invoice_currency ??
    null;
  const priceCurrency = suppliedCurrency === null ? null : normalCurrency(suppliedCurrency);

  if (!promo || typeof promo !== "object" || !PROMO_KINDS.has(promo.kind)) {
    return promoCode("PROMO_INVALID");
  }
  if (promo.disabled === true || promo.active === false) {
    return promoCode("PROMO_NOT_APPLICABLE");
  }

  const expiresAt = promo.expiresAt ?? promo.expires_at;
  if (expiresAt !== null && expiresAt !== undefined) {
    const expires = instant(expiresAt, "promo expiresAt");
    const clock = now instanceof Date ? now.getTime() : Number(now);
    if (!Number.isFinite(clock)) throw new TypeError("now must be a valid instant");
    if (expires <= clock) return promoCode("PROMO_EXPIRED");
  }

  const maxRedemptions = promo.maxRedemptions ?? promo.max_redemptions ?? null;
  const max = maxRedemptions === null ? null : Number(maxRedemptions);
  const redeemed = Number(promo.redeemed ?? 0);
  if (
    max !== null &&
    Number.isSafeInteger(max) &&
    Number.isSafeInteger(redeemed) &&
    redeemed >= max
  ) {
    return promoCode("PROMO_NOT_APPLICABLE");
  }

  const applicableCurrencies = promo.currencies ?? null;
  const currencyAllowed =
    !Array.isArray(applicableCurrencies) ||
    applicableCurrencies.length === 0 ||
    priceCurrency === null ||
    applicableCurrencies.map((code) => String(code).toUpperCase()).includes(priceCurrency);

  if (!currencyAllowed) return promoCode("PROMO_NOT_APPLICABLE");

  if (promo.kind === "percent") {
    if (!Number.isSafeInteger(promo.value) || promo.value < 1 || promo.value > 100) {
      return promoCode("PROMO_INVALID");
    }
    const discount = Number((BigInt(price) * BigInt(promo.value)) / 100n);
    return { ok: true, discount: checkedResult(discount, "promo discount") };
  }

  if (promo.kind === "amount") {
    if (!Number.isSafeInteger(promo.value) || promo.value <= 0) {
      return promoCode("PROMO_INVALID");
    }
    if (!promo.currency) return promoCode("PROMO_INVALID");
    const discountCurrency = normalCurrency(promo.currency, "promo currency");
    if (priceCurrency !== null && discountCurrency !== priceCurrency) {
      return promoCode("PROMO_CURRENCY_MISMATCH");
    }
    return { ok: true, discount: Math.min(promo.value, price) };
  }

  const targetAmount = promo.targetAmount ?? promo.target_amount;
  if (!Number.isSafeInteger(targetAmount) || targetAmount < 0) {
    return promoCode("PROMO_INVALID");
  }
  const targetCurrency = promo.targetCurrency ?? promo.target_currency;
  if (targetCurrency) {
    const targetCode = normalCurrency(targetCurrency, "target currency");
    if (priceCurrency !== null && targetCode !== priceCurrency) {
      return promoCode("PROMO_CURRENCY_MISMATCH");
    }
  }
  return { ok: true, discount: Math.max(0, price - targetAmount) };
}
