/**
 * Renewal and the saved payment method (ADR-247 §2.5, §3.3; ADR-248 §4;
 * `spec/billing.md` §3.3, §2.5).
 *
 * The state machine is pure: it answers what the next tick should do with one subscription
 * and never reads a clock, a database or a provider. The loop around it only sequences the
 * store calls, and `charge` / `notify` are injected so a test can pin every branch without
 * pretend money or mail.
 *
 * Two rules shape the machine. Suspension is checked before a retry, because the seventh
 * day ends the grace period even if fewer than three retries were made — the schedule is
 * "1, 3, 6 days, suspended at 7", not "three retries however long they take". And every
 * step is idempotent: the invoice is keyed by `(subscription_id, period_start)`, the charge
 * carries `invoice:{id}:attempt:{n}`, and a repeated tick on an unchanged row does nothing.
 */
import { periodEnd } from "./billing-money.mjs";
import { PLANS } from "./billing-catalog.mjs";
import { decryptSecret } from "./secrets.mjs";

/** The days after `past_due_since` on which a charge is retried (§3.3). */
export const RENEWAL_RETRIES_MS = Object.freeze([1, 3, 6].map((days) => days * 86_400_000));

/** After seven days of an unpaid invoice the plan is gone, not extended (§3.1). */
export const RENEWAL_GRACE_MS = 7 * 86_400_000;

/** How many due subscriptions one tick takes; the next tick continues the list. */
const BATCH = 50;

/**
 * A `Date`, an ISO string or epoch milliseconds as milliseconds.
 *
 * `null` is preserved because "no timestamp" is a fact the machine must see (a `past_due`
 * row without `past_due_since` is a data bug the caller must not guess around).
 */
function instantOf(value, name) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) throw new TypeError(`${name} must be a valid date`);
  return time;
}

/** Rows from `pg` are snake_case, fixtures are usually camelCase; accept one spelling. */
function field(row, camel, snake) {
  const value = row?.[camel];
  return value === undefined ? (row?.[snake] ?? null) : value;
}

/** A failed-retry counter from the store or a fixture; anything else counts as zero. */
function countOf(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * What one tick should do with one subscription.
 *
 * `attempts` is the number of failed retries already made since `past_due_since`; it
 * selects the next entry of `RENEWAL_RETRIES_MS`. The result is only the action word, so
 * a caller cannot accidentally branch on a provider name or a plan.
 */
export function renewalStep({
  status,
  periodEnd: periodEndValue,
  pastDueSince,
  cancelAtPeriodEnd = false,
  attempts = 0,
  now = Date.now(),
} = {}) {
  const clock = instantOf(now, "now");
  if (clock === null) throw new TypeError("now is required");
  const made = countOf(attempts);

  if (status === "active") {
    const due = instantOf(periodEndValue, "periodEnd");
    // "Due" includes the boundary instant: a period that ends exactly now has ended.
    if (due === null || due > clock) return { action: "none" };
    return { action: cancelAtPeriodEnd ? "cancel" : "invoice" };
  }

  if (status === "past_due") {
    const since = instantOf(pastDueSince, "pastDueSince");
    // Without the start of the grace period neither the retry date nor the suspension
    // date is knowable. Doing nothing leaves the row for an operator instead of quietly
    // suspending an organisation whose clock we guessed.
    if (since === null) return { action: "none" };
    if (clock >= since + RENEWAL_GRACE_MS) return { action: "suspend" };
    if (made >= RENEWAL_RETRIES_MS.length) return { action: "none" };
    return clock >= since + RENEWAL_RETRIES_MS[made] ? { action: "retry" } : { action: "none" };
  }

  // trialing, suspended and canceled have no renewal of their own: the first is ended by
  // the trial, and the last two only come back through a payment or a new checkout.
  return { action: "none" };
}

/**
 * Unseal the provider reference of a saved method for `chargeSaved`.
 *
 * The reference is not card data, but with our shop keys it is enough to charge the payer,
 * so it lives in the same envelope every other provider secret uses. The function takes
 * the envelope `paymentMethod` returns and never a row the caller assembled by hand.
 */
export function openPaymentMethodRef(method, { kek = null } = {}) {
  const sealed = method?.sealed;
  if (!sealed?.ciphertext || !sealed?.nonce || !sealed?.dek_wrapped) {
    throw new TypeError("a saved payment method needs its sealed envelope");
  }
  let parsed;
  try {
    parsed = JSON.parse(
      decryptSecret(
        {
          scope: sealed.scope ?? "payment_method",
          scope_id: sealed.scope_id ?? sealed.scopeId ?? method.id,
          provider: sealed.provider ?? "payment",
          id: sealed.id ?? method.id,
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
          dek_wrapped: sealed.dek_wrapped,
          dek_nonce: sealed.dek_nonce,
          kek_id: sealed.kek_id,
        },
        { kek },
      ),
    );
  } catch {
    // The error from the crypto layer names the envelope; re-throw it without the value.
    throw new Error("the saved payment method could not be unsealed");
  }
  if (typeof parsed?.methodRef !== "string" || parsed.methodRef === "") {
    throw new TypeError("the saved payment method has no reference");
  }
  return parsed.methodRef;
}

/** Never let a failing mail or metric undo a money decision that is already stored. */
async function safeNotify(notify, type, payload, log) {
  if (!notify) return;
  try {
    await notify(type, payload);
  } catch (error) {
    log.error?.(`[billing] ${type} could not be announced (${error?.code ?? "ERROR"})`);
  }
}

/**
 * The two loops of §3.3: renew an active subscription, and retry or end a past-due one.
 *
 * `store` is the Postgres store (or a double with `dueSubscriptions`, `renewalInvoice`,
 * `openInvoiceFor`, `advanceSubscription`, `markPastDue`, `bumpRenewalAttempts`,
 * `suspendSubscription`, `cancelSubscription`, `renewalAttempts`). `charge` receives
 * `{ subscription, invoice, attempt, idempotencyKey }` and resolves to `{ status }` —
 * `succeeded`, `pending` or `failed` — or throws. The injected `charge` owns the provider
 * call and the payment row; the loop owns only the subscription state. `pending` is the
 * provider's "in processing": neither the period nor the status moves, and the webhook or
 * reconciliation settles it (§3.3, §5.3).
 *
 * `now` is a function (or a fixed value) so a test can stand at a boundary.
 */
export function createBillingLoops({
  store,
  charge = null,
  notify = null,
  log = console,
  now = Date.now,
  intervalMs = 600_000,
}) {
  const clock = () => {
    const value = typeof now === "function" ? now() : now;
    const time = instantOf(value, "now");
    if (time === null) throw new TypeError("now is required");
    return time;
  };

  async function settle(subscription, invoice, result, { retry, attempts }) {
    const id = subscription.id;
    const orgId = field(subscription, "orgId", "org_id");
    const status = result?.status;
    const attempt = countOf(attempts) + 1;

    if (status === "pending") {
      // The provider is still deciding. A retry would be a second charge for one invoice.
      return { id, action: retry ? "retry" : "invoice", status: "pending" };
    }

    if (status === "succeeded") {
      const start = field(subscription, "currentPeriodEnd", "current_period_end");
      const next =
        invoice.period_end ?? invoice.periodEnd ?? periodEnd(start, subscription.interval);
      await store.advanceSubscription({ id, periodEnd: next });
      await safeNotify(
        notify,
        "payment_succeeded",
        { orgId, subscription, invoice, attempt },
        log,
      );
      return { id, action: retry ? "retry" : "invoice", status: "succeeded" };
    }

    // Any answer other than an explicit success is treated as a failure: marking a
    // subscription paid on an undefined result would be the worst possible guess.
    const failureCode = result?.failureCode ?? "unknown";
    if (retry) await store.bumpRenewalAttempts(id);
    else await store.markPastDue(id);
    await safeNotify(
      notify,
      "payment_failed",
      { orgId, subscription, invoice, failureCode, attempt },
      log,
    );
    return { id, action: retry ? "retry" : "invoice", status: "failed", failureCode };
  }

  /**
   * One charge attempt. `attempt` is part of the provider key, so the same attempt after
   * a crash is deduplicated by the provider, while a retry is a new attempt on purpose.
   */
  async function attempt(subscription, invoice, { retry, attempts }) {
    const attemptCount = countOf(attempts) + 1;
    if (!charge) {
      return { id: subscription.id, action: retry ? "retry" : "invoice", status: "unattempted" };
    }
    let result;
    try {
      result = await charge({
        subscription,
        invoice,
        attempt: attemptCount,
        idempotencyKey: `invoice:${invoice.id}:attempt:${attemptCount}`,
      });
    } catch (error) {
      result = { status: "failed", failureCode: error?.code ?? "unknown" };
    }
    return settle(subscription, invoice, result, { retry, attempts });
  }

  async function invoiceAction(subscription) {
    const invoice = await store.renewalInvoice(subscription);
    if (!invoice) {
      log.error?.(`[billing] renewal ${subscription.id}: no invoice was created`);
      return { id: subscription.id, action: "invoice", status: "skipped" };
    }
    return attempt(subscription, invoice, { retry: false, attempts: 0 });
  }

  async function retryAction(subscription, attempts) {
    const invoice = await store.openInvoiceFor(subscription.id);
    if (!invoice) {
      // The invoice vanished between two ticks (voided by an operator). Suspending the
      // payer for our own missing document would be wrong; leave the next tick to decide.
      log.warn?.(`[billing] retry ${subscription.id}: there is no open invoice`);
      return { id: subscription.id, action: "retry", status: "skipped" };
    }
    return attempt(subscription, invoice, { retry: true, attempts });
  }

  async function suspendAction(subscription) {
    const id = subscription.id;
    const orgId = field(subscription, "orgId", "org_id");
    await store.suspendSubscription(id);
    await safeNotify(notify, "subscription_suspended", { orgId, subscription }, log);
    // A suspended plan is Free, so the rooms beyond the Free limit become read-only
    // (§2.5). The freeze is best-effort: a failed reconcile must not undo the suspension,
    // and the next billing change runs it again.
    if (typeof store.reconcileFrozenRooms === "function") {
      try {
        const freeze = () => store.reconcileFrozenRooms(orgId, PLANS.free.rooms);
        if (typeof store.withTenant === "function") await store.withTenant(orgId, freeze);
        else await freeze();
      } catch (error) {
        log.error?.(
          `[billing] suspension ${id}: rooms were not reconciled (${error?.code ?? "ERROR"})`,
        );
      }
    }
    return { id, action: "suspend", status: "suspended" };
  }

  async function cancelAction(subscription) {
    const id = subscription.id;
    const orgId = field(subscription, "orgId", "org_id");
    await store.cancelSubscription(id);
    await safeNotify(notify, "subscription_canceled", { orgId, subscription }, log);
    return { id, action: "cancel", status: "canceled" };
  }

  async function act(subscription) {
    const status = subscription.status;
    const attempts =
      status === "past_due" && typeof store.renewalAttempts === "function"
        ? countOf(Number(await store.renewalAttempts(subscription.id)))
        : 0;

    const { action } = renewalStep({
      status,
      periodEnd: field(subscription, "currentPeriodEnd", "current_period_end"),
      pastDueSince: field(subscription, "pastDueSince", "past_due_since"),
      cancelAtPeriodEnd: Boolean(
        field(subscription, "cancelAtPeriodEnd", "cancel_at_period_end"),
      ),
      attempts,
      now: clock(),
    });

    if (action === "invoice") return invoiceAction(subscription);
    if (action === "retry") return retryAction(subscription, attempts);
    if (action === "suspend") return suspendAction(subscription);
    if (action === "cancel") return cancelAction(subscription);
    return { id: subscription.id, action: "none" };
  }

  // `setInterval` ignores the promise; a slow database must not stack ticks either.
  let ticking = false;

  async function tick() {
    if (ticking) return { processed: 0, actions: [] };
    ticking = true;
    const actions = [];
    try {
      const due = (await store.dueSubscriptions({ limit: BATCH })) ?? [];
      for (const subscription of due) {
        try {
          actions.push(await act(subscription));
        } catch (error) {
          // One broken subscription must not stop the batch. The row is untouched, so
          // the next tick repeats the same idempotent step.
          log.error?.(`[billing] renewal ${subscription.id}: ${error?.code ?? "ERROR"}`);
          actions.push({ id: subscription.id, action: "error" });
        }
      }
      return { processed: due.length, actions };
    } finally {
      ticking = false;
    }
  }

  let timer = null;

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void tick().catch((error) => {
        log.error?.(`[billing] renewal tick failed: ${error?.code ?? "ERROR"}`);
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop };
}
