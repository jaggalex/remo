/**
 * Password recovery over HTTP (ADR-246, `spec/mail.md` §5.0–5.2).
 *
 * The token is read back by decrypting the sealed row, so the test proves the real path:
 * seal at enqueue, open at reset, one transaction that rotates the password, burns the
 * token and revokes every session.
 */
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetFailures } from "./attempts.mjs";
import { handleIam } from "./iam-api.mjs";
import { mailCapabilities } from "./mail.mjs";
import { sealedMailRow } from "./pg/mail.mjs";
import { decryptSecret, kekFromEnv } from "./secrets.mjs";
import { testDatabaseStore } from "./test-db.mjs";

process.env.REMO_KEK = Buffer.alloc(32, 5).toString("base64");

const database = await testDatabaseStore("mail recovery");
const store = database?.store ?? null;
const reachable = store !== null;
let server = null;
let base = "";
const suite = reachable ? describe : describe.skip;
const stamp = Date.now();

const MAIL_CONFIG = {
  driver: "console",
  from: "remo <no-reply@mail.example.com>",
  replyTo: null,
  productName: "remo",
  consoleFile: null,
  resendApiKey: "",
  smtpUrl: "",
  appOrigin: "https://boards.example.test",
  batch: 10,
  requireVerifiedForInvites: true,
  isProduction: false,
};
const MAIL = mailCapabilities(MAIL_CONFIG);

beforeAll(async () => {
  if (!reachable) return;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const handled = await handleIam({
      request,
      response,
      url,
      store,
      mail: MAIL,
      mailConfig: MAIL_CONFIG,
    });
    if (handled) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled in this test" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) await store.close();
});

beforeEach(() => {
  resetFailures();
});

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

const email = (tag) => `recovery-${tag}-${stamp}@example.com`;
const PASSWORD = "correct horse battery";

async function registered(tag) {
  const api = client();
  const address = email(tag);
  const created = await api("POST", "/auth/register", {
    email: address,
    name: `Recovery ${tag}`,
    password: PASSWORD,
  });
  expect(created.status).toBe(201);
  return { api, email: address, user: created.body.user };
}

async function passwordResetRow(userId) {
  const { rows } = await store.pool.query(
    `select * from mail_outbox
      where user_id = $1 and template = 'password_reset'
      order by created_at desc limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

function tokenOf(row) {
  const secret = JSON.parse(decryptSecret(sealedMailRow(row), { kek: kekFromEnv() }));
  return new URL(secret.link).searchParams.get("reset");
}

suite("password recovery (ADR-246)", () => {
  it("reports what the installation can do", async () => {
    const api = client();
    const enabled = await api("GET", "/auth/capabilities");
    expect(enabled.body).toEqual({ mail: true, passwordReset: true, emailVerification: true });
  });

  it("answers the same for a known and an unknown address", async () => {
    const { user } = await registered("same-answer");
    const api = client();
    const known = await api("POST", "/auth/password/forgot", { email: email("same-answer") });
    const unknown = await api("POST", "/auth/password/forgot", { email: email("nobody") });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    expect(await passwordResetRow(user.id)).not.toBeNull();
    const { rows } = await store.pool.query(
      "select count(*)::int as n from mail_outbox where to_email = $1",
      [email("nobody")],
    );
    expect(rows[0].n).toBe(0);
  });

  it("answers a known and an unknown address in comparable time", async () => {
    const { user } = await registered("timing");
    const api = client();
    const known = [];
    const unknown = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      resetFailures();
      let started = performance.now();
      await api("POST", "/auth/password/forgot", { email: user.email });
      known.push(performance.now() - started);
      resetFailures();
      started = performance.now();
      await api("POST", "/auth/password/forgot", {
        email: `nobody-${attempt}-${stamp}@example.com`,
      });
      unknown.push(performance.now() - started);
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    expect(Math.abs(median(known) - median(unknown))).toBeLessThan(20);
  });

  it("sends a notice when the password changes through the signed-in route", async () => {
    const { api, user } = await registered("change");
    const changed = await api("POST", "/auth/password", {
      currentPassword: PASSWORD,
      newPassword: "a different good passphrase",
    });
    expect(changed.status).toBe(200);
    const { rows } = await store.pool.query(
      `select count(*)::int as n from mail_outbox
        where user_id = $1 and template = 'password_changed'`,
      [user.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("resets the password, revokes sessions and verifies the address", async () => {
    const { api, user } = await registered("reset");
    const other = client();
    await other("POST", "/auth/login", { email: user.email, password: PASSWORD });
    const before = await other("GET", "/auth/me");
    expect(before.status).toBe(200);

    const forgot = await api("POST", "/auth/password/forgot", { email: user.email });
    expect(forgot.status).toBe(202);
    const row = await passwordResetRow(user.id);
    const token = tokenOf(row);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const fresh = client();
    const reset = await fresh("POST", "/auth/password/reset", {
      token,
      newPassword: "a brand new passphrase",
    });
    expect(reset.status).toBe(200);

    // The old session is gone, and the reset did not sign anybody in.
    expect((await api("GET", "/auth/me")).status).toBe(401);
    expect((await other("GET", "/auth/me")).status).toBe(401);

    const login = await fresh("POST", "/auth/login", {
      email: user.email,
      password: "a brand new passphrase",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);

    const changed = await store.pool.query(
      `select count(*)::int as n from mail_outbox
        where user_id = $1 and template = 'password_changed'`,
      [user.id],
    );
    expect(changed.rows[0].n).toBe(1);

    const audit = await store.pool.query(
      "select action from audit_events where actor_id = $1 and action like 'auth.password_reset%'",
      [user.id],
    );
    expect(audit.rows.map((event) => event.action)).toContain("auth.password_reset");
  });

  it("rejects a used, unknown and expired token", async () => {
    const { api, user } = await registered("bad-token");
    await api("POST", "/auth/password/forgot", { email: user.email });
    const token = tokenOf(await passwordResetRow(user.id));

    const first = await client()("POST", "/auth/password/reset", {
      token,
      newPassword: "another good passphrase",
    });
    expect(first.status).toBe(200);

    const replay = await client()("POST", "/auth/password/reset", {
      token,
      newPassword: "yet another passphrase",
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("TOKEN_INVALID");

    const junk = await client()("POST", "/auth/password/reset", {
      token: "not-a-token",
      newPassword: "yet another passphrase",
    });
    expect(junk.body.error).toBe("TOKEN_INVALID");

    await store.pool.query(
      `update auth_tokens set expires_at = now() - interval '1 minute'
        where user_id = $1 and purpose = 'password_reset' and used_at is null`,
      [user.id],
    );
    await api("POST", "/auth/password/forgot", { email: user.email });
    const expiredRow = await store.pool.query(
      `select * from mail_outbox where user_id = $1 and template = 'password_reset'
        order by created_at desc limit 1`,
      [user.id],
    );
    const expired = tokenOf(expiredRow.rows[0]);
    await store.pool.query(
      `update auth_tokens set expires_at = now() - interval '1 minute' where user_id = $1
        and purpose = 'password_reset' and used_at is null`,
      [user.id],
    );
    const late = await client()("POST", "/auth/password/reset", {
      token: expired,
      newPassword: "the last good passphrase",
    });
    expect(late.status).toBe(400);
    expect(late.body.error).toBe("TOKEN_EXPIRED");
  });

  it("stops issuing links past the per-address limit without saying so", async () => {
    const { user } = await registered("limit");
    const api = client();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const answer = await api("POST", "/auth/password/forgot", { email: user.email });
      expect(answer.status).toBe(202);
    }
    const { rows } = await store.pool.query(
      `select count(*)::int as n from mail_outbox
        where user_id = $1 and template = 'password_reset'`,
      [user.id],
    );
    expect(rows[0].n).toBe(3);
  });
});
