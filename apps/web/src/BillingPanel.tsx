import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Input,
  Link,
  Segmented,
  Table,
  type TableColumn,
} from "@remo/ui";
import {
  billingApi,
  formatMoney,
  TERMS_VERSION,
  type BillingCatalog,
  type BillingCatalogCurrency,
  type CheckoutResult,
  type Invoice,
  type OrgBilling,
  type PromoResult,
} from "./apiBilling";
import { ApiError } from "./apiCall";
import { BillingRooms } from "./BillingRooms";
import { formatDate } from "./format";
import { useI18n, type TranslationKey } from "./i18n";

/**
 * "Plan and payment": the fourth tab of the organisation screen (ADR-247 §8,
 * `spec/billing.md` §8).
 *
 * Reads come from one route (`GET /orgs/:id/billing`); prices come from the public
 * catalogue. The screen never decides what a plan allows — it prints what the server
 * returned, and every button goes through the server's own refusals.
 *
 * A member without `org_admin` sees the plan and its limits but not the money: invoices,
 * the card and the buttons are the payer's, and the screen says who to ask (§3.2).
 */

const PLAN_ORDER = ["pro", "team", "business"];

const PLAN_LABEL: Record<string, TranslationKey> = {
  free: "billing.plan.free",
  pro: "billing.plan.pro",
  team: "billing.plan.team",
  business: "billing.plan.business",
  unlimited: "billing.plan.unlimited",
};

const STATUS_LABEL: Record<string, TranslationKey> = {
  trialing: "billing.subscription.trialing",
  active: "billing.subscription.active",
  past_due: "billing.subscription.past_due",
  suspended: "billing.subscription.suspended",
  canceled: "billing.subscription.canceled",
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  canceled: "neutral",
};

const INVOICE_STATUS: Record<string, TranslationKey> = {
  draft: "billing.invoice.draft",
  open: "billing.invoice.open",
  paid: "billing.invoice.paid",
  void: "billing.invoice.void",
  uncollectible: "billing.invoice.uncollectible",
};

const INVOICE_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  draft: "neutral",
  open: "warning",
  paid: "success",
  void: "neutral",
  uncollectible: "danger",
};

const METHOD_LABEL: Record<string, TranslationKey> = {
  ru_card: "billing.method.ru_card",
  foreign_card: "billing.method.foreign_card",
  invoice: "billing.method.invoice",
};

const PROMO_ERROR: Record<string, TranslationKey> = {
  PROMO_INVALID: "billing.promo.invalid",
  PROMO_EXPIRED: "billing.promo.expired",
  PROMO_CURRENCY_MISMATCH: "billing.promo.currency",
  PROMO_NOT_APPLICABLE: "billing.promo.notApplicable",
};

const CHECKOUT_ERROR: Record<string, TranslationKey> = {
  FORBIDDEN: "billing.checkout.forbidden",
  CURRENCY_LOCKED: "billing.checkout.currencyLocked",
  PERSONAL_ORG: "billing.personal",
  CONSENT_REQUIRED: "billing.checkout.consent",
  NO_PAYMENT_ROUTE: "billing.checkout.noRoute",
  RESOURCE_NOT_AVAILABLE: "billing.checkout.unavailable",
};

function priceAmount(
  offer: BillingCatalogCurrency,
  plan: string,
  interval: "month" | "year",
): number | null {
  return offer.prices.find((price) => price.plan === plan && price.interval === interval)?.amount ?? null;
}

export function BillingPanel({
  orgId,
  orgSlug,
  initial,
  isOrgAdmin,
  orgKind,
  onUnavailable,
}: {
  orgId: string;
  /** The room directory is filtered by slug (`GET /boards?org=`). */
  orgSlug: string | null;
  /** The dialog's availability probe; without it the panel reads the route itself. */
  initial: OrgBilling | null;
  isOrgAdmin: boolean;
  orgKind: "personal" | "shared";
  /** The route answered `404`: billing is off on this installation (or the org is gone). */
  onUnavailable: () => void;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<OrgBilling | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  // The plan chooser is a step inside the tab, not a second screen (§8.2).
  const [choosing, setChoosing] = useState(false);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [plan, setPlan] = useState("team");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [method, setMethod] = useState("");
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);

  const read = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await billingApi.org(orgId));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) {
        onUnavailable();
        return;
      }
      setError(failure instanceof Error ? failure.message : t("billing.failed"));
    } finally {
      setLoading(false);
    }
  }, [onUnavailable, orgId, t]);

  useEffect(() => {
    setData(initial);
    setLoading(!initial);
    setInvoices(null);
    setChoosing(false);
    setCheckout(null);
    setActionError(null);
    if (!initial) void read();
  }, [initial, read]);

  // Invoices are the payer's data (§3.2); a member without the role does not read them.
  useEffect(() => {
    if (!isOrgAdmin) {
      setInvoices([]);
      return;
    }
    let alive = true;
    billingApi
      .invoices(orgId)
      .then((result) => {
        if (alive) setInvoices(result.invoices);
      })
      .catch(() => {
        if (alive) setInvoices([]);
      });
    return () => {
      alive = false;
    };
  }, [isOrgAdmin, orgId]);

  const currency =
    data?.currency ?? (currencyChoice || catalog?.currencies[0]?.currency) ?? null;
  const offer = useMemo<BillingCatalogCurrency | null>(() => {
    if (!catalog) return null;
    return (
      catalog.currencies.find((candidate) => candidate.currency === currency) ??
      catalog.currencies[0] ??
      null
    );
  }, [catalog, currency]);

  const plans = useMemo(() => {
    if (!offer) return [];
    const names = [...new Set(offer.prices.map((price) => price.plan))];
    return names.sort((a, b) => {
      const left = PLAN_ORDER.indexOf(a);
      const right = PLAN_ORDER.indexOf(b);
      return (left < 0 ? PLAN_ORDER.length : left) - (right < 0 ? PLAN_ORDER.length : right);
    });
  }, [offer]);

  // One method is always named: a disabled "Pay" with nothing selected explains nothing.
  useEffect(() => {
    const groups = offer?.methodGroups ?? [];
    if (groups.length > 0 && !groups.includes(method)) setMethod(groups[0]!);
  }, [method, offer]);

  const selectedPrice = useMemo(() => {
    if (!offer) return null;
    return (
      offer.prices.find(
        (price) => price.plan === plan && price.interval === interval,
      ) ?? null
    );
  }, [interval, offer, plan]);

  const choosePlan = useCallback(() => {
    setChoosing(true);
    setCheckout(null);
    setActionError(null);
    if (catalog) return;
    setCatalogError(null);
    billingApi
      .catalog(data?.currency ?? null)
      .then((result) => {
        setCatalog(result);
        const first = result.currencies[0];
        setCurrencyChoice(data?.currency ?? first?.currency ?? "");
        const preferred =
          result.currencies.find((candidate) => candidate.currency === data?.currency) ?? first;
        if (preferred) {
          const freePlan =
            plans.find((name) =>
              preferred.prices.some((price) => price.plan === name),
            ) ?? preferred.prices[0]?.plan;
          const current = data?.subscription?.plan;
          if (current && preferred.prices.some((price) => price.plan === current)) {
            setPlan(current);
          } else if (freePlan) {
            setPlan(freePlan);
          }
        }
      })
      .catch((failure: unknown) => {
        setCatalogError(
          failure instanceof Error ? failure.message : t("billing.noCatalog"),
        );
      });
  }, [catalog, data?.currency, data?.subscription?.plan, plans, t]);

  const checkPromo = async () => {
    if (!selectedPrice || !promoCode.trim() || promoBusy) return;
    setPromoBusy(true);
    setPromoError(null);
    setPromo(null);
    try {
      setPromo(await billingApi.checkPromo(promoCode.trim(), priceId(selectedPrice)));
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setPromoError(t(PROMO_ERROR[code] ?? "billing.promo.invalid"));
    } finally {
      setPromoBusy(false);
    }
  };

  const pay = async () => {
    if (!selectedPrice || !method || !terms || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await billingApi.checkout(orgId, {
        priceId: priceId(selectedPrice),
        methodGroup: method,
        ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
        consent: { autopay: true, termsVersion: TERMS_VERSION },
        returnUrl: `${window.location.origin}${window.location.pathname}?billing=return`,
      });
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setCheckout(result);
      setChoosing(false);
      setTerms(false);
      setPromo(null);
      setPromoCode("");
      // The invoice number is the durable name of what was just created; the checkout
      // response carries the id only, so the list supplies the number for the screen.
      void billingApi
        .invoices(orgId)
        .then((payload) => setInvoices(payload.invoices))
        .catch(() => {
          // The instructions are still valid without the number.
        });
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setActionError(t(CHECKOUT_ERROR[code] ?? "billing.checkout.failed"));
    } finally {
      setBusy(false);
    }
  };

  const changeSubscription = async (kind: "cancel" | "resume") => {
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "cancel") await billingApi.cancel(orgId);
      else await billingApi.resume(orgId);
      setConfirmCancel(false);
      await read();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setActionError(
        code === "FORBIDDEN"
          ? t("billing.askOwner")
          : failure instanceof ApiError && failure.status === 404
            ? t("billing.actionUnavailable")
            : t("billing.failed"),
      );
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <p className="muted">{t("billing.loading")}</p>;
  }
  if (error && !data) {
    return <p className="auth-error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">{t("billing.loading")}</p>;
  }

  const subscription = data.subscription;
  const planLabel = (name: string) => t(PLAN_LABEL[name] ?? "billing.plan.free");
  const statusLabel = (status: string) =>
    t(STATUS_LABEL[status] ?? "billing.subscription.active");
  const personal = orgKind === "personal";
  const methodOptions = offer?.methodGroups ?? [];
  const checkoutNumber = checkout
    ? (invoices?.find((invoice) => invoice.id === checkout.invoiceId)?.number ??
      checkout.invoiceId)
    : null;
  const termsHref = `https://docs.remo.letii.ru/guide/${lang}/support/disclaimer.html`;
  const invoiceColumns: TableColumn<Invoice>[] = [
    {
      key: "number",
      label: t("billing.invoiceNumber"),
      render: (row) => <span className="billing-invoice-number">{row.number}</span>,
    },
    {
      key: "created_at",
      label: t("billing.invoiceDate"),
      render: (row) => formatDate(row.created_at, lang),
    },
    {
      key: "total",
      label: t("billing.invoiceTotal"),
      numeric: true,
      render: (row) => formatMoney(row.total, row.currency, lang),
    },
    {
      key: "status",
      label: t("billing.invoiceStatus"),
      render: (row) => (
        <Badge tone={INVOICE_TONE[row.status] ?? "neutral"}>
          {t(INVOICE_STATUS[row.status] ?? "billing.invoice.draft")}
        </Badge>
      ),
    },
  ];

  return (
    <section className="billing-panel">
      {error && <p className="auth-error">{error}</p>}
      {actionError && <p className="auth-error" role="alert">{actionError}</p>}

      {data.readOnly && <p className="billing-warning">{t("billing.readOnly")}</p>}
      {data.status === "past_due" && (
        <p className="billing-warning">{t("billing.pastDue")}</p>
      )}
      {data.status === "suspended" && (
        <p className="billing-warning">{t("billing.suspended")}</p>
      )}

      <div className="billing-facts">
        <div className="billing-fact">
          <span>{t("billing.plan")}</span>
          <strong>{planLabel(data.plan)}</strong>
        </div>
        <div className="billing-fact">
          <span>{t("billing.status")}</span>
          <Badge tone={STATUS_TONE[data.status] ?? "neutral"}>
            {statusLabel(data.status)}
          </Badge>
        </div>
        {subscription && (
          <div className="billing-fact">
            <span>{t("billing.amount")}</span>
            <strong>{formatMoney(subscription.amount, subscription.currency, lang)}</strong>
          </div>
        )}
        {subscription && (
          <div className="billing-fact">
            <span>
              {subscription.cancelAtPeriodEnd ? t("billing.ends") : t("billing.renews")}
            </span>
            <strong>{formatDate(subscription.currentPeriodEnd, lang)}</strong>
          </div>
        )}
        {typeof data.credit === "number" && data.credit !== 0 && data.currency && (
          <div className="billing-fact">
            <span>{t("billing.credit")}</span>
            <strong>{formatMoney(data.credit, data.currency, lang)}</strong>
          </div>
        )}
      </div>

      <section className="billing-usage">
        <h3>{t("billing.usage")}</h3>
        <div className="billing-usage-rows">
          <span>
            {data.limits.seats === null
              ? t("billing.usage.seatsUnlimited", { used: data.usage.seats })
              : t("billing.usage.seats", {
                  used: data.usage.seats,
                  max: data.limits.seats,
                })}
          </span>
          <span>
            {data.limits.rooms === null
              ? t("billing.usage.roomsUnlimited", { used: data.usage.rooms })
              : t("billing.usage.rooms", {
                  used: data.usage.rooms,
                  max: data.limits.rooms,
                })}
          </span>
        </div>
      </section>

      <BillingRooms
        key={orgId}
        orgId={orgId}
        orgSlug={orgSlug}
        limitsRooms={data.limits.rooms}
        usageRooms={data.usage.rooms}
        frozenRooms={data.frozenRooms}
        isOrgAdmin={isOrgAdmin}
        onSaved={read}
      />

      {isOrgAdmin && data.paymentMethod !== undefined && (
        <section className="billing-usage">
          <h3>{t("billing.paymentMethod")}</h3>
          {data.paymentMethod?.display ? (
            <p>
              {t("billing.cardMasked", {
                last4: data.paymentMethod.display.last4 ?? "—",
              })}
              {data.paymentMethod.display.expMonth && data.paymentMethod.display.expYear && (
                <span className="muted">
                  {" · "}
                  {t("billing.cardExpires", {
                    month: data.paymentMethod.display.expMonth,
                    year: data.paymentMethod.display.expYear,
                  })}
                </span>
              )}
            </p>
          ) : (
            <p className="muted">{t("billing.noPaymentMethod")}</p>
          )}
        </section>
      )}

      {checkout && (
        <section className="billing-instructions">
          <h3>{t("billing.checkout.created", { id: checkoutNumber ?? checkout.invoiceId })}</h3>
          {checkout.widget?.text && (
            <p className="billing-instructions-text">{checkout.widget.text}</p>
          )}
          <p className="muted">{t("billing.checkout.waiting")}</p>
          <Button size="compact" onClick={() => setCheckout(null)}>
            {t("billing.close")}
          </Button>
        </section>
      )}

      {personal ? (
        <p className="muted">{t("billing.personal")}</p>
      ) : !isOrgAdmin ? (
        <p className="muted">{t("billing.askOwner")}</p>
      ) : (
        <div className="billing-actions">
          <Button variant="primary" onClick={choosePlan} disabled={busy}>
            {t("billing.changePlan")}
          </Button>
          {subscription &&
            (subscription.cancelAtPeriodEnd ? (
              <Button onClick={() => void changeSubscription("resume")} disabled={busy}>
                {t("billing.resume")}
              </Button>
            ) : (
              <Button onClick={() => setConfirmCancel(true)} disabled={busy}>
                {t("billing.cancel")}
              </Button>
            ))}
        </div>
      )}

      {choosing && (
        <section className="billing-choose">
          <div className="billing-choose-head">
            <h3>{t("billing.choose.title")}</h3>
            <Button size="compact" variant="ghost" onClick={() => setChoosing(false)}>
              {t("billing.back")}
            </Button>
          </div>
          <p className="muted">{t("billing.choose.hint")}</p>

          {catalogError && <p className="auth-error">{catalogError}</p>}
          {!catalog && !catalogError && <p className="muted">{t("billing.loading")}</p>}

          {offer && (
            <>
              <Segmented
                label={t("billing.period")}
                value={interval}
                options={[
                  { value: "month", label: t("billing.period.month") },
                  { value: "year", label: t("billing.period.year") },
                ]}
                onChange={(value) => {
                  setInterval(value === "year" ? "year" : "month");
                  setPromo(null);
                  setPromoError(null);
                }}
              />

              {/* The first purchase fixes the organisation's currency (§2.1.1). */}
              {!data.currency && catalog && catalog.currencies.length > 1 && (
                <Segmented
                  label={t("billing.currency")}
                  value={currency ?? ""}
                  options={catalog.currencies.map((candidate) => ({
                    value: candidate.currency,
                    label: candidate.currency,
                  }))}
                  onChange={(value) => {
                    setCurrencyChoice(value);
                    setMethod("");
                    setPromo(null);
                    setPromoError(null);
                  }}
                />
              )}

              <Table
                caption={t("billing.choose.title")}
                rows={plans.map((name) => ({ id: name }))}
                columns={[
                  {
                    key: "plan",
                    label: t("billing.plan"),
                    render: (row) => planLabel(row.id),
                  },
                  {
                    key: "month",
                    label: t("billing.period.month"),
                    numeric: true,
                    render: (row) => {
                      const amount = priceAmount(offer, row.id, "month");
                      if (amount === null) return "—";
                      return (
                        <Button
                          size="compact"
                          variant={
                            plan === row.id && interval === "month" ? "primary" : "ghost"
                          }
                          onClick={() => {
                            setPlan(row.id);
                            setInterval("month");
                            setPromo(null);
                            setPromoError(null);
                          }}
                        >
                          {formatMoney(amount, offer.currency, lang)}
                        </Button>
                      );
                    },
                  },
                  {
                    key: "year",
                    label: t("billing.period.year"),
                    numeric: true,
                    render: (row) => {
                      const amount = priceAmount(offer, row.id, "year");
                      if (amount === null) return "—";
                      return (
                        <Button
                          size="compact"
                          variant={
                            plan === row.id && interval === "year" ? "primary" : "ghost"
                          }
                          onClick={() => {
                            setPlan(row.id);
                            setInterval("year");
                            setPromo(null);
                            setPromoError(null);
                          }}
                        >
                          {formatMoney(amount, offer.currency, lang)}
                        </Button>
                      );
                    },
                  },
                ]}
              />

              <div className="billing-promo">
                <Input
                  label={t("billing.promo")}
                  placeholder={t("billing.promo.placeholder")}
                  value={promoCode}
                  maxLength={120}
                  onChange={(event) => {
                    setPromoCode(event.target.value);
                    setPromo(null);
                    setPromoError(null);
                  }}
                />
                <Button
                  size="compact"
                  onClick={() => void checkPromo()}
                  disabled={!selectedPrice || !promoCode.trim() || promoBusy}
                >
                  {t("billing.promo.check")}
                </Button>
              </div>
              {promo && (
                <p className="billing-promo-result" role="status">
                  {t("billing.promo.applied", {
                    discount: formatMoney(promo.discount, promo.currency, lang),
                    total: formatMoney(promo.total, promo.currency, lang),
                  })}
                </p>
              )}
              {promoError && <p className="auth-error">{promoError}</p>}

              {methodOptions.length > 0 && (
                <Segmented
                  label={t("billing.method")}
                  value={method}
                  options={methodOptions.map((group) => ({
                    value: group,
                    label: t(METHOD_LABEL[group] ?? "billing.method.invoice"),
                  }))}
                  onChange={setMethod}
                />
              )}

              <Checkbox
                checked={terms}
                onChange={(event) => setTerms(event.target.checked)}
                label={
                  <>
                    {t("billing.terms")}{" "}
                    <Link href={termsHref} target="_blank" rel="noreferrer">
                      {t("billing.termsLink")}
                    </Link>
                  </>
                }
              />

              <div className="billing-actions">
                <Button
                  variant="primary"
                  disabled={!selectedPrice || !method || !terms || busy}
                  onClick={() => void pay()}
                >
                  {busy
                    ? t("billing.paying")
                    : selectedPrice
                      ? t("billing.pay", {
                          amount: formatMoney(selectedPrice.amount, offer.currency, lang),
                        })
                      : t("billing.pay", { amount: "—" })}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {isOrgAdmin && (
        <section className="billing-invoices">
          <h3>{t("billing.invoices")}</h3>
          {invoices === null ? (
            <p className="muted">{t("billing.loading")}</p>
          ) : invoices.length === 0 ? (
            <p className="muted">{t("billing.invoicesEmpty")}</p>
          ) : (
            <Table
              caption={t("billing.invoices")}
              rows={invoices}
              columns={invoiceColumns}
              rowActions={(invoice) => {
                const paid = invoice.payments.find((payment) => payment.receipt_url);
                return paid?.receipt_url ? (
                  <Link href={paid.receipt_url} target="_blank" rel="noreferrer">
                    {t("billing.invoiceReceipt")}
                  </Link>
                ) : null;
              }}
            />
          )}
        </section>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title={t("billing.cancel")}
          confirmLabel={t("billing.cancel")}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => void changeSubscription("cancel")}
        >
          {t("billing.cancelConfirm")}
        </ConfirmDialog>
      )}
    </section>
  );
}

/** A catalogue price carries the server's id when it sends one; the slug is the fallback. */
function priceId(price: { id?: string; plan: string; interval: string; currency: string }): string {
  return (
    price.id ?? `${price.plan}-${price.currency}-${price.interval}-v1`.toLowerCase()
  );
}
