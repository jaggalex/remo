/**
 * Mail delivery drivers (ADR-246, `spec/mail.md` §2.2).
 *
 * The drain knows one thing about a failure: whether the same letter can be tried again.
 * That is the whole contract, so every provider quirk is translated here into a `MailError`
 * carrying `code` and `retryable`, and never into an exception the drain would have to
 * understand.
 *
 * Nothing in this file may put an address, a link, a key or the letter body into an error
 * message or a log line: a failure is identified by the mail id and a short code only.
 */
import { appendFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import { safeFetch } from "@remo/outbound";

export const MAIL_DRIVERS = ["disabled", "console", "smtp", "resend"];

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15_000;

/**
 * A delivery failure the drain can act on. `message` is the code alone, because an
 * exception is the easiest place for a recipient address to reach a log by accident.
 */
export class MailError extends Error {
  constructor(code, { retryable = false, cause } = {}) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "MailError";
    this.code = code;
    this.retryable = retryable;
  }
}

function firstLink(text) {
  const match = /https?:\/\/[^\s<>"']+/i.exec(String(text ?? ""));
  if (!match) return null;
  // Trailing punctuation belongs to the sentence, not to the URL.
  return match[0].replace(/[.,;:!?)\]]+$/, "");
}

function replyToFor(message, config) {
  const value = message.replyTo ?? config.replyTo;
  return typeof value === "string" && value.trim() ? value : null;
}

/** The domain half of `REMO_MAIL_FROM`, used to build a stable `Message-ID`. */
function fromDomain(from) {
  const raw = String(from ?? "");
  // Prefer the angle-addr part so an `@` inside a display name cannot win.
  const angled = /<([^<>]+)>\s*$/.exec(raw);
  const address = (angled ? angled[1] : raw).trim();
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim();
  return domain && !/[\s,<>]/.test(domain) ? domain : null;
}

function smtpPort(smtpUrl) {
  const url = new URL(smtpUrl);
  if (url.port) return Number(url.port);
  return url.protocol === "smtps:" ? 465 : 587;
}

function smtpFailure(error) {
  const responseCode = Number(error?.responseCode);
  if (Number.isInteger(responseCode) && responseCode >= 400 && responseCode < 600) {
    // 4xx is temporary (greylisting, a full mailbox queue), 5xx is a rejection.
    return new MailError(`SMTP_${responseCode}`, {
      retryable: responseCode < 500,
      cause: error,
    });
  }
  return new MailError("SMTP_NETWORK", { retryable: true, cause: error });
}

async function resendProviderId(response) {
  try {
    const body =
      typeof response?.json === "function"
        ? await response.json()
        : JSON.parse(await response.text());
    return typeof body?.id === "string" && body.id ? body.id : null;
  } catch {
    // The letter was accepted; a body we cannot parse must not turn into a retry.
    return null;
  }
}

function resendFailure(error, aborted) {
  // An abort is our own 15-second deadline, even when the transport can only report it as
  // a generic error after `destroy()`.
  const code = aborted || error?.name === "AbortError" ? "RESEND_TIMEOUT" : "RESEND_NETWORK";
  return new MailError(code, { retryable: true, cause: error });
}

function disabledDriver() {
  return {
    name: "disabled",
    async send() {
      throw new MailError("MAIL_DISABLED", { retryable: false });
    },
  };
}

function consoleDriver(config) {
  return {
    name: "console",
    async send(message) {
      // The spec names the template; the link comes from the drain, not from guessing at
      // the first URL in the body (a room title may itself contain one).
      console.log(`[mail] ${message.template ?? "-"} ${message.id} → ${message.link ?? "(no link)"}`);
      if (config.consoleFile) {
        const line = JSON.stringify({
          id: message.id,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        await appendFile(config.consoleFile, `${line}\n`, "utf8");
      }
      return { providerId: null };
    },
  };
}

function smtpDriver(config) {
  const domain = fromDomain(config.from);
  if (!config.smtpUrl || !domain) {
    // No `cause`: a malformed URL can contain the password, and Node prints causes.
    throw new MailError("SMTP_CONFIG", { retryable: false });
  }
  const url = config.smtpUrl;
  let requireTLS;
  let transporter;
  try {
    requireTLS = smtpPort(url) === 587;
    // `createTransport` is called with a config object, not a URL plus defaults: Nodemailer
    // treats the second argument as default *message* fields and would silently drop
    // `requireTLS`. `{ url }` is the documented way to combine a URL with transport options.
    transporter = config.createTransport({ url, requireTLS });
  } catch {
    throw new MailError("SMTP_CONFIG", { retryable: false });
  }
  return {
    name: "smtp",
    async send(message) {
      const messageId = `<${message.id}@${domain}>`;
      const replyTo = replyToFor(message, config);
      let info;
      try {
        info = await transporter.sendMail({
          from: message.from ?? config.from,
          to: message.to,
          ...(replyTo ? { replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
          messageId,
        });
      } catch (error) {
        throw smtpFailure(error);
      }
      const providerId =
        typeof info?.messageId === "string" && info.messageId ? info.messageId : null;
      return { providerId };
    },
  };
}

function resendDriver(config) {
  if (!config.from || !config.resendApiKey) {
    throw new MailError("RESEND_CONFIG", { retryable: false });
  }
  const fetchImpl = config.fetchImpl;
  return {
    name: "resend",
    async send(message) {
      const replyTo = replyToFor(message, config);
      const body = {
        from: message.from ?? config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
      // A pending timer must not keep a short-lived `pnpm mail:test` process alive.
      timer.unref?.();
      let response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `mail/${message.id}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw resendFailure(error, controller.signal.aborted);
      } finally {
        clearTimeout(timer);
      }

      const status = Number(response?.status ?? 0);
      if (status >= 200 && status < 300) {
        return { providerId: await resendProviderId(response) };
      }
      const code = `RESEND_${status}`;
      const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
      if (status === 401 || status === 403) {
        // A bad or restricted key is an installation fault, not one letter's fault.
        // The message names the code only: no key and no recipient.
        console.error(`[mail] resend rejected the api key: ${code}`);
      }
      throw new MailError(code, { retryable });
    },
  };
}

/**
 * @param {{ driver: string, from?: string, replyTo?: string, productName?: string,
 *           consoleFile?: string, resendApiKey?: string, smtpUrl?: string,
 *           isProduction?: boolean }} config
 * @param {{ fetchImpl?: typeof fetch, createTransport?: typeof nodemailer.createTransport }} deps
 *   Injected in tests; production uses the real HTTPS client and Nodemailer.
 */
export function createDriver(config, deps = {}) {
  const { fetchImpl = safeFetch, createTransport = nodemailer.createTransport } = deps;
  const driver = config?.driver;
  const isProduction =
    config?.isProduction === true || process.env.NODE_ENV === "production";

  if (!MAIL_DRIVERS.includes(driver)) {
    throw new MailError("UNKNOWN_DRIVER", { retryable: false });
  }
  if (driver === "disabled") {
    return disabledDriver();
  }
  if (driver === "console") {
    if (isProduction) {
      // Links and bodies in production stdout are a leak, not a convenience.
      throw new MailError("CONSOLE_IN_PRODUCTION", { retryable: false });
    }
    return consoleDriver(config);
  }
  if (driver === "smtp") {
    return smtpDriver({ ...config, createTransport });
  }
  if (driver === "resend") {
    return resendDriver({ ...config, fetchImpl });
  }
  throw new MailError("UNKNOWN_DRIVER", { retryable: false });
}
