import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDriver, MAIL_DRIVERS, MailError } from "./mail-drivers.mjs";

const FROM = "remo <no-reply@mail.example.com>";
const API_KEY = "re_live_secret_key";

const message = {
  id: "0f3c9a",
  template: "password_reset",
  link: "https://app.example.com/?reset=tok123",
  to: "user@example.com",
  from: FROM,
  subject: "Сброс пароля в remo",
  text: "Задать новый пароль: https://app.example.com/?reset=tok123",
  html: '<p><a href="https://app.example.com/?reset=tok123">Задать пароль</a></p>',
};

function resendDriver(config = {}, deps = {}) {
  return createDriver(
    { driver: "resend", from: FROM, resendApiKey: API_KEY, ...config },
    deps,
  );
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the send to fail");
}

function smtpDriver(sendMail, { url = "smtp://user:pass@mail.example.com:587" } = {}) {
  const transports = [];
  const createTransport = (options) => {
    transports.push(options);
    return { sendMail };
  };
  const driver = createDriver(
    { driver: "smtp", from: FROM, smtpUrl: url },
    { createTransport },
  );
  return { driver, transports };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MailError", () => {
  it("carries a code and defaults to a permanent failure", () => {
    const error = new MailError("UNKNOWN_DRIVER");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MailError");
    expect(error.code).toBe("UNKNOWN_DRIVER");
    expect(error.retryable).toBe(false);
    // The message is the code alone: an address or a key cannot reach a log through it.
    expect(error.message).toBe("UNKNOWN_DRIVER");
  });

  it("keeps the cause out of the message", () => {
    const cause = new Error("connect ECONNREFUSED 10.0.0.1");
    const error = new MailError("SMTP_NETWORK", { retryable: true, cause });
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("SMTP_NETWORK");
    expect(error.retryable).toBe(true);
  });
});

describe("createDriver", () => {
  it("knows the four drivers", () => {
    expect(MAIL_DRIVERS).toEqual(["disabled", "console", "smtp", "resend"]);
  });

  it("refuses an unknown driver", () => {
    const error = (() => {
      try {
        createDriver({ driver: "carrier-pigeon" });
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(MailError);
    expect(error.code).toBe("UNKNOWN_DRIVER");
    expect(error.retryable).toBe(false);
  });
});

describe("disabled driver", () => {
  it("exists but refuses to send", async () => {
    const driver = createDriver({ driver: "disabled" });
    expect(driver.name).toBe("disabled");
    const error = await rejection(driver.send(message));
    expect(error).toBeInstanceOf(MailError);
    expect(error.code).toBe("MAIL_DISABLED");
    expect(error.retryable).toBe(false);
  });
});

describe("console driver", () => {
  it("prints the first link, never the address, and appends one JSON line per letter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "remo-mail-"));
    const consoleFile = join(directory, "outbox.jsonl");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const driver = createDriver({ driver: "console", consoleFile });
      await driver.send(message);
      await driver.send({ ...message, id: "second" });

      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls[0][0]).toBe(
        "[mail] password_reset 0f3c9a → https://app.example.com/?reset=tok123",
      );
      for (const call of log.mock.calls) {
        expect(String(call[0])).not.toContain(message.to);
      }

      const lines = (await readFile(consoleFile, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({
        id: message.id,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      expect(JSON.parse(lines[1]).id).toBe("second");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("says so when the letter has no link", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const driver = createDriver({ driver: "console" });
    await driver.send({ ...message, template: "password_changed", link: null, text: "Пароль изменён." });
    expect(log).toHaveBeenCalledWith("[mail] password_changed 0f3c9a → (no link)");
  });

  it("is refused in production", () => {
    const error = (() => {
      try {
        createDriver({ driver: "console", isProduction: true });
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(MailError);
    expect(error.code).toBe("CONSOLE_IN_PRODUCTION");
    expect(error.retryable).toBe(false);
  });
});

describe("resend driver", () => {
  it("posts one email with an idempotency key and returns the provider id", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: "email_123" }) };
    };
    const driver = resendDriver({ replyTo: "help@example.com" }, { fetchImpl });

    await expect(driver.send(message)).resolves.toEqual({ providerId: "email_123" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].init.headers["Idempotency-Key"]).toBe("mail/0f3c9a");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: "help@example.com",
    });
  });

  it("keeps a delivered letter a success even when the answer has no id", async () => {
    const driver = resendDriver({}, {
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        text: async () => "not json",
      }),
    });
    await expect(driver.send(message)).resolves.toEqual({ providerId: null });
  });

  const statuses = [
    { status: 400, retryable: false },
    { status: 401, retryable: false },
    { status: 403, retryable: false },
    { status: 409, retryable: true },
    { status: 422, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ];

  for (const { status, retryable } of statuses) {
    it(`maps ${status} to a ${retryable ? "retryable" : "permanent"} failure`, async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const driver = resendDriver({}, {
        fetchImpl: async () => ({
          ok: false,
          status,
          text: async () => JSON.stringify({ message: "provider detail" }),
        }),
      });

      const error = await rejection(driver.send(message));
      expect(error).toBeInstanceOf(MailError);
      expect(error.code).toBe(`RESEND_${status}`);
      expect(error.retryable).toBe(retryable);
      expect(error.message).not.toContain(API_KEY);
      expect(error.message).not.toContain(message.to);
      expect(error.message).not.toContain("https://app.example.com");

      if (status === 401 || status === 403) {
        const logged = errorLog.mock.calls.flat().join(" ");
        expect(logged).toContain(`RESEND_${status}`);
        expect(logged).not.toContain(API_KEY);
        expect(logged).not.toContain(message.to);
      }
    });
  }

  it("treats a network failure as retryable", async () => {
    const driver = resendDriver({}, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.1");
      },
    });
    const error = await rejection(driver.send(message));
    expect(error.code).toBe("RESEND_NETWORK");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("10.0.0.1");
  });

  it("times out after 15 seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const aborted = new Error("The operation was aborted");
          aborted.name = "AbortError";
          reject(aborted);
        });
      });
    const driver = resendDriver({}, { fetchImpl });

    const pending = rejection(driver.send(message));
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await pending;

    expect(error.code).toBe("RESEND_TIMEOUT");
    expect(error.retryable).toBe(true);
  });
});

describe("smtp driver", () => {
  it("builds Message-ID from the letter id and the from domain", async () => {
    let sent = null;
    const { driver, transports } = smtpDriver(async (mail) => {
      sent = mail;
      return { messageId: mail.messageId };
    });

    await expect(driver.send({ ...message, replyTo: "help@example.com" })).resolves.toEqual({
      providerId: "<0f3c9a@mail.example.com>",
    });

    expect(transports[0]).toEqual({
      url: "smtp://user:pass@mail.example.com:587",
      requireTLS: true,
    });
    expect(sent.messageId).toBe("<0f3c9a@mail.example.com>");
    expect(sent.to).toBe(message.to);
    expect(sent.from).toBe(FROM);
    expect(sent.replyTo).toBe("help@example.com");
    expect(sent.subject).toBe(message.subject);
  });

  it("does not force STARTTLS on an implicit TLS port", () => {
    const { transports } = smtpDriver(async () => ({}), {
      url: "smtps://user:pass@mail.example.com:465",
    });
    expect(transports[0].requireTLS).toBe(false);
  });

  const smtpCodes = [
    { status: 421, retryable: true },
    { status: 450, retryable: true },
    { status: 535, retryable: false },
    { status: 550, retryable: false },
  ];

  for (const { status, retryable } of smtpCodes) {
    it(`maps SMTP ${status} to a ${retryable ? "retryable" : "permanent"} failure`, async () => {
      const { driver } = smtpDriver(async () => {
        throw Object.assign(new Error(`${status} rejected`), {
          responseCode: status,
          response: `${status} rejected`,
        });
      });

      const error = await rejection(driver.send(message));
      expect(error.code).toBe(`SMTP_${status}`);
      expect(error.retryable).toBe(retryable);
      expect(error.message).not.toContain(message.to);
      expect(error.message).not.toContain("user:pass");
    });
  }

  it("treats a connection failure as retryable", async () => {
    const { driver } = smtpDriver(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1"), {
        code: "ECONNECTION",
      });
    });

    const error = await rejection(driver.send(message));
    expect(error.code).toBe("SMTP_NETWORK");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("10.0.0.1");
  });
});
