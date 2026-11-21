/**
 * The billing surface, as the browser sees it (ADR-247, `spec/billing.md` §6, §8).
 *
 * A separate module because `api.ts` is at the Q4 ratchet and because these calls exist
 * only when the installation sells plans: `REMO_BILLING=off` answers `404` for the whole
 * family, and the screen hides itself instead of showing an empty shop.
 *
 * Money is always an integer in the currency's minor units. Nothing here divides it; the
 * one formatter at the bottom does, and only for display.
 */
import { ApiError, call } from "./apiCall";

export interface BillingLimits {
  seats: number | null;
  rooms: number | null;
  agentTasksPerMonth: number | null;
  trashDays: number | null;
  storageBytes: number | null;
}

export interface BillingSubscription {
  id: string;
  plan: string;
  status: "trialing" | "active" | "past_due" | "suspended" | "canceled";
  interval: "month" | "year";
  /** Snapshot in minor units; a later price change never edits it. */
  amount: number;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

export interface BillingUsage {
  seats: number;
  rooms: number;
}

/** The flat spelling the billing summary uses for a saved method. */
interface FlatPaymentMethod {
  kind?: string | null;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
}

/** What a provider returns for display: a brand, four digits and an expiry, never a card. */
export interface BillingPaymentMethod {
  display: {
    kind?: string | null;
    brand?: string | null;
    last4?: string | null;
    expMonth?: number | null;
    expYear?: number | null;
  };
}

export interface OrgBilling {
  plan: "free" | "pro" | "team" | "business" | "unlimited";
  status: "active" | "trialing" | "past_due" | "suspended";
  limits: BillingLimits;
  features: string[];
  usage: BillingUsage;
  /**
   * The organisation's image storage (§7, `spec/images.md` §9.8): what the files hold and
   * the plan's ceiling, `null` meaning "no limit". Read from the same summary so the
   * storage tab and the plan tab never disagree about the same organisation.
   */
  storage: { usedBytes: number; limitBytes: number | null };
  subscription: BillingSubscription | null;
  currency: string | null;
  /** Rooms the plan cannot keep active. Empty until the chooser ships (server §6). */
  frozenRooms: string[];
  /** The organisation is past its seat grace: every room is read-only (§2.5). */
  readOnly: boolean;
  // The money module owns these two. A server without it simply omits them, and the
  // screen says nothing rather than inventing a card or a zero balance.
  paymentMethod?: BillingPaymentMethod | null;
  credit?: number | null;
}

/** One room in the storage list of §9.8: the bytes its own uploads hold. */
export interface OrgStorageRoom {
  boardId: string;
  title: string;
  bytes: number;
}

/** `GET /orgs/:id/storage`: the total, the ceiling and the five heaviest rooms. */
export interface OrgStorage {
  usedBytes: number;
  limitBytes: number | null;
  rooms: OrgStorageRoom[];
}

export interface BillingPrice {
  /** The `prices.id` the checkout names. The public catalogue may omit it (server §6). */
  id?: string;
  plan: string;
  interval: "month" | "year";
  amount: number;
  currency: string;
}

export interface BillingCatalogCurrency {
  currency: string;
  prices: BillingPrice[];
  /** `ru_card`, `foreign_card`, `invoice` — what the payer can choose here (§6). */
  methodGroups: string[];
  plans: Record<string, BillingLimits>;
}

export interface BillingCatalog {
  currencies: BillingCatalogCurrency[];
}

export interface InvoicePayment {
  id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  status:
    | "pending"
    | "succeeded"
    | "failed"
    | "canceled"
    | "refunded"
    | "partially_refunded";
  receipt_status: "none" | "pending" | "issued" | "failed" | null;
  /** Present when the provider exposes a receipt page; the server may not send it yet. */
  receipt_url?: string | null;
  failure_code?: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  currency: string;
  subtotal: number;
  discount: number;
  credit_applied: number;
  total: number;
  lines: unknown;
  period_start: string | null;
  period_end: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  payments: InvoicePayment[];
}

export interface CheckoutWidget {
  kind: "instructions" | string;
  text?: string;
}

export interface CheckoutResult {
  invoiceId: string;
  paymentId: string;
  amount: number;
  currency: string;
  widget: CheckoutWidget | null;
  redirectUrl: string | null;
}

export interface PromoResult {
  code: string;
  currency: string;
  discount: number;
  total: number;
}

/** The consent text version a checkout names in the invoice line (`spec/billing.md` §1.8). */
export const TERMS_VERSION = "2026-11-20";

/** Why a plan refused an action: the two bodies `spec/billing.md` §2.4 defines. */
export interface PlanLimitNotice {
  kind: "limit" | "feature";
  limit?: string;
  current?: number;
  max?: number;
  feature?: string;
  plan?: string;
}

/**
 * A refusal to read as a plan limitation. Anything else — a network failure, a 500 — is
 * an ordinary error and must stay one.
 */
export function planLimitFrom(failure: unknown): PlanLimitNotice | null {
  if (!(failure instanceof ApiError) || failure.status !== 402) return null;
  const details = failure.details;
  if (failure.code === "PLAN_LIMIT") {
    return {
      kind: "limit",
      limit: typeof details.limit === "string" ? details.limit : undefined,
      current: typeof details.current === "number" ? details.current : undefined,
      max: typeof details.max === "number" ? details.max : undefined,
      plan: typeof details.plan === "string" ? details.plan : undefined,
    };
  }
  if (failure.code === "PLAN_FEATURE") {
    return {
      kind: "feature",
      feature: typeof details.feature === "string" ? details.feature : undefined,
      plan: typeof details.plan === "string" ? details.plan : undefined,
    };
  }
  return null;
}

export const billingApi = {
  catalog: (currency?: string | null) =>
    call<BillingCatalog>(
      `/billing/catalog${currency ? `?currency=${encodeURIComponent(currency)}` : ""}`,
    ),
  /**
   * The room ranking of §9.8. Only an owner or an organisation admin may ask; the panel
   * calls it for exactly those people, so a refusal is not a state it renders.
   */
  storage: (orgId: string) =>
    call<OrgStorage>(`/orgs/${encodeURIComponent(orgId)}/storage`),
  org: async (orgId: string): Promise<OrgBilling> => {
    const data = await call<
      Omit<OrgBilling, "paymentMethod" | "credit"> & {
        paymentMethod?: BillingPaymentMethod | FlatPaymentMethod | null;
        credit?: number | { amount: number; currency: string } | null;
      }
    >(`/orgs/${encodeURIComponent(orgId)}/billing`);
    // The server names the card fields flat; the panel wants one `display` object.
    const method = data.paymentMethod;
    const withDisplay = method as { display?: BillingPaymentMethod["display"] } | null;
    const flat = method as FlatPaymentMethod | null;
    const display = withDisplay?.display
      ? withDisplay.display
      : flat
        ? {
            kind: flat.kind,
            brand: flat.brand,
            last4: flat.last4,
            expMonth: flat.expMonth,
            expYear: flat.expYear,
          }
        : null;
    const credit = typeof data.credit === "number" ? data.credit : (data.credit?.amount ?? null);
    return { ...data, paymentMethod: display ? { display } : null, credit };
  },
  checkout: (
    orgId: string,
    body: {
      priceId: string;
      methodGroup: string;
      promoCode?: string;
      consent: { autopay: boolean; termsVersion: string };
      returnUrl?: string;
    },
  ) =>
    call<CheckoutResult>(`/orgs/${encodeURIComponent(orgId)}/billing/checkout`, {
      method: "POST",
      body,
    }),
  invoices: (orgId: string) =>
    call<{ invoices: Invoice[] }>(`/orgs/${encodeURIComponent(orgId)}/billing/invoices`),
  checkPromo: (code: string, priceId: string) =>
    call<PromoResult>("/billing/promo/check", {
      method: "POST",
      body: { code, priceId },
    }),
  cancel: (orgId: string) =>
    call<{ ok: true }>(`/orgs/${encodeURIComponent(orgId)}/billing/cancel`, {
      method: "POST",
    }),
  resume: (orgId: string) =>
    call<{ ok: true }>(`/orgs/${encodeURIComponent(orgId)}/billing/resume`, {
      method: "POST",
    }),
  setFrozenRooms: (orgId: string, boardIds: string[]) =>
    call<{ activeRooms: number }>(
      `/orgs/${encodeURIComponent(orgId)}/billing/frozen-rooms`,
      { method: "PUT", body: { boardIds } },
    ),
};

/** A catalogue price carries the server's id when it sends one; the slug is the fallback. */
export function priceId(price: {
  id?: string;
  plan: string;
  interval: string;
  currency: string;
}): string {
  return price.id ?? `${price.plan}-${price.currency}-${price.interval}-v1`.toLowerCase();
}

/**
 * Money for the screen. `Intl` knows how many minor digits a currency has, so the
 * divisor is never a hard-coded 100 (JPY has none, KWD has three).
 */
export function formatMoney(
  amount: number,
  currency: string,
  lang: "en" | "ru",
): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}
