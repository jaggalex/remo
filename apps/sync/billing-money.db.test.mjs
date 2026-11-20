/**
 * Money storage against a real database (ADR-247, `spec/billing.md` §4, §5, §11).
 *
 * What the pure tests cannot prove: invoice numbers stay unique under twenty parallel
 * checkouts, `(subscription_id, period_start)` really is the idempotency key, paying and
 * voiding write the event, the credit journal never goes negative, promotion redemption
 * respects its limit, and RLS hides every money row from another organisation.
 *
 * The RLS check installs the policy on its own connection inside one transaction and
 * rolls it back, so the shared test database is not left with forced policies for the
 * suites that run beside this one.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promoDiscount } from "./billing-money.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("billing money");
const store = opened?.store ?? null;

const orgA = randomUUID();
const orgB = randomUUID();
const subscriptionId = randomUUID();
const promoLimit = `MONEY-LIMIT-${orgA.slice(0, 8)}`.toUpperCase();
const promoExpired = `MONEY-EXPIRED-${orgA.slice(0, 8)}`.toUpperCase();
const promoAmount = `MONEY-AMOUNT-${orgA.slice(0, 8)}`.toUpperCase();

const TENANT_TABLES = [
  "billing_accounts",
  "subscriptions",
  "invoices",
  "payments",
  "refunds",
  "org_credit_ledger",
  "billing_events",
];

function inA(fn) {
  return store.withTenant(orgA, fn);
}

function inB(fn) {
  return store.withTenant(orgB, fn);
}

const invoiceLine = { plan: "pro", interval: "month", description: "Pro, month" };

function invoiceInput(overrides = {}) {
  return {
    orgId: orgA,
    currency: "RUB",
    lines: [invoiceLine],
    subtotal: 29000,
    discount: 0,
    creditApplied: 0,
    total: 29000,
    ...overrides,
  };
}

async function seed() {
  await store.pool.query(
    "insert into orgs (id, name, slug) values ($1, 'Money A', $2), ($3, 'Money B', $4)",
    [orgA, `money-a-${orgA}`, orgB, `money-b-${orgB}`],
  );
  await inA(() =>
    store.pool.query(
      `insert into subscriptions
         (id, org_id, plan, price_id, amount, currency, interval, status,
          current_period_start, current_period_end)
       values ($1, $2, 'pro', 'pro-rub-month-v1', 29000, 'RUB', 'month', 'active',
               '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z')`,
      [subscriptionId, orgA],
    ),
  );
}

describe.skipIf(!store)("db:billing money (ADR-247)", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    if (!store) return;
    for (const code of [promoLimit, promoExpired, promoAmount]) {
      await store.pool.query("delete from promo_codes where code = $1", [code]);
    }
    for (const orgId of [orgA, orgB]) {
      await store.withTenant(orgId, async () => {
        for (const table of [
          "refunds",
          "org_credit_ledger",
          "payments",
          "billing_events",
          "invoices",
          "subscriptions",
          "billing_accounts",
        ]) {
          await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
        }
        await store.pool.query("delete from orgs where id = $1", [orgId]);
      });
    }
    await store.close();
  });

  it("fixes the billing currency on the first purchase", async () => {
    const account = await inA(() =>
      store.upsertBillingAccount({
        orgId: orgA,
        email: "billing@money.test",
        name: "Money A",
        country: "RU",
        currency: "rub",
      }),
    );
    expect(account).toMatchObject({ currency: "RUB", test_mode: false });

    await expect(
      inA(() =>
        store.upsertBillingAccount({
          orgId: orgA,
          email: "billing@money.test",
          currency: "USD",
        }),
      ),
    ).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });

    const unchanged = await inA(() => store.billingAccount(orgA));
    expect(unchanged.currency).toBe("RUB");

    const other = await inB(() =>
      store.upsertBillingAccount({ orgId: orgB, email: "b@money.test", currency: "USD" }),
    );
    expect(other.currency).toBe("USD");
  });

  it("allocates unique invoice numbers under twenty parallel checkouts", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        inA(() => store.createInvoice(invoiceInput({ lines: [invoiceLine] }))),
      ),
    );

    const numbers = results.map((result) => result.invoice.number);
    expect(results.every((result) => result.created)).toBe(true);
    expect(new Set(numbers).size).toBe(20);
    const year = new Date().getUTCFullYear();
    for (const number of numbers) {
      expect(number).toMatch(new RegExp(`^RU-${year}-[0-9]{6}$`));
    }
    expect(numbers.every((number) => Number.isSafeInteger(Number(number.slice(-6))))).toBe(true);
  });

  it("returns the existing invoice for the same subscription period", async () => {
    const input = invoiceInput({
      subscriptionId,
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
      total: 30000,
    });

    const first = await inA(() => store.createInvoice(input));
    const second = await inA(() => store.createInvoice({ ...input, total: 99999 }));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(second.invoice.total).toBe(30000);

    const { rows } = await inA(() =>
      store.pool.query(
        `select count(*)::int as n from invoices
          where org_id = $1 and subscription_id = $2 and period_start = $3`,
        [orgA, subscriptionId, "2026-03-01T00:00:00.000Z"],
      ),
    );
    expect(rows[0].n).toBe(1);
  });

  it("closes a zero-total invoice as paid without a payment", async () => {
    const { invoice } = await inA(() =>
      store.createInvoice(
        invoiceInput({ subtotal: 1000, discount: 1000, creditApplied: 0, total: 0 }),
      ),
    );

    expect(invoice.status).toBe("paid");
    expect(invoice.paid_at).not.toBeNull();
    const { rows } = await inA(() =>
      store.pool.query("select count(*)::int as n from payments where invoice_id = $1", [
        invoice.id,
      ]),
    );
    expect(rows[0].n).toBe(0);
  });

  it("marks an invoice paid once and writes the payment and the event", async () => {
    const { invoice } = await inA(() => store.createInvoice(invoiceInput()));
    const first = await inA(() =>
      store.markInvoicePaid({ invoiceId: invoice.id, amount: 29000, currency: "RUB" }),
    );

    expect(first.invoice).toMatchObject({ status: "paid", total: 29000 });
    expect(first.payment).toMatchObject({
      status: "succeeded",
      amount: 29000,
      currency: "RUB",
      idempotency_key: `manual:${invoice.id}`,
    });
    expect(first.payment.connection_id).toBe("00000000-0000-0000-0000-000000000000");

    const again = await inA(() =>
      store.markInvoicePaid({ invoiceId: invoice.id, amount: 29000, currency: "RUB" }),
    );
    expect(again.payment.id).toBe(first.payment.id);

    const { rows: payments } = await inA(() =>
      store.pool.query("select count(*)::int as n from payments where invoice_id = $1", [
        invoice.id,
      ]),
    );
    expect(payments[0].n).toBe(1);

    const events = await inA(() => store.billingEvents(orgA, 500));
    expect(
      events.filter((event) => event.type === "invoice.paid" && event.subject_id === invoice.id),
    ).toHaveLength(1);
  });

  it("reads one invoice and lists invoices with their payments", async () => {
    const { invoice } = await inA(() => store.createInvoice(invoiceInput()));
    await inA(() =>
      store.markInvoicePaid({ invoiceId: invoice.id, amount: 29000, currency: "RUB" }),
    );

    const one = await inA(() => store.invoiceById(orgA, invoice.id));
    expect(one).toMatchObject({ id: invoice.id, status: "paid", total: 29000 });
    expect(typeof one.total).toBe("number");

    expect(await inB(() => store.invoiceById(orgB, invoice.id))).toBeNull();

    const list = await inA(() => store.listInvoices(orgA, 500));
    const found = list.find((row) => row.id === invoice.id);
    expect(found.payments).toHaveLength(1);
    expect(found.payments[0]).toMatchObject({ amount: 29000, status: "succeeded" });
  });

  it("voids an open invoice and refuses to void a paid one", async () => {
    const { invoice } = await inA(() => store.createInvoice(invoiceInput()));
    const voided = await inA(() => store.voidInvoice(orgA, invoice.id));
    expect(voided.status).toBe("void");

    const again = await inA(() => store.voidInvoice(orgA, invoice.id));
    expect(again.status).toBe("void");

    const events = await inA(() => store.billingEvents(orgA, 500));
    expect(
      events.filter((event) => event.type === "invoice.voided" && event.subject_id === invoice.id),
    ).toHaveLength(1);

    const { invoice: paid } = await inA(() => store.createInvoice(invoiceInput()));
    await inA(() =>
      store.markInvoicePaid({ invoiceId: paid.id, amount: 29000, currency: "RUB" }),
    );
    await expect(inA(() => store.voidInvoice(orgA, paid.id))).rejects.toMatchObject({
      code: "INVOICE_PAID",
    });
  });

  it("keeps the credit balance from going below zero", async () => {
    await inA(() =>
      store.appendCredit({
        orgId: orgA,
        amount: 500,
        currency: "RUB",
        kind: "goodwill",
        note: "test",
      }),
    );
    const { invoice } = await inA(() => store.createInvoice(invoiceInput({ total: 1000 })));

    const applied = await inA(() =>
      store.applyCredit({ orgId: orgA, currency: "RUB", amount: 300, invoiceId: invoice.id }),
    );
    expect(applied.amount).toBe(-300);
    expect(await inA(() => store.creditBalance(orgA, "RUB"))).toBe(200);

    await expect(
      inA(() => store.applyCredit({ orgId: orgA, currency: "RUB", amount: 300, invoiceId: invoice.id })),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT" });

    expect(await inA(() => store.creditBalance(orgA, "RUB"))).toBe(200);
    const { rows } = await inA(() =>
      store.pool.query(
        `select count(*)::int as n from org_credit_ledger
          where org_id = $1 and kind = 'applied' and invoice_id = $2`,
        [orgA, invoice.id],
      ),
    );
    expect(rows[0].n).toBe(1);
  });

  it("records a payment and a refund without rewriting the payment amount", async () => {
    const { invoice } = await inA(() => store.createInvoice(invoiceInput()));
    const key = `money-pay:${invoice.id}`;
    const payment = await inA(() =>
      store.recordPayment({
        orgId: orgA,
        invoiceId: invoice.id,
        idempotencyKey: key,
        amount: 29000,
        currency: "RUB",
        status: "succeeded",
      }),
    );
    const repeated = await inA(() =>
      store.recordPayment({
        orgId: orgA,
        invoiceId: invoice.id,
        idempotencyKey: key,
        amount: 999,
        currency: "RUB",
        status: "succeeded",
      }),
    );
    expect(repeated.id).toBe(payment.id);
    expect(repeated.amount).toBe(29000);

    const refund = await inA(() =>
      store.recordRefund({
        orgId: orgA,
        paymentId: payment.id,
        amount: 10000,
        currency: "RUB",
        reason: "customer request",
        idempotencyKey: `money-refund:${payment.id}:1`,
      }),
    );
    expect(refund.status).toBe("succeeded");

    const { rows: partially } = await inA(() =>
      store.pool.query("select status, amount from payments where id = $1", [payment.id]),
    );
    expect(partially[0]).toMatchObject({ status: "partially_refunded", amount: "29000" });

    await inA(() =>
      store.recordRefund({
        orgId: orgA,
        paymentId: payment.id,
        amount: 19000,
        currency: "RUB",
        reason: "remainder",
        idempotencyKey: `money-refund:${payment.id}:2`,
      }),
    );
    const { rows: full } = await inA(() =>
      store.pool.query("select status from payments where id = $1", [payment.id]),
    );
    expect(full[0].status).toBe("refunded");

    await expect(
      inA(() =>
        store.recordRefund({
          orgId: orgA,
          paymentId: payment.id,
          amount: 1,
          currency: "RUB",
          reason: "too much",
          idempotencyKey: `money-refund:${payment.id}:3`,
        }),
      ),
    ).rejects.toMatchObject({ code: "REFUND_EXCEEDS_PAYMENT" });
  });

  it("reads a promotion and redeems it only within its limit", async () => {
    await store.pool.query(
      `insert into promo_codes (code, kind, value, currency, duration, max_redemptions)
       values ($1, 'percent', 20, null, 'once', 2),
              ($2, 'percent', 20, null, 'once', null),
              ($3, 'amount', 500, 'RUB', 'once', null)`,
      [promoLimit, promoExpired, promoAmount],
    );
    await store.pool.query("update promo_codes set expires_at = now() - interval '1 day' where code = $1", [
      promoExpired,
    ]);

    const promo = await store.promoByCode(promoLimit.toLowerCase());
    expect(promo).toMatchObject({ kind: "percent", value: 20, redeemed: 0, max_redemptions: 2 });
    expect(promoDiscount({ promo, amount: 10000, currency: "RUB" })).toEqual({
      ok: true,
      discount: 2000,
    });

    expect(await store.redeemPromo(promoLimit)).toBe(true);
    expect(await store.redeemPromo(promoLimit)).toBe(true);
    expect(await store.redeemPromo(promoLimit)).toBe(false);
    expect(await store.promoByCode(promoLimit)).toMatchObject({ redeemed: 2 });

    expect(await store.redeemPromo(promoExpired)).toBe(false);

    const amountPromo = await store.promoByCode(promoAmount);
    expect(promoDiscount({ promo: amountPromo, amount: 10000, currency: "USD" })).toEqual({
      ok: false,
      code: "PROMO_CURRENCY_MISMATCH",
    });
  });

  it("hides one organisation's money rows from another", async () => {
    const client = await store.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `do $$
         begin
           if not exists (select 1 from pg_roles where rolname = 'remo_app') then
             create role remo_app nologin;
           end if;
           if not exists (
             select 1 from pg_auth_members m
               join pg_roles r on r.oid = m.roleid
               join pg_roles u on u.oid = m.member
              where r.rolname = 'remo_app' and u.rolname = current_user
           ) then
             execute format('grant remo_app to %I', current_user);
           end if;
         end $$`,
      );
      await client.query("alter role remo_app nobypassrls nosuperuser");
      await client.query("grant usage on schema public to remo_app");
      await client.query(
        `grant select, insert, update, delete on ${TENANT_TABLES.join(", ")} to remo_app`,
      );
      for (const table of TENANT_TABLES) {
        await client.query(`alter table ${table} enable row level security`);
        await client.query(`alter table ${table} force row level security`);
        await client.query(`drop policy if exists ${table}_tenant on ${table}`);
        await client.query(
          `create policy ${table}_tenant on ${table}
             using (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
             with check (org_id = nullif(current_setting('app.org_id', true), '')::uuid)`,
        );
      }

      await client.query("set local role remo_app");
      await client.query("select set_config('app.org_id', $1, true)", [orgA]);
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query(`select count(*)::int as n from ${table}`);
        expect(rows[0].n, `${table} should be visible to its tenant`).toBeGreaterThan(0);
      }

      await client.query("select set_config('app.org_id', $1, true)", [orgB]);
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query(`select count(*)::int as n from ${table}`);
        // Organisation B owns exactly its own billing account; everything else belongs
        // to A and must not be visible.
        expect(rows[0].n, `${table} should be hidden from another tenant`).toBe(
          table === "billing_accounts" ? 1 : 0,
        );
      }
      const { rows: foreign } = await client.query(
        "select count(*)::int as n from billing_accounts where org_id = $1",
        [orgA],
      );
      expect(foreign[0].n).toBe(0);

      await expect(
        client.query("insert into billing_events (org_id, type) values ($1, 'rls.test')", [orgA]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await client.query("rollback").catch(() => {});
      await client.query("reset role").catch(() => {});
      client.release();
    }
  });
});
