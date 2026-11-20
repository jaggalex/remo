/**
 * Transactional mail: configuration, capabilities, and the one enqueue path (ADR-246).
 *
 * Every message becomes a row in `mail_outbox`; no route calls a driver directly. The
 * configuration is read once at startup and refused when it cannot work, because a mail
 * installation that silently drops password resets is worse than one that refuses to
 * start.
 */
import { randomUUID } from "node:crypto";
import { createDriver, MAIL_DRIVERS } from "./mail-drivers.mjs";
import { encryptSecret, kekFromEnv } from "./secrets.mjs";

export const DEFAULT_APP_ORIGIN = "http://localhost:5173";
const ADDRESS = /^[^@\s<>,;]+@[^@\s<>,;]+$/;

/** The default driver depends on the mode: production must opt in, development must not. */
export function resolveMailConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  // Without a KEK nothing can be sealed, so the development default is still `disabled`:
  // a mail installation that silently drops reset links is worse than an honest "no mail".
  const fallback = isProduction || !env.REMO_KEK ? "disabled" : "console";
  return {
    driver: env.REMO_MAIL_DRIVER ?? fallback,
    from: env.REMO_MAIL_FROM ?? "",
    replyTo: env.REMO_MAIL_REPLY_TO || null,
    productName: env.REMO_MAIL_PRODUCT_NAME || "remo",
    consoleFile: env.REMO_MAIL_CONSOLE_FILE || null,
    resendApiKey: env.REMO_RESEND_API_KEY ?? "",
    smtpUrl: env.REMO_SMTP_URL ?? "",
    appOrigin: env.REMO_APP_ORIGIN || DEFAULT_APP_ORIGIN,
    batch: Number.parseInt(env.REMO_MAIL_BATCH ?? "10", 10),
    requireVerifiedForInvites: env.REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES !== "0",
    isProduction,
  };
}

/** Strip a display name and accept only a bare address; used for `REMO_MAIL_FROM`. */
export function mailAddress(value) {
  const raw = String(value ?? "").trim();
  const angled = /<([^<>]+)>\s*$/.exec(raw);
  const address = (angled ? angled[1] : raw).trim();
  return ADDRESS.test(address) ? address : null;
}

/**
 * Only the two documented shapes are accepted: implicit TLS on 465 or STARTTLS on 587.
 * Anything else either sends credentials in clear text or can override `requireTLS` from
 * a query string, and a mail installation must not be one typo away from that.
 */
export function smtpUrlProblem(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    return "REMO_SMTP_URL is not a valid URL";
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") {
    return "REMO_SMTP_URL must use smtp:// or smtps://";
  }
  if (url.search || url.hash) {
    return "REMO_SMTP_URL must not carry query parameters";
  }
  const port = Number(url.port || (url.protocol === "smtps:" ? 465 : 587));
  if (port !== 465 && port !== 587) {
    return "REMO_SMTP_URL must use port 465 (implicit TLS) or 587 (STARTTLS)";
  }
  return null;
}

/**
 * Refuse to start on a configuration that cannot deliver.
 *
 * A disk store has no outbox, so mail is honestly `disabled` there; the returned config
 * says so instead of failing, because a self-hoster without a database loses nothing.
 */
export function assertMailConfig(config, { hasOutbox = true } = {}) {
  if (!hasOutbox) return { ...config, driver: "disabled" };
  if (!MAIL_DRIVERS.includes(config.driver)) {
    throw new Error(`REMO_MAIL_DRIVER must be one of ${MAIL_DRIVERS.join(", ")}`);
  }
  if (!Number.isInteger(config.batch) || config.batch < 1 || config.batch > 100) {
    throw new Error("REMO_MAIL_BATCH must be between 1 and 100");
  }
  if (config.driver === "disabled") return config;
  if ((config.driver === "smtp" || config.driver === "resend") && !mailAddress(config.from)) {
    throw new Error("REMO_MAIL_FROM must be a valid address");
  }
  if (config.driver === "console" && config.isProduction) {
    throw new Error("the console mail driver is refused in production");
  }
  if (config.driver === "smtp") {
    if (!config.smtpUrl) throw new Error("REMO_SMTP_URL is required for the smtp driver");
    const problem = smtpUrlProblem(config.smtpUrl);
    if (problem) throw new Error(problem);
  }
  if (config.driver === "resend" && !config.resendApiKey) {
    throw new Error("REMO_RESEND_API_KEY is required for the resend driver");
  }
  let origin;
  try {
    origin = new URL(String(config.appOrigin));
  } catch {
    throw new Error("REMO_APP_ORIGIN must be an absolute URL");
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("REMO_APP_ORIGIN must be http or https");
  }
  if (/\/$/.test(String(config.appOrigin))) {
    throw new Error("REMO_APP_ORIGIN must not end with a slash");
  }
  if (config.isProduction && origin.protocol !== "https:") {
    throw new Error("REMO_APP_ORIGIN must use https in production: links go out in mail");
  }
  // Without a KEK the link parameters cannot be sealed, and a readable reset link in the
  // database is exactly what ADR-246 forbids.
  if (!kekFromEnv()) {
    throw new Error("REMO_KEK is required when mail is enabled");
  }
  return config;
}

/** What the client may offer; all three follow the driver today but are named apart. */
export function mailCapabilities(config) {
  const mail = Boolean(config) && config.driver !== "disabled";
  return { mail, passwordReset: mail, emailVerification: mail };
}

/** A secret link belongs in `linkParams`, never in the clear `params` column (ADR-246). */
const SECRET_PARAMS = new Set(["link", "token"]);

/**
 * The only way a message enters the system.
 *
 * `linkParams` holds the secret parts (a reset or invitation link) and is sealed with the
 * KEK; `params` holds what may sit in clear text. The id is generated here so the AAD is
 * known before the row exists.
 */
export async function enqueueMail(store, message, { config, kek = null } = {}) {
  if (!config) throw new Error("enqueueMail needs the resolved mail configuration");
  if (config.driver === "disabled") return { queued: false, id: null };
  for (const key of Object.keys(message.params ?? {})) {
    if (SECRET_PARAMS.has(key)) {
      throw new Error(`mail parameter "${key}" must go through linkParams and be sealed`);
    }
  }
  const id = message.id ?? randomUUID();
  const sealed = message.linkParams
    ? encryptSecret(JSON.stringify(message.linkParams), {
        scope: "user",
        scopeId: message.userId ?? "none",
        provider: "mail",
        id,
        kek: kek ?? kekFromEnv(),
      })
    : null;
  await store.enqueueMail({
    id,
    userId: message.userId ?? null,
    toEmail: message.toEmail,
    template: message.template,
    locale: message.locale,
    params: message.params ?? {},
    sealed,
    validUntil: message.validUntil ?? null,
  });
  return { queued: true, id };
}

/** A configured driver, or `null` when mail is off. The drain never runs for `null`. */
export function mailDriver(config, deps = {}) {
  if (!config || config.driver === "disabled") return null;
  return createDriver(config, deps);
}

/** `users.lang` → `Accept-Language` (`ru*` → ru) → en, as §5.5 requires. */
export function pickLocale({ userLang, acceptLanguage } = {}) {
  const explicit = String(userLang ?? "").toLowerCase();
  if (explicit === "ru" || explicit === "en") return explicit;
  const header = String(acceptLanguage ?? "").toLowerCase();
  if (header.startsWith("ru") || header.includes(",ru")) return "ru";
  return "en";
}
