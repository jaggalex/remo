/**
 * The one registry of payment adapters (ADR-248).
 *
 * Billing asks `paymentAdapters()` and never names a provider. The fake adapter joins the
 * map only outside production and only with `REMO_PAY_FAKE=1`, so a production process
 * cannot be talked into loading it even if a connection row already says `fake`.
 */
import { fakeAdapter, fakeProviderEnabled } from "./pay-fake.mjs";
import { manualAdapter } from "./pay-manual.mjs";
import { yookassaAdapter } from "./pay-yookassa.mjs";

export function paymentAdapters(env = process.env) {
  const adapters = { manual: manualAdapter, yookassa: yookassaAdapter };
  if (fakeProviderEnabled(env)) adapters.fake = fakeAdapter;
  return adapters;
}
