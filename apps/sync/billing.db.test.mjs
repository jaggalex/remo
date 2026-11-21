/**
 * Billing core against a real database (ADR-247, `spec/billing.md` §2.3, §5, §11).
 *
 * What the unit tests cannot prove: schema 22 really lands with the billing tables and
 * the two new columns, `seatUsage` counts exactly the people §2.3 calls a seat, the room
 * counter ignores the trash, `entitlementsFor` reads a live subscription through
 * `withTenant`, and the tenant policy hides one organisation's billing rows from another.
 *
 * Enabling RLS here touches only the new billing tables. Locking `boards` or
 * `event_outbox` with `FORCE ROW LEVEL SECURITY` would deadlock against the suites that
 * share this database, so the policy on the eight tenant tables is installed below and
 * `rls.test.mjs` proves the whole `rls.sql` on its own database.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entitlementsFor, resetEntitlementCache } from "./billing.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("billing");
const store = opened?.store ?? null;

const TENANT_TABLES = [
  "billing_accounts",
  "payment_methods",
  "subscriptions",
  "invoices",
  "payments",
  "refunds",
  "org_credit_ledger",
  "billing_events",
];

const orgA = randomUUID();
const orgB = randomUUID();

const people = {
  member: randomUUID(),
  invited: randomUUID(),
  guestEditor: randomUUID(),
  guestViewer: randomUUID(),
  guestCommenter: randomUUID(),
  guestExpired: randomUUID(),
  outsider: randomUUID(),
};

const boardActive = `billing-active-${orgA}`;
const boardTrashed = `billing-trashed-${orgA}`;
const boardOther = `billing-other-${orgB}`;

const ON = { REMO_BILLING: "on" };

/** The shared fixture: two organisations and every seat case of §2.3. */
async function seed() {
  for (const [name, id] of Object.entries(people)) {
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle)
       values ($1, $2, 'x', $3, $4)`,
      [id, `billing-${name}-${orgA}@example.test`, name, `bl-${name.slice(0, 12)}-${id.slice(0, 8)}`],
    );
  }

  await store.pool.query(
    "insert into orgs (id, name, slug) values ($1, 'Billing A', $2), ($3, 'Billing B', $4)",
    [orgA, `billing-a-${orgA}`, orgB, `billing-b-${orgB}`],
  );
  await store.pool.query(
    `insert into org_memberships (org_id, user_id, relation, state)
     values ($1, $2, 'member', 'active'),
            ($1, $3, 'member', 'invited'),
            ($1, $4, 'guest', 'active'),
            ($1, $5, 'guest', 'active'),
            ($1, $6, 'guest', 'active'),
            ($1, $7, 'guest', 'active'),
            ($8, $9, 'member', 'active')`,
    [
      orgA,
      people.member,
      people.invited,
      people.guestEditor,
      people.guestViewer,
      people.guestCommenter,
      people.guestExpired,
      orgB,
      people.outsider,
    ],
  );
  await store.pool.query(
    `insert into boards (id, title, org_id, owner_id, archived_at)
     values ($1, 'Active', $3, $5, null),
            ($2, 'Trashed', $3, $5, now()),
            ($4, 'Other', $6, $7, null)`,
    [boardActive, boardTrashed, orgA, boardOther, people.member, orgB, people.outsider],
  );
  await store.pool.query(
    `insert into board_grants (board_id, subject_type, subject_id, role, expires_at)
     values ($1, 'user', $2, 'editor', null),
            ($1, 'user', $3, 'viewer', null),
            ($1, 'user', $4, 'commenter', null),
            ($1, 'user', $5, 'editor', now() - interval '1 day')`,
    [boardActive, people.guestEditor, people.guestViewer, people.guestCommenter, people.guestExpired],
  );
}

/** One row per tenant billing table, written under its own organisation. */
async function seedBillingRows() {
  await store.withTenant(orgA, async () => {
    const { rows: methods } = await store.pool.query(
      `insert into payment_methods
         (org_id, connection_id, ref_ciphertext, ref_nonce, ref_dek_wrapped, ref_dek_nonce,
          ref_kek_id, display, autopay_consent_at, autopay_consent_version)
       values ($1, $2, $3, $4, $5, $6, 'test-kek',
               '{"kind":"card","last4":"4242"}'::jsonb, now(), 'v1')
       returning id`,
      [
        orgA,
        randomUUID(),
        Buffer.from("ref"),
        Buffer.from("nonce"),
        Buffer.from("dek"),
        Buffer.from("dek-nonce"),
      ],
    );
    const { rows: subscriptions } = await store.pool.query(
      `insert into subscriptions
         (org_id, plan, price_id, amount, currency, interval, status,
          current_period_start, current_period_end, payment_method_id)
       values ($1, 'pro', 'pro-rub-month-v1', 29000, 'RUB', 'month', 'active',
               now(), now() + interval '1 month', $2)
       returning id`,
      [orgA, methods[0].id],
    );
    const { rows: invoices } = await store.pool.query(
      `insert into invoices
         (org_id, subscription_id, number, status, currency, subtotal, total, lines,
          period_start, period_end)
       values ($1, $2, $3, 'open', 'RUB', 29000, 29000, '[]'::jsonb,
               now(), now() + interval '1 month')
       returning id`,
      [orgA, subscriptions[0].id, `BILL-${orgA.slice(0, 8)}-1`],
    );
    const { rows: payments } = await store.pool.query(
      `insert into payments
         (org_id, invoice_id, connection_id, idempotency_key, amount, currency, status)
       values ($1, $2, $3, $4, 29000, 'RUB', 'pending')
       returning id`,
      [orgA, invoices[0].id, randomUUID(), `bill:${orgA}:1`],
    );
    await store.pool.query(
      `insert into refunds
         (org_id, payment_id, amount, currency, reason, status, idempotency_key)
       values ($1, $2, 1000, 'RUB', 'test', 'succeeded', $3)`,
      [orgA, payments[0].id, `refund:${orgA}:1`],
    );
    await store.pool.query(
      `insert into org_credit_ledger (org_id, amount, currency, kind)
       values ($1, 100, 'RUB', 'goodwill')`,
      [orgA],
    );
    await store.pool.query(
      `insert into billing_events (org_id, type, data)
       values ($1, 'subscription.activated', '{}'::jsonb)`,
      [orgA],
    );
    await store.pool.query(
      `insert into billing_accounts (org_id, billing_email, currency)
       values ($1, 'billing@example.test', 'RUB')`,
      [orgA],
    );
  });
}

/**
 * Install the tenant policy on the billing tables only. The policy text is the loop from
 * `rls.sql`; the role setup is the same one `rls.test.mjs` performs in its own database.
 */
async function installBillingPolicies() {
  const client = await store.pool.connect();
  try {
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
  } finally {
    client.release();
  }
}

describe.skipIf(!store)("db:billing (ADR-247)", () => {
  beforeAll(async () => {
    resetEntitlementCache();
    await seed();
    await installBillingPolicies();
  });

  afterAll(async () => {
    if (!store) return;
    // Policies must not decide whether the fixture can be removed.
    for (const table of TENANT_TABLES) {
      await store.pool.query(`alter table ${table} no force row level security`).catch(() => {});
      await store.pool.query(`alter table ${table} disable row level security`).catch(() => {});
    }
    const orgs = [orgA, orgB];
    for (const table of [
      "refunds",
      "payments",
      "invoices",
      "subscriptions",
      "payment_methods",
      "org_credit_ledger",
      "billing_events",
      "billing_accounts",
    ]) {
      await store.pool.query(`delete from ${table} where org_id = any($1::uuid[])`, [orgs]);
    }
    await store.pool.query("delete from boards where id = any($1::text[])", [
      [boardActive, boardTrashed, boardOther],
    ]);
    await store.pool.query("delete from orgs where id = any($1::uuid[])", [orgs]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [
      Object.values(people),
    ]);
    await store.close();
  });

  it("applies schema 27 with the billing tables and the two new columns", async () => {
    const { rows: meta } = await store.pool.query("select version from schema_meta where id = 1");
    expect(meta[0].version).toBe(27);

    const billingTables = [
      "prices",
      "price_events",
      "billing_accounts",
      "payment_methods",
      "subscriptions",
      "invoices",
      "payments",
      "refunds",
      "org_credit_ledger",
      "promo_codes",
      "billing_events",
      "payment_connections",
      "payment_connection_events",
      "billing_provider_events",
      "instance_operators",
    ];
    const { rows: tables } = await store.pool.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])
        order by table_name`,
      [billingTables],
    );
    expect(tables.map((row) => row.table_name)).toEqual([...billingTables].sort());

    const { rows: columns } = await store.pool.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'boards' and column_name = 'frozen_at')
            or (table_name = 'orgs' and column_name = 'read_only_at'))`,
    );
    expect(columns).toHaveLength(2);

    const { rows: indexes } = await store.pool.query(
      `select indexname from pg_indexes
        where schemaname = 'public'
          and indexname in ('prices_for_sale_idx', 'subscriptions_live_idx')
        order by indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      "prices_for_sale_idx",
      "subscriptions_live_idx",
    ]);
  });

  it("counts one seat per active member and per guest editor", async () => {
    const seats = await store.withTenant(orgA, () => store.seatUsage(orgA));

    // member + guest editor. The invited member, the viewer, the commenter and a guest
    // whose editor grant has expired do not hold a seat.
    expect(seats).toBe(2);
  });

  it("counts the other organisation's seats without borrowing a guest", async () => {
    const seats = await store.withTenant(orgB, () => store.seatUsage(orgB));

    expect(seats).toBe(1);
  });

  it("counts active rooms only", async () => {
    const active = await store.withTenant(orgA, () => store.activeRoomCount(orgA));
    const other = await store.withTenant(orgB, () => store.activeRoomCount(orgB));

    expect(active).toBe(1);
    expect(other).toBe(1);
  });

  it("names every billing tenant table in rls.sql and the admin inventory", () => {
    const rlsSql = readFileSync(new URL("./rls.sql", import.meta.url), "utf8");
    const rlsAdmin = readFileSync(new URL("./rls-admin.mjs", import.meta.url), "utf8");

    for (const table of TENANT_TABLES) {
      expect(rlsSql).toContain(`'${table}'`);
      expect(rlsAdmin).toContain(`"${table}"`);
    }
  });

  it("resolves the plan of a live subscription and hides it from another tenant", async () => {
    await seedBillingRows();

    // The store path: personal check and subscription read under the organisation.
    const entitlements = await entitlementsFor(store, orgA, { env: ON });
    expect(entitlements).toMatchObject({ plan: "pro", status: "active", reason: "plan" });

    const client = await store.pool.connect();
    try {
      await client.query("set role remo_app");

      await client.query("select set_config('app.org_id', $1, false)", [orgA]);
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query(`select count(*)::int as n from ${table}`);
        expect(rows[0].n, table).toBe(1);
      }

      // The second organisation sees none of the first organisation's rows.
      await client.query("select set_config('app.org_id', $1, false)", [orgB]);
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query(`select count(*)::int as n from ${table}`);
        expect(rows[0].n, table).toBe(0);
      }

      await expect(
        client.query("insert into billing_events (org_id, type) values ($1, 'rls.test')", [orgA]),
      ).rejects.toThrow(/row-level security/);

      // No setting at all is zero rows, never every row.
      await client.query("reset app.org_id");
      const { rows: unseen } = await client.query("select count(*)::int as n from billing_accounts");
      expect(unseen[0].n).toBe(0);
    } finally {
      await client.query("reset app.org_id").catch(() => {});
      await client.query("reset role").catch(() => {});
      client.release();
    }
  });
});
