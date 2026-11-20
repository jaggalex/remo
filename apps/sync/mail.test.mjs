import { describe, expect, it, vi } from "vitest";
import {
  assertMailConfig,
  enqueueMail,
  mailAddress,
  mailCapabilities,
  pickLocale,
  resolveMailConfig,
} from "./mail.mjs";

const KEK = Buffer.alloc(32, 7).toString("base64");

describe("mail configuration", () => {
  it("defaults to console in development when a KEK exists, and disabled in production", () => {
    expect(resolveMailConfig({ REMO_KEK: KEK }).driver).toBe("console");
    expect(resolveMailConfig({}).driver).toBe("disabled");
    expect(resolveMailConfig({ NODE_ENV: "production", REMO_KEK: KEK }).driver).toBe("disabled");
  });

  it("reads every value, including the batch and the invite requirement", () => {
    const config = resolveMailConfig({
      REMO_MAIL_DRIVER: "resend",
      REMO_MAIL_FROM: "remo <no-reply@mail.example.com>",
      REMO_MAIL_REPLY_TO: "help@example.com",
      REMO_MAIL_PRODUCT_NAME: "acme",
      REMO_MAIL_BATCH: "25",
      REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES: "0",
    });
    expect(config).toMatchObject({
      driver: "resend",
      replyTo: "help@example.com",
      productName: "acme",
      batch: 25,
      requireVerifiedForInvites: false,
    });
  });

  it("treats only the literal 0 as off for invites", () => {
    expect(resolveMailConfig({}).requireVerifiedForInvites).toBe(true);
    expect(resolveMailConfig({ REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES: "false" })).toMatchObject({
      requireVerifiedForInvites: true,
    });
  });

  it("parses a display-name address and rejects junk", () => {
    expect(mailAddress("remo <no-reply@mail.example.com>")).toBe("no-reply@mail.example.com");
    expect(mailAddress("no-reply@mail.example.com")).toBe("no-reply@mail.example.com");
    expect(mailAddress("not an address")).toBeNull();
    expect(mailAddress("")).toBeNull();
  });

  it("refuses a driver without what it needs", () => {
    vi.stubEnv("REMO_KEK", KEK);
    const base = { from: "remo <no-reply@mail.example.com>", batch: 10, isProduction: false };
    expect(() => assertMailConfig({ ...base, driver: "smtp", smtpUrl: "" })).toThrow(/REMO_SMTP_URL/);
    expect(() => assertMailConfig({ ...base, driver: "resend", resendApiKey: "" })).toThrow(
      /REMO_RESEND_API_KEY/,
    );
    expect(() =>
      assertMailConfig({
        ...base,
        driver: "smtp",
        smtpUrl: "smtps://user:secret@mail.example.com:465",
        from: "",
      }),
    ).toThrow(/REMO_MAIL_FROM/);
    expect(() => assertMailConfig({ ...base, driver: "console", isProduction: true })).toThrow(
      /production/,
    );
    expect(() => assertMailConfig({ ...base, driver: "console", batch: 0 })).toThrow(/REMO_MAIL_BATCH/);
    vi.unstubAllEnvs();
  });

  it("accepts only implicit TLS on 465 or STARTTLS on 587", () => {
    vi.stubEnv("REMO_KEK", KEK);
    const base = {
      from: "remo <no-reply@mail.example.com>",
      appOrigin: "https://boards.example.com",
      batch: 10,
      isProduction: false,
      driver: "smtp",
    };
    expect(() => assertMailConfig({ ...base, smtpUrl: "smtps://u:p@mail.example.com:465" })).not.toThrow();
    expect(() => assertMailConfig({ ...base, smtpUrl: "smtp://u:p@mail.example.com:587" })).not.toThrow();
    expect(() => assertMailConfig({ ...base, smtpUrl: "smtp://u:p@mail.example.com:25" })).toThrow(
      /port 465/,
    );
    expect(() =>
      assertMailConfig({ ...base, smtpUrl: "smtp://u:p@mail.example.com:587?requireTLS=false" }),
    ).toThrow(/query/);
    expect(() => assertMailConfig({ ...base, smtpUrl: "https://u:p@mail.example.com:587" })).toThrow(
      /smtp:/,
    );
    vi.unstubAllEnvs();
  });

  it("requires a real app origin and https in production", () => {
    vi.stubEnv("REMO_KEK", KEK);
    const base = {
      driver: "console",
      from: "remo <no-reply@mail.example.com>",
      batch: 10,
      replyTo: null,
      productName: "remo",
      consoleFile: null,
      resendApiKey: "",
      smtpUrl: "",
      requireVerifiedForInvites: true,
      isProduction: false,
    };
    expect(() => assertMailConfig({ ...base, appOrigin: "boards.example.com" })).toThrow(/absolute/);
    expect(() => assertMailConfig({ ...base, appOrigin: "https://boards.example.com/" })).toThrow(
      /slash/,
    );
    const live = { ...base, driver: "resend", resendApiKey: "re_test", isProduction: true };
    expect(() =>
      assertMailConfig({ ...live, appOrigin: "http://boards.example.com" }),
    ).toThrow(/https/);
    expect(() =>
      assertMailConfig({ ...live, appOrigin: "https://boards.example.com" }),
    ).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("requires a KEK when mail is on", () => {
    vi.stubEnv("REMO_KEK", "");
    expect(() =>
      assertMailConfig({
        driver: "console",
        from: "remo <no-reply@mail.example.com>",
        appOrigin: "https://boards.example.com",
        batch: 10,
        isProduction: false,
      }),
    ).toThrow(/REMO_KEK/);
    vi.unstubAllEnvs();
  });

  it("forces mail off when the store has no outbox", () => {
    const config = assertMailConfig({ driver: "smtp" }, { hasOutbox: false });
    expect(config.driver).toBe("disabled");
    expect(mailCapabilities(config)).toEqual({
      mail: false,
      passwordReset: false,
      emailVerification: false,
    });
  });
});

describe("enqueueMail", () => {
  const config = { driver: "console", productName: "remo", appOrigin: "https://boards.example.com" };

  it("does nothing when mail is disabled", async () => {
    const store = { enqueueMail: vi.fn() };
    await expect(
      enqueueMail(store, { toEmail: "a@example.com", template: "password_changed", locale: "ru" }, {
        config: { driver: "disabled" },
      }),
    ).resolves.toEqual({ queued: false, id: null });
    expect(store.enqueueMail).not.toHaveBeenCalled();
  });

  it("refuses a secret link in the clear parameters", async () => {
    const store = { enqueueMail: vi.fn() };
    await expect(
      enqueueMail(
        store,
        {
          toEmail: "a@example.com",
          template: "password_reset",
          locale: "ru",
          params: { link: "https://boards.example.com/?reset=secret" },
        },
        { config },
      ),
    ).rejects.toThrow(/linkParams/);
    expect(store.enqueueMail).not.toHaveBeenCalled();
  });

  it("seals the link parameters and passes the generated id", async () => {
    vi.stubEnv("REMO_KEK", KEK);
    const store = { enqueueMail: vi.fn(async (row) => ({ id: row.id })) };
    const result = await enqueueMail(
      store,
      {
        toEmail: "a@example.com",
        template: "password_reset",
        locale: "ru",
        params: { name: "Аня" },
        linkParams: { link: "https://boards.example.com/?reset=secret" },
        validUntil: new Date(9_000),
      },
      { config },
    );
    expect(result.queued).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    const row = store.enqueueMail.mock.calls[0][0];
    expect(row.toEmail).toBe("a@example.com");
    expect(row.params).toEqual({ name: "Аня" });
    expect(row.sealed.ciphertext).toBeInstanceOf(Buffer);
    expect(JSON.stringify(row.params)).not.toContain("secret");
    vi.unstubAllEnvs();
  });
});

describe("mail capabilities and locale", () => {
  it("names the three flags separately", () => {
    expect(mailCapabilities({ driver: "disabled" })).toEqual({
      mail: false,
      passwordReset: false,
      emailVerification: false,
    });
    expect(mailCapabilities({ driver: "smtp" })).toEqual({
      mail: true,
      passwordReset: true,
      emailVerification: true,
    });
  });

  it("prefers the user's language, then Accept-Language, then English", () => {
    expect(pickLocale({ userLang: "ru", acceptLanguage: "en-US" })).toBe("ru");
    expect(pickLocale({ acceptLanguage: "ru-RU,ru;q=0.9" })).toBe("ru");
    expect(pickLocale({ acceptLanguage: "de-DE" })).toBe("en");
    expect(pickLocale({})).toBe("en");
  });
});
