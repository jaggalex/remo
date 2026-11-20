/**
 * Payment connections against a real database (ADR-248, `spec/payment-providers.md`
 * §2–§3, §6).
 *
 * What the pure tests cannot prove: the routing SQL really filters by mode, currency,
 * group and status and orders by priority; the sealed envelope round-trips with the AAD
 * while `listConnections` exposes only the fingerprint; the disable guard sees a live
 * subscription behind RLS; and re-granting the operator role is idempotent.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, fingerprintSecret } from "./secrets.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("payment-providers");
const store = opened?.store ?? null;

const KEK = { key: randomBytes(32), id: "test-kek" };

const ids = {
  manualSlow: randomUUID(),
  manualFast: randomUUID(),
  manualTest: randomUUID(),
  manualPaused: randomUUID(),
  yookassa: randomUUID(),
  org: randomUUID(),
  user: randomUUID(),
};

const envelope = (id, provider, secret) => {
  const text = JSON.stringify(secret);
  return {
    ...encryptSecret(text, { scope: "connection", scopeId: id, provider, id, kek: KEK }),
    fingerprint: fingerprintSecret(text),
  };
};

async function makeConnection({
  id = randomUUID(),
  provider = "manual",
  mode = "live",
  currencies = ["RUB"],
  methodGroups = ["invoice"],
  priority = 100,
  name = "connection",
  sealed = null,
} = {}) {
  const row = await store.createConnection({
    id,
    provider,
    name,
    mode,
    currencies,
    methodGroups,
    priority,
    settings: { requisites: "р/с 40702810" },
    sealed,
  });
  return store.setConnectionStatus(row.id, {
    from: "draft",
    to: "active",
    reason: "test fixture",
  });
}

async function seed() {
  await store.pool.query(
    `insert into users (id, email, password_hash, name, handle)
     values ($1, $2, 'x', 'Operator', $3)`,
    [ids.user, `operator-${ids.user}@example.test`, `op-${ids.user.slice(0, 8)}`],
  );

  const manualSlow = await makeConnection({
    id: ids.manualSlow,
    priority: 50,
    name: "Manual slow",
  });
  await makeConnection({ id: ids.manualFast, priority: 20, name: "Manual fast" });
  await makeConnection({
    id: ids.manualTest,
    mode: "test",
    priority: 1,
    name: "Manual test",
  });
  const paused = await makeConnection({
    id: ids.manualPaused,
    priority: 1,
    name: "Manual paused",
  });
  await store.setConnectionStatus(paused.id, {
    from: "active",
    to: "paused",
    reason: "test fixture",
  });
  await makeConnection({
    id: ids.yookassa,
    provider: "yookassa",
    methodGroups: ["ru_card"],
    priority: 10,
    name: "YooKassa live",
    sealed: envelope(ids.yookassa, "yookassa", { shopId: "123", secretKey: "sk-live" }),
  });

  await store.pool.query(
    "insert into orgs (id, name, slug) values ($1, 'Provider test', $2)",
    [ids.org, `provider-test-${ids.org}`],
  );
  await store.pool.query(
    `insert into subscriptions
       (org_id, plan, price_id, amount, currency, interval, status,
        current_period_start, current_period_end, connection_id)
     values ($1, 'pro', 'pro-rub-month-v1', 29000, 'RUB', 'month', 'active',
             now(), now() + interval '1 month', $2)`,
    [ids.org, manualSlow.id],
  );
}

beforeAll(async () => {
  if (store) await seed();
});

afterAll(async () => {
  if (!store) return;
  const connections = [
    ids.manualSlow,
    ids.manualFast,
    ids.manualTest,
    ids.manualPaused,
    ids.yookassa,
  ];
  await store.pool.query(
    "delete from payment_connection_events where connection_id = any($1::uuid[])",
    [connections],
  );
  await store.pool.query("delete from payment_connections where id = any($1::uuid[])", [
    connections,
  ]);
  await store.pool.query("delete from subscriptions where org_id = $1", [ids.org]);
  await store.pool.query("delete from orgs where id = $1", [ids.org]);
  await store.pool.query("delete from instance_operators where user_id = $1", [ids.user]);
  await store.pool.query("delete from users where id = $1", [ids.user]);
});

describe.skipIf(!store)("db:payment connections (ADR-248)", () => {
  it("routes by status, mode, currency, group and priority", async () => {
    const invoice = await store.routesFor({ methodGroup: "invoice", currency: "RUB", testMode: false });
    expect(invoice.map((row) => row.id)).toEqual([ids.manualFast, ids.manualSlow]);

    const ruCard = await store.routesFor({ methodGroup: "ru_card", currency: "RUB", testMode: false });
    expect(ruCard.map((row) => row.id)).toEqual([ids.yookassa]);

    const testMode = await store.routesFor({ methodGroup: "invoice", currency: "RUB", testMode: true });
    expect(testMode.map((row) => row.id)).toEqual([ids.manualTest]);

    expect(await store.routesFor({ methodGroup: "invoice", currency: "USD", testMode: false })).toEqual([]);
    expect(await store.routesFor({ methodGroup: "global_card", currency: "RUB", testMode: false })).toEqual([]);
  });

  it("orders the catalogue's method groups by best priority", async () => {
    expect(await store.methodGroupsFor({ currency: "RUB", testMode: false })).toEqual([
      "ru_card",
      "invoice",
    ]);
    expect(await store.methodGroupsFor({ currency: "RUB", testMode: true })).toEqual(["invoice"]);
    expect(await store.methodGroupsFor({ currency: "USD", testMode: false })).toEqual([]);
  });

  it("lists connections without any sealed column or webhook token", async () => {
    const rows = await store.listConnections();
    const yookassa = rows.find((row) => row.id === ids.yookassa);
    expect(yookassa.has_secret).toBe(true);
    expect(yookassa.secret_fingerprint).toBe(
      fingerprintSecret(JSON.stringify({ shopId: "123", secretKey: "sk-live" })),
    );
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("webhookToken");

    const full = await store.connectionById(ids.yookassa);
    expect(full.webhookToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it("rotates a secret and records both events", async () => {
    const next = envelope(ids.yookassa, "yookassa", { shopId: "123", secretKey: "sk-next" });
    const rotated = await store.rotateConnectionSecret(ids.yookassa, next, { reason: "quarterly" });
    expect(rotated.secret_fingerprint).toBe(next.fingerprint);

    const { rows } = await store.pool.query(
      `select type from payment_connection_events
        where connection_id = $1 order by occurred_at asc`,
      [ids.yookassa],
    );
    expect(rows.map((row) => row.type)).toEqual(["created", "status_changed", "secret_rotated"]);
  });

  it("records a status change with its reason and refuses a stale from", async () => {
    await store.setConnectionStatus(ids.manualSlow, {
      from: "active",
      to: "paused",
      reason: "provider incident",
    });
    const { rows } = await store.pool.query(
      `select from_status, to_status, reason from payment_connection_events
        where connection_id = $1 and type = 'status_changed'
        order by occurred_at desc limit 1`,
      [ids.manualSlow],
    );
    expect(rows[0]).toEqual({
      from_status: "active",
      to_status: "paused",
      reason: "provider incident",
    });

    await expect(
      store.setConnectionStatus(ids.manualSlow, {
        from: "ready",
        to: "active",
        reason: "stale click",
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_STATUS_CONFLICT" });

    // Repeating the same target is a no-op, so a retried command adds no second event.
    await store.setConnectionStatus(ids.manualSlow, {
      from: "active",
      to: "paused",
      reason: "retried",
    });
    await store.setConnectionStatus(ids.manualSlow, {
      from: "paused",
      to: "active",
      reason: "back",
    });
  });

  it("sees a live subscription behind RLS, so disable has something to refuse", async () => {
    const live = await store.liveSubscriptionsForConnection(ids.manualSlow);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ org_id: ids.org, plan: "pro", status: "active" });
    expect(await store.liveSubscriptionsForConnection(ids.manualFast)).toEqual([]);
  });

  it("grants the instance operator role by email, idempotently", async () => {
    expect(await store.isInstanceOperator(ids.user)).toBe(false);
    const granted = await store.grantInstanceOperator({
      email: `OPERATOR-${ids.user}@example.test`,
    });
    expect(granted).toMatchObject({ userId: ids.user, email: `operator-${ids.user}@example.test` });
    expect(await store.isInstanceOperator(ids.user)).toBe(true);

    await store.grantInstanceOperator({ email: `operator-${ids.user}@example.test` });
    const { rows } = await store.pool.query(
      "select count(*)::int as n from instance_operators where user_id = $1",
      [ids.user],
    );
    expect(rows[0].n).toBe(1);
  });

  it("marks health without touching the lifecycle", async () => {
    expect(await store.setConnectionHealth(ids.manualFast, { ok: false, error: "dns" })).toBe(true);
    const [row] = (await store.listConnections()).filter((item) => item.id === ids.manualFast);
    expect(row.status).toBe("active");
    expect(row.lastHealthError).toBe("dns");
  });
});
