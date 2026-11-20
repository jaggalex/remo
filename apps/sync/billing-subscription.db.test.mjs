/**
 * Subscription lifecycle over HTTP (ADR-247 §3.2, §3.4, §6; `spec/billing.md` §13.5).
 *
 * What the pure tests cannot prove: cancel and resume move the flag without moving the
 * period, a repeated click writes one event, detaching the card stops the renewal in the
 * same transaction, the summary shows the card's display fields and nothing sealed, and
 * the two refusals a route must keep apart — `404` for another organisation, `403` for a
 * member who is not an admin.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleBilling } from "./billing-api.mjs";
import { resetEntitlementCache } from "./billing.mjs";
import { hashToken } from "./iam.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("billing subscription");
const store = database?.store ?? null;
const suite = store ? describe : describe.skip;
const stamp = Date.now();
const PASSWORD_HASH = "scrypt$placeholder";
const KEK = { key: randomBytes(32), id: "test-kek" };
const CONNECTION = randomUUID();
const ON = { REMO_BILLING: "on" };

/** Every organisation and user this suite created, removed in `afterAll`. */
const createdOrgs = [];
const createdUsers = [];

let server = null;
let base = "";

beforeAll(async () => {
  if (!store) return;
  resetEntitlementCache();
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const orgId = /^\/orgs\/([^/]+)\//.exec(url.pathname)?.[1];
    const handled = orgId
      ? await store.withTenant(orgId, () =>
          handleBilling({ request, response, url, store, env: ON }),
        )
      : await handleBilling({ request, response, url, store, env: ON });
    if (handled) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!store) return;
  for (const orgId of createdOrgs) {
    await store.withTenant(orgId, async () => {
      // Money rows are `on delete restrict` on purpose (§5); remove them first.
      for (const table of [
        "refunds",
        "payments",
        "invoices",
        "billing_events",
        "org_credit_ledger",
        "subscriptions",
        "payment_methods",
        "billing_accounts",
      ]) {
        await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
      }
    });
    await store.pool.query("delete from orgs where id = $1", [orgId]);
  }
  if (createdUsers.length > 0) {
    await store.pool.query("delete from users where id = any($1::uuid[])", [createdUsers]);
  }
  await store.close();
});

async function user(tag) {
  const created = await store.createUser({
    email: `subscription-${tag}-${stamp}@example.test`,
    passwordHash: PASSWORD_HASH,
    name: tag,
    handle: `subscription-${tag}-${stamp}`,
  });
  createdUsers.push(created.id);
  return created;
}

async function session(userId, tag) {
  const token = `test-session-${tag}-${stamp}-${Math.random()}`;
  await store.createSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return `remo_session=${token}`;
}

/** A shared organisation with an owner (an `org_admin`) and a plain member. */
async function organisation(tag) {
  const owner = await user(`${tag}-owner`);
  const member = await user(`${tag}-member`);
  const { org } = await store.createOrgWithOwner({
    name: `Subscription ${tag}`,
    slug: `subscription-${tag}-${stamp}`,
    userId: owner.id,
    kind: "shared",
  });
  createdOrgs.push(org.id);

  // A member needs a seat but no admin role; the route must tell the two apart.
  await store.withTenant(org.id, () =>
    store.pool.query(
      `insert into org_memberships (org_id, user_id, relation, state)
       values ($1, $2, 'member', 'active')`,
      [org.id, member.id],
    ),
  );

  return {
    org,
    owner,
    member,
    adminCookie: await session(owner.id, `${tag}-owner`),
    memberCookie: await session(member.id, `${tag}-member`),
  };
}

/** The operator's side of stage 2: a live subscription with a fixed period. */
async function operatorPlan(orgId, { until } = {}) {
  const end = until ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const subscription = await store.withTenant(orgId, () =>
    store.upsertOperatorPlan({
      orgId,
      plan: "pro",
      priceId: "pro-tst-month-v1",
      amount: 29000,
      currency: "TST",
      interval: "month",
      until: end,
    }),
  );
  return { ...subscription, periodEnd: end };
}

function savedCard(orgId, tag = "card") {
  return store.withTenant(orgId, () =>
    store.savePaymentMethod({
      orgId,
      connectionId: CONNECTION,
      ref: `pm_${tag}_secret_reference`,
      display: { kind: "card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
      consentVersion: "terms-2026-11",
      kek: KEK,
    }),
  );
}

async function call(path, { method = "GET", cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function events(orgId, type) {
  return store.withTenant(orgId, async () => {
    const { rows } = await store.pool.query(
      `select count(*)::int as n from billing_events where org_id = $1 and type = $2`,
      [orgId, type],
    );
    return rows[0].n;
  });
}

function subscriptionRow(orgId) {
  return store.withTenant(orgId, () => store.liveSubscription(orgId));
}

suite("billing subscription routes (ADR-247 §3.4, §6)", () => {
  it("cancels at the period end without moving the period", async () => {
    const { org, adminCookie } = await organisation("cancel");
    const plan = await operatorPlan(org.id);

    const cancelled = await call(`/orgs/${org.id}/billing/cancel`, {
      method: "POST",
      cookie: adminCookie,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancelAtPeriodEnd).toBe(true);
    expect(new Date(cancelled.body.currentPeriodEnd).getTime()).toBe(plan.periodEnd.getTime());

    const row = await subscriptionRow(org.id);
    expect(row.status).toBe("active");
    expect(row.cancel_at_period_end).toBe(true);
    expect(new Date(row.current_period_end).getTime()).toBe(plan.periodEnd.getTime());
    expect(await events(org.id, "subscription.canceled_at_period_end")).toBe(1);
  });

  it("resumes a cancelled subscription on the same period", async () => {
    const { org, adminCookie } = await organisation("resume");
    const plan = await operatorPlan(org.id);
    await call(`/orgs/${org.id}/billing/cancel`, { method: "POST", cookie: adminCookie });

    const resumed = await call(`/orgs/${org.id}/billing/resume`, {
      method: "POST",
      cookie: adminCookie,
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.cancelAtPeriodEnd).toBe(false);

    const row = await subscriptionRow(org.id);
    expect(row.cancel_at_period_end).toBe(false);
    expect(row.status).toBe("active");
    expect(new Date(row.current_period_end).getTime()).toBe(plan.periodEnd.getTime());
  });

  it("is idempotent: a second cancel keeps one event and one period", async () => {
    const { org, adminCookie } = await organisation("idempotent");
    const plan = await operatorPlan(org.id);

    const first = await call(`/orgs/${org.id}/billing/cancel`, {
      method: "POST",
      cookie: adminCookie,
    });
    const second = await call(`/orgs/${org.id}/billing/cancel`, {
      method: "POST",
      cookie: adminCookie,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.cancelAtPeriodEnd).toBe(true);
    expect(new Date(second.body.currentPeriodEnd).getTime()).toBe(plan.periodEnd.getTime());
    expect(await events(org.id, "subscription.canceled_at_period_end")).toBe(1);
  });

  it("answers 409 when there is no live subscription to cancel", async () => {
    const { org, adminCookie } = await organisation("none");

    const cancelled = await call(`/orgs/${org.id}/billing/cancel`, {
      method: "POST",
      cookie: adminCookie,
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error).toBe("NO_SUBSCRIPTION");
  });

  it("detaches the card and stops the renewal in one action", async () => {
    const { org, adminCookie } = await organisation("detach");
    const plan = await operatorPlan(org.id);
    const card = await savedCard(org.id);

    const detached = await call(`/orgs/${org.id}/billing/payment-method`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    expect(detached.status).toBe(200);
    expect(detached.body).toEqual({ ok: true });

    expect(await store.withTenant(org.id, () => store.paymentMethod(org.id))).toBeNull();
    const row = await subscriptionRow(org.id);
    expect(row.payment_method_id).toBeNull();
    expect(row.cancel_at_period_end).toBe(true);
    expect(row.status).toBe("active");
    expect(new Date(row.current_period_end).getTime()).toBe(plan.periodEnd.getTime());

    expect(await events(org.id, "payment_method.revoked")).toBe(1);
    expect(await events(org.id, "subscription.canceled_at_period_end")).toBe(1);

    const { rows } = await store.withTenant(org.id, () =>
      store.pool.query("select state from payment_methods where id = $1", [card.id]),
    );
    expect(rows[0].state).toBe("revoked");

    const again = await call(`/orgs/${org.id}/billing/payment-method`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    expect(again.status).toBe(404);
  });

  it("refuses to replace a card until the provider widget exists", async () => {
    const { org, adminCookie } = await organisation("replace");
    await operatorPlan(org.id);

    const replaced = await call(`/orgs/${org.id}/billing/payment-method`, {
      method: "POST",
      cookie: adminCookie,
    });
    expect(replaced.status).toBe(501);
    expect(replaced.body.error).toBe("NOT_IMPLEMENTED");
    expect(replaced.body.message).toBe("замена карты появится вместе с виджетом провайдера");
  });

  it("shows the card display fields and a non-zero credit, never the sealed reference", async () => {
    const { org, adminCookie } = await organisation("summary");
    await operatorPlan(org.id);
    await savedCard(org.id);
    await store.withTenant(org.id, () =>
      store.upsertBillingAccount({
        orgId: org.id,
        email: `billing-${stamp}@example.test`,
        currency: "TST",
      }),
    );

    const before = await call(`/orgs/${org.id}/billing`, { cookie: adminCookie });
    expect(before.status).toBe(200);
    expect(before.body.paymentMethod).toEqual({
      kind: "card",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
    expect(before.body.credit).toBeNull();
    expect(before.body.cancelAtPeriodEnd).toBe(false);
    expect(before.body.trialEnd).toBeNull();
    const raw = JSON.stringify(before.body);
    expect(raw).not.toContain("pm_");
    expect(raw).not.toContain("ciphertext");
    expect(raw).not.toContain("sealed");

    await store.withTenant(org.id, () =>
      store.appendCredit({
        orgId: org.id,
        amount: 500,
        currency: "TST",
        kind: "goodwill",
        note: "test",
      }),
    );

    const after = await call(`/orgs/${org.id}/billing`, { cookie: adminCookie });
    expect(after.body.credit).toEqual({ amount: 500, currency: "TST" });
  });

  it("hides another organisation's subscription behind 404", async () => {
    const owner = await organisation("owner");
    const stranger = await organisation("stranger");
    await operatorPlan(owner.org.id);

    for (const [path, method] of [
      [`/orgs/${owner.org.id}/billing/cancel`, "POST"],
      [`/orgs/${owner.org.id}/billing/resume`, "POST"],
      [`/orgs/${owner.org.id}/billing/payment-method`, "DELETE"],
      [`/orgs/${owner.org.id}/billing`, "GET"],
    ]) {
      const answer = await call(path, { method, cookie: stranger.adminCookie });
      expect(answer.status, `${method} ${path}`).toBe(404);
    }
  });

  it("lets a member read the plan without the card, and refuses admin actions with 403", async () => {
    const { org, adminCookie, memberCookie } = await organisation("member");
    await operatorPlan(org.id);
    await savedCard(org.id);

    const summary = await call(`/orgs/${org.id}/billing`, { cookie: memberCookie });
    expect(summary.status).toBe(200);
    // §3.2: a member sees the plan and the limits, never the payer's card.
    expect(summary.body.paymentMethod).toBeNull();
    // The same summary carries storage (§7 of the image spec). The install-wide sum is
    // restricted to one organisation by the policies `db:rls:enable` installs, which the
    // test database does not run, so this proves the shape and the plan's ceiling; the
    // exact number is pinned by the store double in `payment-providers.test.mjs`.
    expect(summary.body.storage).toMatchObject({ limitBytes: null });
    expect(Number.isInteger(summary.body.storage.usedBytes)).toBe(true);
    const adminView = await call(`/orgs/${org.id}/billing`, { cookie: adminCookie });
    expect(adminView.body.paymentMethod.last4).toBe("4242");

    for (const [path, method] of [
      [`/orgs/${org.id}/billing/cancel`, "POST"],
      [`/orgs/${org.id}/billing/resume`, "POST"],
      [`/orgs/${org.id}/billing/payment-method`, "DELETE"],
      [`/orgs/${org.id}/billing/payment-method`, "POST"],
    ]) {
      const refused = await call(path, { method, cookie: memberCookie });
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(refused.body.error).toBe("FORBIDDEN");
    }
  });
});
