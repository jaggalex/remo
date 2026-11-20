import { describe, expect, it, vi } from "vitest";
import { MailError } from "./mail-drivers.mjs";
import { createMailDrain, MAIL_SCHEDULE } from "./mail-drain.mjs";
import { encryptSecret, kekFromEnv } from "./secrets.mjs";

const KEK = Buffer.alloc(32, 11).toString("base64");
const CONFIG = {
  driver: "console",
  from: "remo <no-reply@mail.example.com>",
  replyTo: null,
  productName: "remo",
  batch: 10,
};

function fakeStore(rows) {
  const calls = { sent: [], retry: [], dead: [], purge: [] };
  return {
    calls,
    async claimMailBatch() {
      return rows;
    },
    async markMailSent(id, providerId) {
      calls.sent.push({ id, providerId });
    },
    async markMailRetry(id, value) {
      calls.retry.push({ id, ...value });
    },
    async markMailDead(id, value) {
      calls.dead.push({ id, ...value });
    },
    async purgeMailRows(value) {
      calls.purge.push(value);
      return { mail: 0, tokens: 0 };
    },
  };
}

function fakeDriver(error = null) {
  const sent = [];
  return {
    sent,
    async send(message) {
      if (error) throw error;
      sent.push(message);
      return { providerId: "provider-1" };
    },
  };
}

function fakeMetrics() {
  return { inc: vi.fn(), set: vi.fn() };
}

function row(overrides = {}) {
  return {
    id: "0f3c1a2e-0000-4000-8000-000000000001",
    user_id: "user-1",
    to_email: "person@example.com",
    template: "password_reset",
    locale: "ru",
    params: { name: "Аня", link: "https://app.example.com/?reset=token" },
    sealed_ciphertext: null,
    sealed_nonce: null,
    sealed_dek_wrapped: null,
    sealed_dek_nonce: null,
    sealed_kek_id: null,
    valid_until: null,
    attempts: 0,
    ...overrides,
  };
}

describe("mail drain", () => {
  it("renders, sends and records the provider id", async () => {
    const store = fakeStore([row()]);
    const driver = fakeDriver();
    const metrics = fakeMetrics();
    const drain = createMailDrain({ store, driver, config: CONFIG, metrics, now: () => 0 });

    expect(await drain.drain()).toBe(1);
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0].to).toBe("person@example.com");
    expect(driver.sent[0].text).toContain("https://app.example.com/?reset=token");
    expect(driver.sent[0].subject).toContain("Сброс пароля");
    expect(store.calls.sent).toEqual([{ id: row().id, providerId: "provider-1" }]);
    expect(metrics.inc).toHaveBeenCalledWith("remo_mail_sent_total", { template: "password_reset" });
  });

  it("opens the sealed link parameters before rendering", async () => {
    vi.stubEnv("REMO_KEK", KEK);
    const id = "0f3c1a2e-0000-4000-8000-000000000002";
    const sealed = encryptSecret(
      JSON.stringify({ link: "https://app.example.com/?reset=sealed-secret" }),
      { scope: "user", scopeId: "user-1", provider: "mail", id, kek: kekFromEnv() },
    );
    const store = fakeStore([
      row({
        id,
        params: { name: "Аня" },
        sealed_ciphertext: sealed.ciphertext,
        sealed_nonce: sealed.nonce,
        sealed_dek_wrapped: sealed.dekWrapped,
        sealed_dek_nonce: sealed.dekNonce,
        sealed_kek_id: sealed.kekId,
      }),
    ]);
    const driver = fakeDriver();

    await createMailDrain({ store, driver, config: CONFIG, now: () => 0 }).drain();
    expect(driver.sent[0].text).toContain("sealed-secret");
    vi.unstubAllEnvs();
  });

  it("never sends an expired link", async () => {
    const store = fakeStore([row({ valid_until: new Date(1).toISOString() })]);
    const driver = fakeDriver();
    const metrics = fakeMetrics();

    await createMailDrain({ store, driver, config: CONFIG, metrics, now: () => 10_000 }).drain();
    expect(driver.sent).toHaveLength(0);
    expect(store.calls.dead).toEqual([{ id: row().id, attempts: 0, error: "EXPIRED" }]);
    expect(metrics.inc).toHaveBeenCalledWith("remo_mail_dead_total", {
      template: "password_reset",
      code: "EXPIRED",
    });
  });

  it("retries a retryable failure on the mail ladder", async () => {
    const store = fakeStore([row()]);
    const driver = fakeDriver(new MailError("SMTP_421", { retryable: true }));
    const metrics = fakeMetrics();

    await createMailDrain({ store, driver, config: CONFIG, metrics, now: () => 0 }).drain();
    expect(store.calls.retry).toEqual([
      {
        id: row().id,
        attempts: 1,
        error: "SMTP_421",
        nextAttemptAt: new Date(MAIL_SCHEDULE[0]),
      },
    ]);
    expect(store.calls.dead).toHaveLength(0);
    expect(metrics.inc).toHaveBeenCalledWith("remo_mail_failed_total", {
      template: "password_reset",
      code: "SMTP_421",
    });
  });

  it("buries a permanent failure at once", async () => {
    const store = fakeStore([row()]);
    const driver = fakeDriver(new MailError("SMTP_550", { retryable: false }));

    await createMailDrain({ store, driver, config: CONFIG, now: () => 0 }).drain();
    expect(store.calls.retry).toHaveLength(0);
    expect(store.calls.dead).toEqual([{ id: row().id, attempts: 1, error: "SMTP_550" }]);
  });

  it("buries the sixth attempt", async () => {
    const store = fakeStore([row({ attempts: 5 })]);
    const driver = fakeDriver(new MailError("SMTP_421", { retryable: true }));

    await createMailDrain({ store, driver, config: CONFIG, now: () => 0 }).drain();
    expect(store.calls.retry).toHaveLength(0);
    expect(store.calls.dead).toEqual([{ id: row().id, attempts: 6, error: "SMTP_421" }]);
  });

  it("never writes an address to the log on any path", async () => {
    const logged = [];
    const log = {
      log: (...args) => logged.push(args.join(" ")),
      error: (...args) => logged.push(args.join(" ")),
    };
    const cases = [
      { store: fakeStore([row()]), driver: fakeDriver() },
      {
        store: fakeStore([row()]),
        driver: fakeDriver(new MailError("SMTP_421", { retryable: true })),
      },
      {
        store: fakeStore([row()]),
        driver: fakeDriver(new MailError("SMTP_550", { retryable: false })),
      },
      { store: fakeStore([row({ valid_until: new Date(1).toISOString() })]), driver: fakeDriver() },
    ];
    for (const item of cases) {
      await createMailDrain({ ...item, config: CONFIG, log, now: () => 10_000 }).drain();
    }
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain("person@example.com");
  });

  it("keeps the installation product name over a stored parameter", async () => {
    const store = fakeStore([
      row({ params: { name: "Аня", product: "evil", link: "https://app.example.com/?reset=t" } }),
    ]);
    const driver = fakeDriver();
    await createMailDrain({ store, driver, config: CONFIG, now: () => 0 }).drain();
    expect(driver.sent[0].subject).toContain("remo");
    expect(driver.sent[0].subject).not.toContain("evil");
  });

  it("purges once an hour, not on every pass", async () => {
    const store = fakeStore([row()]);
    let clock = 0;
    const drain = createMailDrain({
      store,
      driver: fakeDriver(),
      config: CONFIG,
      now: () => clock,
    });
    await drain.drain();
    clock = 60_000;
    await drain.drain();
    expect(store.calls.purge).toHaveLength(1);
    clock = 3_600_000;
    await drain.drain();
    expect(store.calls.purge).toHaveLength(2);
  });

  it("sends only the requested letter and releases the rest", async () => {
    const mine = row();
    const other = row({ id: "0f3c1a2e-0000-4000-8000-000000000009", to_email: "other@example.com" });
    const store = fakeStore([other, mine]);
    store.releaseMailClaim = vi.fn(async () => 1);
    const driver = fakeDriver();

    const drained = await createMailDrain({ store, driver, config: CONFIG, now: () => 0 }).drain({
      onlyId: mine.id,
    });
    expect(drained).toBe(1);
    expect(store.releaseMailClaim).toHaveBeenCalledWith([other.id]);
    expect(driver.sent.map((mail) => mail.to)).toEqual(["person@example.com"]);
  });

  it("does nothing without a driver or an outbox", async () => {
    expect(await createMailDrain({ store: fakeStore([]), driver: null, config: CONFIG }).drain()).toBe(
      0,
    );
    expect(
      await createMailDrain({ store: {}, driver: fakeDriver(), config: CONFIG }).drain(),
    ).toBe(0);
  });
});
