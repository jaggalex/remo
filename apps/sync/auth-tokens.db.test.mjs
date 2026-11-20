/**
 * Password-reset tokens against a real database (ADR-246, `spec/mail.md` §3, §5.1–5.2).
 *
 * Proves what a mocked pool cannot: a new token spends only the previous one of the same
 * purpose, a reset changes the password and ends every session in one transaction, an
 * expired row stays unspent so the route can tell "expired" from "invalid", and the
 * address is confirmed only when the token still names the account's own address.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("auth tokens");
const store = opened?.store ?? null;
const createdUserIds = [];

let user = null;
let other = null;

function tokenFor(owner, purpose, overrides = {}) {
  return {
    id: randomUUID(),
    userId: owner.id,
    purpose,
    tokenHash: Buffer.from(randomUUID()),
    email: owner.email,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    ...overrides,
  };
}

async function issue(owner, purpose, overrides = {}) {
  const token = tokenFor(owner, purpose, overrides);
  await store.issueAuthToken(token);
  return token;
}

async function tokenRow(id) {
  const { rows } = await store.pool.query("select * from auth_tokens where id = $1", [id]);
  return rows[0];
}

async function userRow(id) {
  const { rows } = await store.pool.query("select * from users where id = $1", [id]);
  return rows[0];
}

/** A fresh account with an unverified address; handles are unique case-insensitively. */
async function createAccount(label) {
  const account = await store.createUser({
    email: `${label}-${randomUUID()}@example.test`,
    passwordHash: "old-hash",
    name: label,
    handle: `${label}-${randomUUID().slice(0, 8)}`,
  });
  createdUserIds.push(account.id);
  return account;
}

describe.skipIf(!store)("db:auth-tokens (ADR-246)", () => {
  beforeAll(async () => {
    user = await createAccount("anna");
    other = await createAccount("boris");
  });

  afterAll(async () => {
    if (!store) return;
    // Sessions and tokens go with the account; nothing is left for the next suite.
    await store.pool.query("delete from users where id = any($1::uuid[])", [createdUserIds]);
    await store.close();
  });

  it("spends the previous token of the same purpose and leaves the other purpose alive", async () => {
    const first = tokenFor(user, "password_reset");
    expect(await store.issueAuthToken(first)).toEqual({ id: first.id });
    const second = await issue(user, "password_reset");
    expect((await tokenRow(first.id)).used_at).toBeInstanceOf(Date);
    expect((await tokenRow(second.id)).used_at).toBeNull();

    const verify = await issue(user, "email_verify");
    const third = await issue(user, "password_reset");
    expect((await tokenRow(second.id)).used_at).toBeInstanceOf(Date);
    expect((await tokenRow(third.id)).used_at).toBeNull();
    // A reset request must not kill a link that confirms the address.
    expect((await tokenRow(verify.id)).used_at).toBeNull();
  });

  it("changes the password, spends every reset token and ends every session", async () => {
    for (const index of [0, 1]) {
      await store.createSession({
        userId: user.id,
        tokenHash: Buffer.from(`session-${index}-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 3600_000),
        userAgent: "test",
      });
    }
    const older = await issue(user, "password_reset");
    const live = await issue(user, "password_reset");
    expect((await tokenRow(older.id)).used_at).toBeInstanceOf(Date);

    const result = await store.completePasswordReset({
      tokenHash: live.tokenHash,
      passwordHash: "new-hash",
    });
    expect(result).toEqual({ status: "ok", userId: user.id, email: user.email });

    const row = await userRow(user.id);
    expect(row.password_hash).toBe("new-hash");
    expect(row.email_verified_at).toBeInstanceOf(Date);
    expect((await tokenRow(live.id)).used_at).toBeInstanceOf(Date);

    const { rows: active } = await store.pool.query(
      "select id from sessions where user_id = $1 and revoked_at is null",
      [user.id],
    );
    expect(active).toEqual([]);
  });

  it("rejects a token that was already used", async () => {
    const once = await issue(user, "password_reset");
    const first = await store.completePasswordReset({
      tokenHash: once.tokenHash,
      passwordHash: "once",
    });
    expect(first.status).toBe("ok");

    const again = await store.completePasswordReset({
      tokenHash: once.tokenHash,
      passwordHash: "twice",
    });
    expect(again).toEqual({ status: "invalid" });
    // The reuse is a rollback, not a second password change.
    expect((await userRow(user.id)).password_hash).toBe("once");
  });

  it("reports an expired token without spending it or changing the password", async () => {
    const before = (await userRow(user.id)).password_hash;
    const stale = await issue(user, "password_reset", {
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(
      await store.completePasswordReset({ tokenHash: stale.tokenHash, passwordHash: "late" }),
    ).toEqual({ status: "expired" });

    expect((await userRow(user.id)).password_hash).toBe(before);
    // Marking it used would turn "expired" into "invalid" on the next attempt.
    expect((await tokenRow(stale.id)).used_at).toBeNull();
  });

  it("does not confirm the address when the token names a different one", async () => {
    expect((await userRow(other.id)).email_verified_at).toBeNull();
    const foreign = await issue(other, "password_reset", {
      email: "someone-else@example.test",
    });

    expect(
      await store.completePasswordReset({
        tokenHash: foreign.tokenHash,
        passwordHash: "changed-by-token",
      }),
    ).toEqual({ status: "ok", userId: other.id, email: "someone-else@example.test" });

    const row = await userRow(other.id);
    expect(row.password_hash).toBe("changed-by-token");
    expect(row.email_verified_at).toBeNull();
  });

  it("confirms an address only when it is the account's own", async () => {
    expect(await store.setEmailVerified(other.id, "someone-else@example.test")).toBe(false);
    expect((await userRow(other.id)).email_verified_at).toBeNull();

    expect(await store.setEmailVerified(other.id, other.email)).toBe(true);
    expect((await userRow(other.id)).email_verified_at).toBeInstanceOf(Date);

    // The account reads carry the flag, so `/auth/me` can report `emailVerified` (§5.0).
    expect((await store.findUserById(other.id)).email_verified_at).toBeInstanceOf(Date);
    expect((await store.findUserByEmail(other.email)).email_verified_at).toBeInstanceOf(Date);
    const tokenHash = Buffer.from(`session-${randomUUID()}`);
    await store.createSession({
      userId: other.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
      userAgent: "test",
    });
    expect((await store.findSession(tokenHash)).email_verified_at).toBeInstanceOf(Date);
  });

  it("spends a token once and looks it up by hash and purpose", async () => {
    const token = await issue(user, "email_verify");
    expect(await store.findAuthToken(token.tokenHash, "email_verify")).toMatchObject({
      id: token.id,
      user_id: user.id,
      used_at: null,
    });
    // The purpose is part of the key: the same hash is not a reset token.
    expect(await store.findAuthToken(token.tokenHash, "password_reset")).toBeNull();

    expect(await store.consumeAuthToken(token.id)).toBe(true);
    expect(await store.consumeAuthToken(token.id)).toBe(false);
    expect((await tokenRow(token.id)).used_at).toBeInstanceOf(Date);
  });
});
