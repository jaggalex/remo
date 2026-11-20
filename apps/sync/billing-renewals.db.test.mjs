/**
 * Renewal storage and the saved payment method against a real database (ADR-247 §2.5,
 * §3.3; ADR-248 §4; `spec/billing.md` §11).
 *
 * What the pure tests cannot prove: `(subscription_id, period_start)` really is unique
 * under a repeated tick, the period moves exactly once, the retry counter derives from the
 * journal and resets when a payment lands, the sealed reference never leaves the store in
 * the clear, and RLS hides one organisation's method from another.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPaymentMethodRef } from "./billing-renewals.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("billing renewals");
const store = opened?.store ?? null;

const KEK = { key: randomBytes(32), id: "test-kek" };
const CONNECTION = randomUUID();
const PERIOD_START = "2026-10-01T00:00:00.000Z";
const PERIOD_END = "2026-11-01T00:00:00.000Z";
const NEXT_END = "2026-12-01T00:00:00.000Z";

/** Every organisation this suite created, removed in `afterAll`. */
const created = [];

async function organisation(tag) {
  const id = randomUUID();
  await store.pool.query("insert into orgs (id, name, slug) values ($1, $2, $3)", [
    id,
    `Renewals ${tag}`,
    `renewals-${tag}-${id}`,
  ]);
  created.push(id);
  return id;
}

async function insertSubscription(orgId, overrides = {}) {
  const id = randomUUID();
  const row = {
    plan: "pro",
    priceId: "pro-rub-month-v1",
    amount: 29000,
    currency: "RUB",
    interval: "month",
    status: "active",
    start: PERIOD_START,
    end: PERIOD_END,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    ...overrides,
  };
  await store.withTenant(orgId, () =>
    store.pool.query(
      `insert into subscriptions
         (id, org_id, plan, price_id, amount, currency, interval, status,
          current_period_start, current_period_end, cancel_at_period_end, past_due_since)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        orgId,
        row.plan,
        row.priceId,
        row.amount,
        row.currency,
        row.interval,
        row.status,
        row.start,
        row.end,
        row.cancelAtPeriodEnd,
        row.pastDueSince,
      ],
    ),
  );
  return store.subscriptionById(id);
}

function tenantQuery(orgId, sql, params) {
  return store.withTenant(orgId, () => store.pool.query(sql, params));
}

describe.skipIf(!store)("db:billing renewals (ADR-247)", () => {
  beforeAll(async () => {
    // Nothing to seed up front: every test declares the organisation it needs, so one
    // failed test cannot leave the next one with a missing row.
  });

  afterAll(async () => {
    if (!store) return;
    for (const orgId of created) {
      await store.withTenant(orgId, async () => {
        for (const table of [
          "refunds",
          "payments",
          "org_credit_ledger",
          "invoices",
          "billing_events",
          "subscriptions",
          "payment_methods",
          "billing_accounts",
        ]) {
          await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
        }
        await store.pool.query("delete from orgs where id = $1", [orgId]);
      });
    }
    await store.close();
  });

  it("creates one renewal invoice per subscription period", async () => {
    const orgId = await organisation("invoice");
    const subscription = await insertSubscription(orgId);

    const first = await store.renewalInvoice(subscription);
    const second = await store.renewalInvoice(subscription);

    expect(first.id).toBe(second.id);
    expect(first).toMatchObject({
      subscription_id: subscription.id,
      status: "open",
      total: 29000,
      currency: "RUB",
    });
    expect(new Date(first.period_start).toISOString()).toBe(PERIOD_END);
    expect(new Date(first.period_end).toISOString()).toBe(NEXT_END);
    expect(first.lines[0]).toMatchObject({ kind: "subscription", renewal: true, amount: 29000 });

    const { rows } = await tenantQuery(
      orgId,
      `select count(*)::int as n from invoices
        where org_id = $1 and subscription_id = $2 and period_start = $3`,
      [orgId, subscription.id, PERIOD_END],
    );
    expect(rows[0].n).toBe(1);
  });

  it("finds the open invoice and the payment chain a webhook carries", async () => {
    const orgId = await organisation("chain");
    const subscription = await insertSubscription(orgId);
    const invoice = await store.renewalInvoice(subscription);

    const open = await store.openInvoiceFor(subscription.id);
    expect(open.id).toBe(invoice.id);

    const payment = await store.withTenant(orgId, () =>
      store.recordPayment({
        orgId,
        invoiceId: invoice.id,
        connectionId: CONNECTION,
        idempotencyKey: `renewals-chain:${invoice.id}`,
        amount: 29000,
        currency: "RUB",
        status: "pending",
      }),
    );

    const chain = await store.paymentChainFor(payment.id);
    expect(chain).toMatchObject({
      payment_id: payment.id,
      org_id: orgId,
      invoice_id: invoice.id,
      subscription_id: subscription.id,
      payment_status: "pending",
    });
    expect(Array.isArray(chain.lines)).toBe(true);
  });

  it("advances the period once and clears the grace state", async () => {
    const orgId = await organisation("advance");
    const subscription = await insertSubscription(orgId);

    await store.markPastDue(subscription.id);
    const pastDue = await store.subscriptionById(subscription.id);
    expect(pastDue.status).toBe("past_due");
    expect(pastDue.past_due_since).not.toBeNull();

    const advanced = await store.advanceSubscription({
      id: subscription.id,
      periodEnd: NEXT_END,
    });
    expect(advanced).toMatchObject({
      status: "active",
      past_due_since: null,
      suspended_at: null,
      canceled_at: null,
    });
    expect(new Date(advanced.current_period_start).toISOString()).toBe(PERIOD_END);
    expect(new Date(advanced.current_period_end).toISOString()).toBe(NEXT_END);

    const again = await store.advanceSubscription({
      id: subscription.id,
      periodEnd: NEXT_END,
    });
    expect(new Date(again.current_period_end).toISOString()).toBe(NEXT_END);

    const { rows } = await tenantQuery(
      orgId,
      `select count(*)::int as n from billing_events
        where org_id = $1 and type = 'subscription.renewed' and subject_id = $2`,
      [orgId, subscription.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("counts failed retries since the grace began and resets them on payment", async () => {
    const orgId = await organisation("attempts");
    const subscription = await insertSubscription(orgId);

    await store.markPastDue(subscription.id);
    const first = await store.markPastDue(subscription.id);
    // The second call keeps the original start: a later failure is not a new grace period.
    expect(new Date(first.past_due_since).getTime()).toBe(
      new Date((await store.subscriptionById(subscription.id)).past_due_since).getTime(),
    );

    const { rows: events } = await tenantQuery(
      orgId,
      `select count(*)::int as n from billing_events
        where org_id = $1 and type = 'subscription.past_due' and subject_id = $2`,
      [orgId, subscription.id],
    );
    expect(events[0].n).toBe(1);

    expect(await store.bumpRenewalAttempts(subscription.id)).toBe(1);
    expect(await store.bumpRenewalAttempts(subscription.id)).toBe(2);

    // A failure from an older grace period must not inflate the current count.
    const since = (await store.subscriptionById(subscription.id)).past_due_since;
    await tenantQuery(
      orgId,
      `insert into billing_events (org_id, type, subject_id, data, occurred_at)
       values ($1, 'renewal.failed', $2, '{}'::jsonb, $3)`,
      [orgId, subscription.id, new Date(new Date(since).getTime() - 86_400_000)],
    );
    expect(await store.renewalAttempts(subscription.id)).toBe(2);

    await store.advanceSubscription({ id: subscription.id, periodEnd: NEXT_END });
    expect(await store.renewalAttempts(subscription.id)).toBe(0);
  });

  it("suspends and cancels with one event each", async () => {
    const orgId = await organisation("states");
    const suspended = await insertSubscription(orgId);

    const pastDue = await store.markPastDue(suspended.id);
    expect(pastDue.status).toBe("past_due");
    const row = await store.suspendSubscription(suspended.id);
    expect(row.status).toBe("suspended");
    expect(row.suspended_at).not.toBeNull();
    const repeated = await store.suspendSubscription(suspended.id);
    expect(new Date(repeated.suspended_at).getTime()).toBe(new Date(row.suspended_at).getTime());

    const canceled = await store.cancelSubscription(suspended.id);
    expect(canceled.status).toBe("canceled");
    expect(canceled.canceled_at).not.toBeNull();

    const { rows } = await tenantQuery(
      orgId,
      `select type, count(*)::int as n from billing_events
        where org_id = $1 and subject_id = $2 and type like 'subscription.%'
        group by type order by type`,
      [orgId, suspended.id],
    );
    expect(rows).toEqual([
      { type: "subscription.canceled", n: 1 },
      { type: "subscription.past_due", n: 1 },
      { type: "subscription.suspended", n: 1 },
    ]);
  });

  it("lists exactly the subscriptions that renew or retry", async () => {
    const dueOrg = await organisation("due");
    const futureOrg = await organisation("future");
    const retryOrg = await organisation("retry");

    const due = await insertSubscription(dueOrg);
    const future = await insertSubscription(futureOrg, {
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-12-01T00:00:00.000Z",
    });
    const retry = await insertSubscription(retryOrg, {
      status: "past_due",
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-12-01T00:00:00.000Z",
      pastDueSince: "2026-11-15T00:00:00.000Z",
    });

    const ids = (await store.dueSubscriptions({ limit: 200 })).map((row) => row.id);
    expect(ids).toContain(due.id);
    expect(ids).toContain(retry.id);
    expect(ids).not.toContain(future.id);
    expect(Number.isFinite((await store.subscriptionById(due.id)).amount)).toBe(true);
  });

  it("stores the saved method without its reference in the answer", async () => {
    const orgId = await organisation("method");
    const subscription = await insertSubscription(orgId);

    const saved = await store.savePaymentMethod({
      orgId,
      connectionId: CONNECTION,
      ref: "pm_secret_reference",
      display: {
        kind: "card",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
        methodRef: "must-not-survive",
      },
      consentVersion: "terms-2026-11",
      createdBy: null,
      kek: KEK,
    });

    expect(saved).toMatchObject({
      connectionId: CONNECTION,
      subscriptionId: subscription.id,
      consentVersion: "terms-2026-11",
    });
    expect(saved.display).toEqual({
      kind: "card",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
    expect(JSON.stringify(saved)).not.toContain("pm_secret_reference");

    const method = await store.paymentMethod(orgId);
    expect(method.id).toBe(saved.id);
    expect(method.display).toEqual(saved.display);
    expect(method.sealed).toMatchObject({
      scope: "payment_method",
      scope_id: saved.id,
      provider: "payment",
    });
    expect(JSON.stringify(method)).not.toContain("pm_secret_reference");
    expect(openPaymentMethodRef(method, { kek: KEK })).toBe("pm_secret_reference");

    const { rows } = await tenantQuery(
      orgId,
      "select payment_method_id, connection_id from subscriptions where id = $1",
      [subscription.id],
    );
    expect(rows[0]).toMatchObject({
      payment_method_id: saved.id,
      connection_id: CONNECTION,
    });

    const replacement = await store.savePaymentMethod({
      orgId,
      connectionId: CONNECTION,
      ref: "pm_replacement",
      display: { kind: "card", last4: "1111" },
      consentVersion: "terms-2026-11",
      kek: KEK,
    });
    expect((await store.paymentMethod(orgId)).id).toBe(replacement.id);
    const { rows: states } = await tenantQuery(
      orgId,
      "select id, state from payment_methods where org_id = $1 order by created_at",
      [orgId],
    );
    expect(states).toEqual([
      { id: saved.id, state: "revoked" },
      { id: replacement.id, state: "active" },
    ]);
  });

  it("revokes autopay in one action and unlinks the subscription", async () => {
    const orgId = await organisation("revoke");
    const subscription = await insertSubscription(orgId);

    const saved = await store.savePaymentMethod({
      orgId,
      connectionId: CONNECTION,
      ref: "pm_to_revoke",
      display: { kind: "sbp" },
      consentVersion: "terms-2026-11",
      kek: KEK,
    });

    expect(await store.revokePaymentMethod(orgId)).toEqual({ revoked: 1 });
    expect(await store.paymentMethod(orgId)).toBeNull();
    expect(await store.revokePaymentMethod(orgId)).toEqual({ revoked: 0 });

    const { rows } = await tenantQuery(
      orgId,
      "select payment_method_id from subscriptions where id = $1",
      [subscription.id],
    );
    expect(rows[0].payment_method_id).toBeNull();

    const { rows: events } = await tenantQuery(
      orgId,
      `select count(*)::int as n from billing_events
        where org_id = $1 and type = 'payment_method.revoked' and subject_id = $2`,
      [orgId, saved.id],
    );
    expect(events[0].n).toBe(1);
  });

  /**
   * The database policy itself is installed by `rls.test.mjs` on its own database, and
   * `billing.db.test.mjs` proves `payment_methods` is one of its tables. Installing the
   * policy here would take an ACCESS EXCLUSIVE lock on a table that other suites use and
   * buy no extra proof, so this test pins the half a real tenant decides: the store never
   * reaches across organisations.
   */
  it("scopes a saved method to its own organisation", async () => {
    const orgA = await organisation("rls-a");
    const orgB = await organisation("rls-b");
    await insertSubscription(orgA);
    await insertSubscription(orgB);

    const methodA = await store.savePaymentMethod({
      orgId: orgA,
      connectionId: CONNECTION,
      ref: "pm_org_a",
      display: { kind: "card", last4: "0001" },
      consentVersion: "terms-2026-11",
      kek: KEK,
    });
    const methodB = await store.savePaymentMethod({
      orgId: orgB,
      connectionId: CONNECTION,
      ref: "pm_org_b",
      display: { kind: "card", last4: "0002" },
      consentVersion: "terms-2026-11",
      kek: KEK,
    });

    expect((await store.paymentMethod(orgB)).id).toBe(methodB.id);
    expect((await store.paymentMethod(orgA)).id).toBe(methodA.id);
    expect((await store.paymentMethod(orgA)).id).not.toBe(methodB.id);

    // The saved method is a tenant table in the policy file, not an installation one.
    const rls = readFileSync(new URL("./rls.sql", import.meta.url), "utf8");
    expect(rls).toMatch(/'billing_accounts',\s*'payment_methods',/);
    expect(rls).toContain("current_setting('app.org_id'");
  });
});
