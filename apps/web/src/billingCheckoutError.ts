import type { TranslationKey } from "./i18n";

/**
 * The checkout refusals as sentences (`spec/billing.md` §6, §8.3).
 *
 * Two screens start a checkout — the plan chooser and the card replacement — and both
 * must say the same thing about the same server code. One table, two callers.
 */
const CHECKOUT_ERROR: Record<string, TranslationKey> = {
  FORBIDDEN: "billing.checkout.forbidden",
  CURRENCY_LOCKED: "billing.checkout.currencyLocked",
  PERSONAL_ORG: "billing.personal",
  CONSENT_REQUIRED: "billing.checkout.consent",
  NO_PAYMENT_ROUTE: "billing.checkout.noRoute",
  RESOURCE_NOT_AVAILABLE: "billing.checkout.unavailable",
};

export function checkoutErrorKey(code: string): TranslationKey {
  return CHECKOUT_ERROR[code] ?? "billing.checkout.failed";
}
