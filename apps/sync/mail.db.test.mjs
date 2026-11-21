/**
 * The mail outbox against a real database (ADR-246, `spec/mail.md` §3).
 *
 * Proves what the unit tests cannot: the claim function leases rows so two drains never
 * take the same letter, a sent or dead row loses its sealed link in the same statement,
 * and the retention pass removes old rows only. Tokens have no store methods yet, so the
 * `auth_tokens` rows below are written with plain SQL.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("mail outbox");
const store = opened?.store ?? null;
const userId = randomUUID();

const sealed = (tag) => ({
  ciphertext: Buffer.from(`ciphertext-${tag}`),
  nonce: Buffer.from(`nonce-${tag}`),
  dekWrapped: Buffer.from(`dek-${tag}`),
  dekNonce: Buffer.from(`deknonce-${tag}`),
  kekId: "test-kek",
});

function mail(overrides = {}) {
  return {
    id: randomUUID(),
    userId,
    toEmail: `mail-${randomUUID()}@example.test`,
    template: "password_reset",
    locale: "ru",
    params: { name: "Анна" },
    sealed: sealed("reset"),
    validUntil: null,
    ...overrides,
  };
}

/** A letter the retention pass may see: sent, so the claim never takes it. */
async function insertSent(overrides = {}) {
  const message = mail(overrides);
  await store.enqueueMail(message);
  await store.pool.query("update mail_outbox set sent_at = now() where id = $1", [message.id]);
  return message.id;
}

function sealedColumns(row) {
  return [
    row.sealed_ciphertext,
    row.sealed_nonce,
    row.sealed_dek_wrapped,
    row.sealed_dek_nonce,
    row.sealed_kek_id,
  ];
}

async function rowOf(id) {
  const { rows } = await store.pool.query("select * from mail_outbox where id = $1", [id]);
  return rows[0];
}

describe.skipIf(!store)("db:mail (ADR-246)", () => {
  beforeAll(async () => {
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle)
       values ($1, $2, 'x', 'Anna', 'anna-mail')`,
      [userId, `anna-${userId}@example.test`],
    );
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from mail_outbox where user_id = $1", [userId]);
    await store.pool.query("delete from auth_tokens where user_id = $1", [userId]);
    await store.pool.query("delete from users where id = $1", [userId]);
    await store.close();
  });

  it("applies schema 27 and installs the claim function for the app role", async () => {
    // The suite database is migrated by the same path the service uses (ADR-089).
    const { rows } = await store.pool.query("select version from schema_meta where id = 1");
    expect(rows[0].version).toBe(27);

    const { rows: granted } = await store.pool.query(
      `select has_function_privilege('remo_app', 'remo_claim_mail_batch(integer)', 'execute')
         as executable`,
    );
    // The test database carries the role but not the DML grants `db:rls:setup` adds;
    // the claim function is security definer, so its own grant is what the drain needs.
    expect(granted[0].executable).toBe(true);
  });

  it("leases a claimed row so a second drain cannot take it", async () => {
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) await store.enqueueMail(mail({ id }));

    // Another suite could leave a due letter behind: claim in passes, never assuming
    // that one batch is only ours.
    const leased = new Map();
    for (let pass = 0; pass < 5 && !ids.every((id) => leased.has(id)); pass += 1) {
      for (const row of await store.claimMailBatch(100)) leased.set(row.id, row);
    }
    expect(ids.every((id) => leased.has(id))).toBe(true);

    const second = await store.claimMailBatch(100);
    expect(second.map((row) => row.id).filter((id) => ids.includes(id))).toEqual([]);

    // The lease is visible as a due time five minutes ahead, not as a lock.
    const first = leased.get(ids[0]);
    expect(new Date(first.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it("clears the sealed link and records the provider on success", async () => {
    const id = randomUUID();
    await store.enqueueMail(mail({ id, toEmail: "sent@example.test" }));

    await store.markMailSent(id, "provider-1");
    const row = await rowOf(id);
    expect(row.sent_at).toBeInstanceOf(Date);
    expect(row.provider_id).toBe("provider-1");
    expect(row.next_attempt_at).toBeNull();
    expect(row.last_error).toBeNull();
    expect(sealedColumns(row)).toEqual([null, null, null, null, null]);
  });

  it("clears the sealed link, stamps dead_at and truncates a long error", async () => {
    const id = randomUUID();
    await store.enqueueMail(mail({ id, toEmail: "dead@example.test" }));

    await store.markMailDead(id, { attempts: 6, error: "E".repeat(800) });
    const row = await rowOf(id);
    expect(row.dead_at).toBeInstanceOf(Date);
    expect(row.next_attempt_at).toBeNull();
    expect(row.attempts).toBe(6);
    expect(row.last_error).toHaveLength(500);
    expect(sealedColumns(row)).toEqual([null, null, null, null, null]);
  });

  it("keeps a retry due in the future without dropping the sealed link", async () => {
    const id = randomUUID();
    await store.enqueueMail(mail({ id, toEmail: "retry@example.test" }));

    await store.markMailRetry(id, {
      attempts: 2,
      error: "SMTP_421",
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    const row = await rowOf(id);
    expect(row.attempts).toBe(2);
    expect(row.last_error).toBe("SMTP_421");
    expect(row.sent_at).toBeNull();
    expect(row.dead_at).toBeNull();
    expect(row.sealed_ciphertext).not.toBeNull();
  });

  it("lists a dead letter and refuses to resurrect it without its link", async () => {
    const id = randomUUID();
    await store.enqueueMail(mail({ id, toEmail: "listed@example.test" }));
    await store.markMailDead(id, { attempts: 6, error: "SMTP_550" });

    const dead = await store.listDeadMail(50);
    const row = dead.find((candidate) => candidate.id === id);
    expect(row).toMatchObject({ template: "password_reset", attempts: 6, last_error: "SMTP_550" });
    // `pnpm mail:dead --retry` may not bring back a secret that the death cleared.
    expect(await store.retryDeadMail(id)).toBe(false);
  });

  it("counts only letters that still wait to be sent", async () => {
    const before = await store.mailQueueDepth();
    const waiting = randomUUID();
    await store.enqueueMail(mail({ id: waiting, toEmail: "waiting@example.test" }));
    expect(await store.mailQueueDepth()).toBe(before + 1);

    await store.markMailSent(waiting, null);
    expect(await store.mailQueueDepth()).toBe(before);
  });

  it("purges old letters and tokens and keeps fresh ones", async () => {
    const oldMail = await insertSent({ toEmail: "old@example.test" });
    const freshMail = await insertSent({ toEmail: "fresh@example.test" });
    await store.pool.query(
      "update mail_outbox set created_at = now() - interval '40 days' where id = $1",
      [oldMail],
    );

    const oldToken = randomUUID();
    const freshToken = randomUUID();
    for (const [id, age] of [
      [oldToken, "10 days"],
      [freshToken, "1 hour"],
    ]) {
      await store.pool.query(
        `insert into auth_tokens (id, user_id, purpose, token_hash, email, created_at, expires_at)
         values ($1, $2, 'password_reset', $3, 'token@example.test',
                 now() - $4::interval, now() - $4::interval + interval '60 minutes')`,
        [id, userId, Buffer.from(randomUUID()), age],
      );
    }

    const purged = await store.purgeMailRows({
      mailCutoff: new Date(Date.now() - 30 * 24 * 3600_000),
      tokenCutoff: new Date(Date.now() - 7 * 24 * 3600_000),
    });
    expect(purged.mail).toBeGreaterThanOrEqual(1);
    expect(purged.tokens).toBeGreaterThanOrEqual(1);

    expect(await rowOf(oldMail)).toBeUndefined();
    expect(await rowOf(freshMail)).toBeDefined();
    const { rows: tokens } = await store.pool.query(
      "select id from auth_tokens where id = any($1::uuid[]) order by id",
      [[oldToken, freshToken]],
    );
    expect(tokens.map((row) => row.id)).toEqual([freshToken]);
  });
});
