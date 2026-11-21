/**
 * The support routes against a real database (ADR-250, `spec/support.md` §2.3–§2.5).
 *
 * The unit tests cover the HMAC and the configuration. This file proves the wiring an
 * operator depends on: one stable identifier per account, a context answer that carries
 * aggregates and no room content, a bearer-only endpoint, and the hourly quota.
 */
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleIam } from "./iam-api.mjs";
import { signSupportIdentity } from "./support.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const SUPPORT = {
  provider: "chatwoot",
  origin: "https://support.example.test",
  hmacSecret: "db-test-secret",
  contextToken: "db-test-context-token",
  hours: { ru: "в рабочее время", en: "during working hours" },
  isProduction: false,
};

const opened = await testDatabaseStore("support routes");
const store = opened?.store ?? null;
const stamp = Date.now();
const servers = [];

async function startServer(support = SUPPORT) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (await handleIam({ request, response, url, store, support })) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

function client(base) {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

const suite = store ? describe : describe.skip;
let base = "";
let account = null;
let identifier = "";

beforeAll(async () => {
  if (!store) return;
  base = await startServer();
  const owner = client(base);
  const email = `support-${stamp}@example.com`;
  const registered = await owner("POST", "/auth/register", {
    email,
    password: "correct horse battery",
    name: "Support Person",
  });
  const orgId = registered.body.org.id;
  const board = await owner("POST", `/orgs/${orgId}/boards`, {
    title: "Secret room title that support must never see",
  });
  account = {
    owner,
    email,
    userId: registered.body.user.id,
    orgId,
    boardId: board.body.board.id,
  };
});

afterAll(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  if (!store) return;
  if (identifier) await store.pool.query("delete from audit_events where subject = $1", [identifier]);
  if (account) {
    await store.pool.query("delete from orgs where id = $1", [account.orgId]).catch(() => {});
    await store.pool.query("delete from users where id = $1", [account.userId]).catch(() => {});
  }
  await store.close();
});

suite("support routes", () => {
  it("has no route and no public config when support is off", async () => {
    const offBase = await startServer({ provider: "none", hours: { ru: "", en: "" } });
    const request = client(offBase);
    expect((await request("GET", "/support/config")).status).toBe(404);
    expect((await request("GET", "/support/anything")).status).toBe(404);
  });

  it("answers the public config without a session and without a secret", async () => {
    const anonymous = client(base);
    const answer = await anonymous("GET", "/support/config");
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      provider: "chatwoot",
      origin: "https://support.example.test",
      hours: SUPPORT.hours,
    });
    expect(JSON.stringify(answer.body)).not.toContain("db-test-secret");
  });

  it("requires a session for the identity", async () => {
    const anonymous = client(base);
    expect((await anonymous("POST", "/support/identity")).status).toBe(401);
  });

  it("creates one stable identifier that is not the account id", async () => {
    const first = await account.owner("POST", "/support/identity");
    expect(first.status).toBe(200);
    identifier = first.body.identifier;
    expect(identifier).toMatch(/^sup_[0-9a-f]{32}$/);
    expect(identifier).not.toBe(account.userId);
    expect(first.body.identifierHash).toBe(signSupportIdentity(identifier, SUPPORT.hmacSecret));
    expect(first.body).toMatchObject({ email: account.email, name: "Support Person" });
    expect(first.body.attributes).toMatchObject({
      remo_user_id: account.userId,
      org_id: account.orgId,
      org_name: expect.any(String),
      lang: expect.any(String),
      app_version: expect.stringContaining("+"),
      region: expect.any(String),
    });

    const second = await account.owner("POST", "/support/identity");
    expect(second.body.identifier).toBe(identifier);
    expect(second.body.identifierHash).toBe(first.body.identifierHash);
  });

  it("refuses the context endpoint without the bearer token", async () => {
    const request = client(base);
    expect((await request("GET", `/support/context?identifier=${identifier}`)).status).toBe(401);
    expect(
      (
        await request("GET", `/support/context?identifier=${identifier}`, null, {
          Authorization: "Bearer wrong-token",
        })
      ).status,
    ).toBe(401);
  });

  it("returns aggregates and no room content for a known identifier", async () => {
    const request = client(base);
    const answer = await request("GET", `/support/context?identifier=${identifier}`, null, {
      Authorization: `Bearer ${SUPPORT.contextToken}`,
    });
    expect(answer.status).toBe(200);
    expect(answer.body.user).toMatchObject({ emailVerified: false, state: "active" });
    expect(answer.body.orgs).toHaveLength(1);
    expect(answer.body.orgs[0]).toMatchObject({
      id: account.orgId,
      seats: { used: 1 },
      rooms: { used: 1 },
    });
    expect(typeof answer.body.orgs[0].plan).toBe("string");
    expect(answer.body.billing).toBeNull();
    expect(answer.body.limits).toEqual({ storageUsedBytes: 0 });

    // The room's title, its widgets and the person's address are none of the agent's
    // business; the contract carries aggregates only.
    const wire = JSON.stringify(answer.body);
    expect(wire).not.toContain("Secret room title");
    expect(wire).not.toContain(account.email);
    expect(answer.body).not.toHaveProperty("rooms.titles");
  });

  it("answers 404 for an unknown or malformed identifier", async () => {
    const request = client(base);
    const auth = { Authorization: `Bearer ${SUPPORT.contextToken}` };
    expect((await request("GET", "/support/context?identifier=sup_ffffffffffffffffffffffffffffffff", null, auth)).status).toBe(404);
    expect((await request("GET", "/support/context?identifier=nope", null, auth)).status).toBe(404);
  });

  it("counts every context read against the hourly quota", async () => {
    const limitedBase = await startServer({
      ...SUPPORT,
      contextToken: "rate-limit-token",
      contextLimit: 2,
    });
    const request = client(limitedBase);
    const auth = { Authorization: "Bearer rate-limit-token" };
    const path = `/support/context?identifier=${identifier}`;
    expect((await request("GET", path, null, auth)).status).toBe(200);
    expect((await request("GET", path, null, auth)).status).toBe(200);
    expect((await request("GET", path, null, auth)).status).toBe(429);
  });

  it("records every context read in the audit trail", async () => {
    const { rows } = await store.pool.query(
      `select action from audit_events where subject = $1 and action = 'support.context_read'`,
      [identifier],
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
