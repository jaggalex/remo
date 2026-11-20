/**
 * Money storage for billing (ADR-247, `spec/billing.md` §4, §5).
 *
 * Every method here uses `this.pool` directly and expects an established tenant:
 * `billing_accounts`, `invoices`, `payments`, `refunds`, `org_credit_ledger` and
 * `billing_events` are protected by RLS (ADR-178). Call them inside
 * `store.withTenant(orgId, …)`; without the setting a read returns no rows and an insert
 * is refused, which is the safe direction for money. `promo_codes` is installation-level
 * and deliberately has no tenant.
 *
 * Rows are append-only except for the status of an invoice, a payment or a refund whose
 * meaning changed (paid, voided, refunded). Nothing here rewrites an amount, because a
 * correction is a new journal row (`org_credit_ledger`) or a new refund.
 */
import { assertMinorUnits, assertSignedMinorUnits, invoiceNumber } from "../billing-money.mjs";

/** `payments.connection_id` is not nullable; a manual payment has no provider route. */
const MANUAL_CONNECTION_ID = "00000000-0000-0000-0000-000000000000";
const LEDGER_KINDS = new Set(["proration", "goodwill", "refund_to_credit", "applied"]);
const PAYMENT_STATUSES = new Set([
  "pending",
  "succeeded",
  "failed",
  "canceled",
  "refunded",
  "partially_refunded",
]);
const REFUND_STATUSES = new Set(["pending", "succeeded", "failed"]);
const MAX_NUMBER_ATTEMPTS = 10_000;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalCurrency(currency, name = "currency") {
  const value = String(currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new TypeError(`${name} must be an ISO 4217 code`);
  }
  return value;
}

const money = (value) => Number(value);
const moneyOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);

function mapInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    subtotal: money(row.subtotal),
    discount: money(row.discount),
    credit_applied: money(row.credit_applied),
    total: money(row.total),
  };
}

function mapAmount(row) {
  if (!row) return null;
  return { ...row, amount: money(row.amount) };
}

function mapPromo(row) {
  if (!row) return null;
  return {
    ...row,
    value: moneyOrNull(row.value),
    target_amount: moneyOrNull(row.target_amount),
  };
}

function normalizeCode(code) {
  const value = String(code ?? "").trim().toUpperCase();
  return value.length > 0 && value.length <= 120 ? value : null;
}

function pageSize(limit, fallback = 50) {
  if (limit === undefined || limit === null) return fallback;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 500) {
    throw new RangeError("limit must be an integer between 0 and 500");
  }
  return limit;
}

/** A book prefix, not a business decision: rouble sales use the RU series (§4.1). */
function invoiceRegion(currency, region) {
  if (region !== null && region !== undefined) {
    if (!/^[A-Za-z]{2}$/.test(String(region))) {
      throw new RangeError("region must be a two-letter code");
    }
    return String(region).toUpperCase();
  }
  return currency === "RUB" ? "RU" : "EU";
}

function jsonValue(value) {
  return JSON.stringify(value);
}

export const billingMoneyMethods = {
  async billingAccount(orgId) {
    const { rows } = await this.pool.query(
      "select * from billing_accounts where org_id = $1",
      [orgId],
    );
    return rows[0] ?? null;
  },

  /**
   * Create or update the payer card. The first purchase fixes the currency: invoices,
   * refunds and credit then share one book, which is what makes the balance meaningful
   * (§2.1.1). Changing it later is an operator action, not an upsert.
   */
  async upsertBillingAccount({
    orgId,
    email,
    name = null,
    country = null,
    currency = null,
    testMode = false,
  }) {
    if (typeof email !== "string" || email.trim() === "") {
      throw new TypeError("billing email is required");
    }
    const code = currency === null || currency === undefined ? null : normalCurrency(currency);

    const { rows } = await this.pool.query(
      `insert into billing_accounts
         (org_id, billing_email, billing_name, country, currency, test_mode)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id) do update
         set billing_email = excluded.billing_email,
             billing_name = coalesce(excluded.billing_name, billing_accounts.billing_name),
             country = coalesce(excluded.country, billing_accounts.country),
             currency = coalesce(billing_accounts.currency, excluded.currency),
             test_mode = excluded.test_mode
         where billing_accounts.currency is null
            or excluded.currency is null
            or billing_accounts.currency = excluded.currency
       returning *`,
      [orgId, email.trim(), name, country, code, testMode],
    );
    if (rows[0]) return rows[0];

    const existing = await this.billingAccount(orgId);
    if (existing?.currency && code && existing.currency !== code) {
      throw codedError(
        "CURRENCY_LOCKED",
        `organisation currency is fixed at ${existing.currency}`,
      );
    }
    throw new Error("billing account upsert returned no row");
  },

  /**
   * Issue an invoice with the next number of the year.
   *
   * The advisory lock is per year, so two checkouts never read the same `max`. RLS hides
   * other organisations' invoices, so a number that is already taken by another tenant
   * is invisible here; `on conflict do nothing` turns that into one retry with the next
   * sequence instead of a failed checkout. The column stays globally unique, which is
   * what a tax document requires.
   *
   * A total of zero — discount and credit cover the price — is created already paid:
   * there is nothing to collect and no payment row to invent (§3.5).
   */
  async createInvoice({
    orgId,
    subscriptionId = null,
    currency,
    lines = [],
    subtotal,
    discount = 0,
    creditApplied = 0,
    total,
    periodStart = null,
    periodEnd = null,
    dueAt = null,
    region = null,
    now = new Date(),
  }) {
    const code = normalCurrency(currency);
    const amountSubtotal = assertMinorUnits(subtotal, "subtotal");
    const amountDiscount = assertMinorUnits(discount, "discount");
    const amountCredit = assertMinorUnits(creditApplied, "creditApplied");
    const amountTotal = assertMinorUnits(total, "total");
    if (lines !== null && typeof lines !== "object") {
      throw new TypeError("lines must be a JSON array or object");
    }

    const year = now instanceof Date ? now.getUTCFullYear() : new Date(now).getUTCFullYear();
    if (!Number.isSafeInteger(year)) throw new TypeError("now must be a valid date");
    const prefix = invoiceRegion(code, region);
    const linesJson = jsonValue(lines ?? []);

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `billing_invoice_number:${year}`,
      ]);

      if (subscriptionId && periodStart) {
        const { rows: existing } = await client.query(
          `select * from invoices
            where org_id = $1 and subscription_id = $2 and period_start = $3`,
          [orgId, subscriptionId, periodStart],
        );
        if (existing[0]) {
          await client.query("commit");
          return { invoice: mapInvoice(existing[0]), created: false };
        }
      }

      const { rows: nextRows } = await client.query(
        `select coalesce(max(right(number, 6)::int), 0) + 1 as next
           from invoices
          where number ~ ('^[A-Z]{2}-' || $1::text || '-[0-9]{6}$')`,
        [String(year)],
      );
      let seq = Number(nextRows[0]?.next ?? 1);

      for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
        if (seq > 999_999) {
          throw new RangeError(`invoice sequence for ${year} is exhausted`);
        }
        const number = invoiceNumber({ year, seq, region: prefix });
        const { rows: inserted } = await client.query(
          `insert into invoices
             (org_id, subscription_id, number, status, currency, subtotal, discount,
              credit_applied, total, lines, period_start, period_end, due_at, paid_at)
           values ($1, $2, $3,
                   case when $8 = 0 then 'paid' else 'open' end,
                   $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12,
                   case when $8 = 0 then now() else null end)
           on conflict do nothing
           returning *`,
          [
            orgId,
            subscriptionId,
            number,
            code,
            amountSubtotal,
            amountDiscount,
            amountCredit,
            amountTotal,
            linesJson,
            periodStart,
            periodEnd,
            dueAt,
          ],
        );

        if (!inserted[0]) {
          // A number allocated by another tenant is invisible under RLS. Ask for the
          // idempotency pair first, then try the next sequence in the same lock.
          if (subscriptionId && periodStart) {
            const { rows: existing } = await client.query(
              `select * from invoices
                where org_id = $1 and subscription_id = $2 and period_start = $3`,
              [orgId, subscriptionId, periodStart],
            );
            if (existing[0]) {
              await client.query("commit");
              return { invoice: mapInvoice(existing[0]), created: false };
            }
          }
          seq += 1;
          continue;
        }

        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, 'invoice.created', $2, $3::jsonb)`,
          [
            orgId,
            inserted[0].id,
            jsonValue({
              number,
              currency: code,
              total: amountTotal,
              status: amountTotal === 0 ? "paid" : "open",
              subscriptionId,
            }),
          ],
        );
        await client.query("commit");
        return { invoice: mapInvoice(inserted[0]), created: true };
      }
      throw new Error(`could not allocate an invoice number for ${year}`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async invoiceById(orgId, id) {
    const { rows } = await this.pool.query(
      "select * from invoices where org_id = $1 and id = $2",
      [orgId, id],
    );
    return mapInvoice(rows[0]);
  },

  /** The invoice list with its payments, so a screen needs one round trip (§6). */
  async listInvoices(orgId, limit = 50) {
    const size = pageSize(limit, 50);
    const { rows } = await this.pool.query(
      `select i.*,
              coalesce(
                json_agg(p order by p.created_at, p.id) filter (where p.id is not null),
                '[]'::json
              ) as payments
         from invoices i
         left join payments p
           on p.invoice_id = i.id and p.org_id = i.org_id
        where i.org_id = $1
        group by i.id
        order by i.created_at desc, i.id desc
        limit $2`,
      [orgId, size],
    );
    return rows.map((row) => ({
      ...mapInvoice(row),
      payments: Array.isArray(row.payments) ? row.payments.map(mapAmount) : [],
    }));
  },

  /**
   * Mark an invoice paid by hand (stage 2: the operator is the payment service).
   *
   * The manual payment key is derived from the invoice, so a second click or a repeated
   * operator command updates the same row rather than charging twice. A payment that was
   * already refunded keeps its refunded status: marking the invoice paid again must not
   * reopen the money.
   */
  async markInvoicePaid({
    invoiceId,
    amount,
    currency,
    connectionId = null,
    providerPaymentId = null,
    receiptStatus = null,
  }) {
    const value = assertMinorUnits(amount, "amount");
    const code = normalCurrency(currency);

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: invoices } = await client.query(
        "select * from invoices where id = $1 for update",
        [invoiceId],
      );
      const invoice = invoices[0];
      if (!invoice) throw codedError("INVOICE_NOT_FOUND", "invoice does not exist");
      if (invoice.currency !== code) {
        throw codedError("CURRENCY_MISMATCH", "payment currency does not match the invoice");
      }
      if (invoice.status === "void") {
        throw codedError("INVOICE_VOID", "a void invoice cannot be paid");
      }
      const alreadyPaid = invoice.status === "paid";
      const idempotencyKey = `manual:${invoiceId}`;

      const { rows: payments } = await client.query(
        `insert into payments
           (org_id, invoice_id, connection_id, provider_payment_id, idempotency_key,
            amount, currency, status, receipt_status)
         values ($1, $2, $3, $4, $5, $6, $7, 'succeeded', $8)
         on conflict (idempotency_key) do update
           set amount = excluded.amount,
               currency = excluded.currency,
               connection_id = case
                 when payments.status in ('refunded', 'partially_refunded')
                   then payments.connection_id
                 else excluded.connection_id
               end,
               provider_payment_id = coalesce(excluded.provider_payment_id,
                                              payments.provider_payment_id),
               receipt_status = coalesce(excluded.receipt_status, payments.receipt_status),
               status = case
                 when payments.status in ('refunded', 'partially_refunded')
                   then payments.status
                 else 'succeeded'
               end,
               updated_at = now()
         returning *`,
        [
          invoice.org_id,
          invoiceId,
          connectionId ?? MANUAL_CONNECTION_ID,
          providerPaymentId,
          idempotencyKey,
          value,
          code,
          receiptStatus,
        ],
      );

      const { rows: paid } = await client.query(
        `update invoices
            set status = 'paid', paid_at = coalesce(paid_at, now())
          where id = $1
          returning *`,
        [invoiceId],
      );

      if (!alreadyPaid) {
        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, 'invoice.paid', $2, $3::jsonb)`,
          [
            invoice.org_id,
            invoiceId,
            jsonValue({
              paymentId: payments[0].id,
              amount: value,
              currency: code,
              manual: connectionId === null,
            }),
          ],
        );
      }

      await client.query("commit");
      return { invoice: mapInvoice(paid[0]), payment: mapAmount(payments[0]) };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** Void an unpaid invoice; a paid one needs a refund, not a status change. */
  async voidInvoice(orgId, invoiceId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        "select * from invoices where org_id = $1 and id = $2 for update",
        [orgId, invoiceId],
      );
      const invoice = rows[0];
      if (!invoice) {
        await client.query("commit");
        return null;
      }
      if (invoice.status === "paid") {
        throw codedError("INVOICE_PAID", "a paid invoice cannot be voided");
      }
      if (invoice.status === "void") {
        await client.query("commit");
        return mapInvoice(invoice);
      }

      const { rows: voided } = await client.query(
        "update invoices set status = 'void' where id = $1 returning *",
        [invoiceId],
      );
      await client.query(
        `insert into billing_events (org_id, type, subject_id, data)
         values ($1, 'invoice.voided', $2, $3::jsonb)`,
        [orgId, invoiceId, jsonValue({ number: invoice.number })],
      );
      await client.query("commit");
      return mapInvoice(voided[0]);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** Append a payment attempt. A repeated idempotency key returns the first row. */
  async recordPayment({
    orgId,
    invoiceId,
    connectionId = null,
    providerPaymentId = null,
    idempotencyKey,
    amount,
    currency,
    status = "pending",
    failureCode = null,
    receiptStatus = null,
  }) {
    const value = assertMinorUnits(amount, "amount");
    const code = normalCurrency(currency);
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new TypeError("idempotencyKey is required");
    }
    if (!PAYMENT_STATUSES.has(status)) throw new RangeError("unknown payment status");

    const { rows: invoices } = await this.pool.query(
      "select id, currency from invoices where org_id = $1 and id = $2",
      [orgId, invoiceId],
    );
    if (!invoices[0]) throw codedError("INVOICE_NOT_FOUND", "invoice does not exist");
    if (invoices[0].currency !== code) {
      throw codedError("CURRENCY_MISMATCH", "payment currency does not match the invoice");
    }

    const { rows } = await this.pool.query(
      `insert into payments
         (org_id, invoice_id, connection_id, provider_payment_id, idempotency_key,
          amount, currency, status, failure_code, receipt_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (idempotency_key) do nothing
       returning *`,
      [
        orgId,
        invoiceId,
        connectionId ?? MANUAL_CONNECTION_ID,
        providerPaymentId,
        idempotencyKey,
        value,
        code,
        status,
        failureCode,
        receiptStatus,
      ],
    );
    if (rows[0]) return mapAmount(rows[0]);

    const { rows: existing } = await this.pool.query(
      "select * from payments where idempotency_key = $1",
      [idempotencyKey],
    );
    if (existing[0]) return mapAmount(existing[0]);
    throw new Error(`payment ${idempotencyKey} was not recorded`);
  },

  /**
   * Append a refund and adjust the payment's status to the only meaning the new total
   * can have: fully refunded or partially refunded. The refund row itself is never
   * edited; a further refund is another row.
   */
  async recordRefund({
    orgId,
    paymentId,
    amount,
    currency,
    reason,
    status = "succeeded",
    providerRefundId = null,
    idempotencyKey,
    createdBy = null,
  }) {
    const value = assertMinorUnits(amount, "amount");
    const code = normalCurrency(currency);
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new TypeError("idempotencyKey is required");
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new TypeError("refund reason is required");
    }
    if (!REFUND_STATUSES.has(status)) throw new RangeError("unknown refund status");

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows: payments } = await client.query(
        "select * from payments where org_id = $1 and id = $2 for update",
        [orgId, paymentId],
      );
      const payment = payments[0];
      if (!payment) throw codedError("PAYMENT_NOT_FOUND", "payment does not exist");
      if (payment.currency !== code) {
        throw codedError("CURRENCY_MISMATCH", "refund currency does not match the payment");
      }

      const { rows: existing } = await client.query(
        "select * from refunds where idempotency_key = $1",
        [idempotencyKey],
      );
      if (existing[0]) {
        await client.query("commit");
        return mapAmount(existing[0]);
      }

      const { rows: totals } = await client.query(
        `select coalesce(sum(amount), 0)::text as refunded
           from refunds
          where org_id = $1 and payment_id = $2
            and status in ('pending', 'succeeded')`,
        [orgId, paymentId],
      );
      const refunded = Number(totals[0]?.refunded ?? 0);
      if (refunded + value > Number(payment.amount)) {
        throw codedError("REFUND_EXCEEDS_PAYMENT", "refund is larger than the payment");
      }

      const { rows: inserted } = await client.query(
        `insert into refunds
           (org_id, payment_id, amount, currency, reason, status, provider_refund_id,
            idempotency_key, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning *`,
        [
          orgId,
          paymentId,
          value,
          code,
          reason.trim(),
          status,
          providerRefundId,
          idempotencyKey,
          createdBy,
        ],
      );

      if (status === "succeeded") {
        const nextStatus = refunded + value >= Number(payment.amount)
          ? "refunded"
          : "partially_refunded";
        await client.query(
          "update payments set status = $2, updated_at = now() where id = $1",
          [paymentId, nextStatus],
        );
        await client.query(
          `insert into billing_events (org_id, type, subject_id, data)
           values ($1, 'payment.refunded', $2, $3::jsonb)`,
          [
            orgId,
            paymentId,
            jsonValue({
              refundId: inserted[0].id,
              amount: value,
              currency: code,
              full: nextStatus === "refunded",
            }),
          ],
        );
      }

      await client.query("commit");
      return mapAmount(inserted[0]);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** A positive journal row: proration, goodwill or a refund moved into credit. */
  async appendCredit({
    orgId,
    amount,
    currency,
    kind,
    invoiceId = null,
    note = null,
    createdBy = null,
  }) {
    const value = assertSignedMinorUnits(amount, "amount");
    const code = normalCurrency(currency);
    if (!LEDGER_KINDS.has(kind)) throw new RangeError("unknown credit kind");
    if (kind === "applied" ? value > 0 : value < 0) {
      throw new RangeError("applied credit must be negative and every other kind positive");
    }
    if (invoiceId) {
      const { rows } = await this.pool.query(
        "select id from invoices where org_id = $1 and id = $2",
        [orgId, invoiceId],
      );
      if (!rows[0]) throw codedError("INVOICE_NOT_FOUND", "invoice does not exist");
    }

    const { rows } = await this.pool.query(
      `insert into org_credit_ledger
         (org_id, amount, currency, kind, invoice_id, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [orgId, value, code, kind, invoiceId, note, createdBy],
    );
    return mapAmount(rows[0]);
  },

  /** The balance is the journal sum; there is no stored counter to drift. */
  async creditBalance(orgId, currency) {
    const code = normalCurrency(currency);
    const { rows } = await this.pool.query(
      `select coalesce(sum(amount), 0)::text as balance
         from org_credit_ledger
        where org_id = $1 and currency = $2`,
      [orgId, code],
    );
    const balance = Number(rows[0]?.balance ?? 0);
    if (!Number.isSafeInteger(balance)) {
      throw new RangeError("credit balance is outside the safe integer range");
    }
    return balance;
  },

  /**
   * Spend credit on an invoice. The lock serialises two checkouts of the same balance,
   * and the journal is written only after the balance proves sufficient, so a race can
   * never produce a negative balance.
   */
  async applyCredit({ orgId, currency, amount, invoiceId }) {
    const value = assertMinorUnits(amount, "amount");
    const code = normalCurrency(currency);
    if (value <= 0) throw new RangeError("credit to apply must be positive");

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `billing_credit:${orgId}:${code}`,
      ]);

      const { rows: balances } = await client.query(
        `select coalesce(sum(amount), 0)::text as balance
           from org_credit_ledger
          where org_id = $1 and currency = $2`,
        [orgId, code],
      );
      const balance = Number(balances[0]?.balance ?? 0);
      if (!Number.isSafeInteger(balance) || balance < value) {
        throw codedError("INSUFFICIENT_CREDIT", "credit balance is too small");
      }

      const { rows: invoices } = await client.query(
        "select id, currency from invoices where org_id = $1 and id = $2",
        [orgId, invoiceId],
      );
      if (!invoices[0]) throw codedError("INVOICE_NOT_FOUND", "invoice does not exist");
      if (invoices[0].currency !== code) {
        throw codedError("CURRENCY_MISMATCH", "credit currency does not match the invoice");
      }

      const { rows } = await client.query(
        `insert into org_credit_ledger
           (org_id, amount, currency, kind, invoice_id, note)
         values ($1, $2, $3, 'applied', $4, $5)
         returning *`,
        [orgId, -value, code, invoiceId, "applied at checkout"],
      );
      await client.query("commit");
      return mapAmount(rows[0]);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** The global code book, with the frozen target amount joined in for `price_override`. */
  async promoByCode(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    const { rows } = await this.pool.query(
      `select c.*, p.amount as target_amount, p.currency as target_currency
         from promo_codes c
         left join prices p on p.id = c.target_price_id
        where c.code = $1`,
      [normalized],
    );
    return mapPromo(rows[0]);
  },

  /** Count a redemption only while the code is live and below its limit. */
  async redeemPromo(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return false;
    const { rows } = await this.pool.query(
      `update promo_codes
          set redeemed = redeemed + 1
        where code = $1
          and (max_redemptions is null or redeemed < max_redemptions)
          and (expires_at is null or expires_at > now())
        returning id`,
      [normalized],
    );
    return rows.length > 0;
  },

  async billingEvents(orgId, limit = 100) {
    const size = pageSize(limit, 100);
    const { rows } = await this.pool.query(
      `select * from billing_events
        where org_id = $1
        order by occurred_at desc, id desc
        limit $2`,
      [orgId, size],
    );
    return rows;
  },
};
