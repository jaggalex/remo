/**
 * The saved card and its one verb: replace it, or attach the first one (ADR-247 §8.1,
 * `spec/billing.md` §8.1; ADR-248 §7).
 *
 * A card never reaches remo: the payer enters it on the provider's page and the server
 * keeps only the reference and the display fields (§1 rule 9). Replacing it is therefore a
 * checkout of the plan the organisation already pays for, with autopay consent, routed to
 * a method group that can save a card. `invoice` never can, so it is not offered here.
 *
 * Without a card-capable route and a price for the current plan there is nothing honest to
 * start: the section names the missing fact instead of showing a button that always fails.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@remo/ui";
import {
  billingApi,
  priceId,
  TERMS_VERSION,
  type BillingCatalogCurrency,
  type CheckoutResult,
  type OrgBilling,
} from "./apiBilling";
import { ApiError } from "./apiCall";
import { checkoutErrorKey } from "./billingCheckoutError";
import { useI18n } from "./i18n";

/** Method groups whose provider can keep a reusable token (`spec/payment-providers.md` §3.3). */
const CARD_GROUPS = new Set(["ru_card", "foreign_card", "global_card"]);

export function BillingPaymentMethod({ orgId, org }: { orgId: string; org: OrgBilling }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<BillingCatalogCurrency[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<CheckoutResult | null>(null);

  // The catalogue says which card routes exist here; it is public and small, so the
  // section reads it itself instead of making the chooser a precondition.
  useEffect(() => {
    let alive = true;
    setCatalog(null);
    setCatalogFailed(false);
    billingApi
      .catalog(org.currency)
      .then((result) => {
        if (alive) setCatalog(result.currencies);
      })
      .catch(() => {
        if (alive) setCatalogFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [org.currency]);

  const display = org.paymentMethod?.display ?? null;
  const plan = org.subscription?.plan ?? org.plan;
  const interval = org.subscription?.interval ?? "month";
  const offer = useMemo(() => {
    if (!catalog) return null;
    return (
      catalog.find((candidate) => candidate.currency === org.currency) ?? catalog[0] ?? null
    );
  }, [catalog, org.currency]);
  const groups = useMemo(
    () => (offer?.methodGroups ?? []).filter((group) => CARD_GROUPS.has(group)),
    [offer],
  );
  const price = useMemo(
    () => offer?.prices.find((candidate) => candidate.plan === plan && candidate.interval === interval) ?? null,
    [interval, offer, plan],
  );
  const ready = Boolean(price && groups.length > 0);

  const start = async () => {
    if (!price || groups.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setInstructions(null);
    try {
      const result = await billingApi.checkout(orgId, {
        priceId: priceId(price),
        methodGroup: groups[0]!,
        // Autopay is the whole point of a saved card: the server writes the consent
        // version into the invoice line and the provider keeps the token (§1 rule 8).
        consent: { autopay: true, termsVersion: TERMS_VERSION },
        returnUrl: `${window.location.origin}${window.location.pathname}?billing=return`,
      });
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setInstructions(result);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setError(t(checkoutErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const missing =
    catalog === null
      ? null
      : catalogFailed
        ? t("billing.noCatalog")
        : !ready
          ? offer && groups.length > 0
            ? t("billing.card.choosePlan")
            : t("billing.card.unavailable")
          : null;

  return (
    <section className="billing-usage">
      <h3>{t("billing.paymentMethod")}</h3>
      <div className="billing-card">
        {display ? (
          <>
            <p>
              {t("billing.cardMasked", { last4: display.last4 ?? "—" })}
              {display.expMonth && display.expYear && (
                <span className="muted">
                  {" · "}
                  {t("billing.cardExpires", {
                    month: display.expMonth,
                    year: display.expYear,
                  })}
                </span>
              )}
            </p>
            {ready && (
              <Button size="compact" onClick={() => void start()} disabled={busy}>
                {t("billing.card.replace")}
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="muted">{t("billing.noPaymentMethod")}</p>
            {ready && (
              <Button size="compact" onClick={() => void start()} disabled={busy}>
                {t("billing.card.attach")}
              </Button>
            )}
          </>
        )}
      </div>
      {missing && <p className="muted">{missing}</p>}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {instructions && (
        <div className="billing-instructions">
          <p className="billing-instructions-text">
            {instructions.widget?.text ?? t("billing.card.instructions")}
          </p>
        </div>
      )}
    </section>
  );
}
