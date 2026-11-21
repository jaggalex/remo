/**
 * The support layer's configuration and identity (ADR-250, `spec/support.md` §2).
 *
 * The core ships one thin surface: a mode the client reads, a signed support identity
 * for the operator's widget and a read-only context endpoint for its agent. Nothing here
 * talks to Chatwoot; the origin of the widget page is the only thing the core knows.
 *
 * `REMO_SUPPORT_PROVIDER=none` is the default and the self-host answer: the routes answer
 * `404` and the client never draws an entry.
 */
import { createHmac, randomBytes } from "node:crypto";

export const SUPPORT_PROVIDERS = Object.freeze(["none", "link", "chatwoot"]);

/** The honest default when the operator has not said how long a person takes (§2.1). */
export const DEFAULT_SUPPORT_HOURS = Object.freeze({
  ru: "Человек ответит в течение рабочего дня",
  en: "A person will reply within a working day",
});

/**
 * Why a `link` destination is unusable, or null when it is.
 *
 * A help page is http(s); a self-hoster without a help desk often only has a mailbox, so
 * `mailto:` is accepted too. Anything else — especially `javascript:` and `data:` — is
 * refused here rather than handed to `window.open`.
 */
export function supportUrlProblem(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return "REMO_SUPPORT_URL is not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
    return "REMO_SUPPORT_URL must be http, https or mailto";
  }
  return null;
}

/**
 * The one origin the app may frame, checked at start rather than at the first message.
 *
 * `chatwoot` needs an origin, not a path: the client appends `/widget.html`, and a path
 * here would produce two different pages for the same configuration. Plain http is a
 * development convenience only (§2.1).
 */
export function supportOriginProblem(value, { isProduction = false } = {}) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return "REMO_SUPPORT_ORIGIN is not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "REMO_SUPPORT_ORIGIN must be http or https";
  }
  if (isProduction && url.protocol !== "https:") {
    return "REMO_SUPPORT_ORIGIN must use https in production";
  }
  if (url.username || url.password) {
    return "REMO_SUPPORT_ORIGIN must not carry credentials";
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return "REMO_SUPPORT_ORIGIN must be an origin without a path, query or hash";
  }
  return null;
}

/** `REMO_SUPPORT_HOURS` is `RU|EN`; one language alone would silently drop the other. */
function parseHours(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ...DEFAULT_SUPPORT_HOURS };
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("REMO_SUPPORT_HOURS must be RU|EN, two non-empty texts");
  }
  return { ru: parts[0], en: parts[1] };
}

/**
 * Resolve and validate the support configuration. Throws on a configuration the service
 * must not start with: an unreachable widget page is harder to notice than a crash.
 */
export function resolveSupportConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const raw = String(env.REMO_SUPPORT_PROVIDER ?? "none").trim().toLowerCase();
  const provider = raw || "none";
  if (!SUPPORT_PROVIDERS.includes(provider)) {
    throw new Error(`REMO_SUPPORT_PROVIDER must be one of ${SUPPORT_PROVIDERS.join(", ")}`);
  }

  const hours = parseHours(env.REMO_SUPPORT_HOURS);
  const base = { provider, hours, isProduction };

  if (provider === "none") return base;

  if (provider === "link") {
    const url = String(env.REMO_SUPPORT_URL ?? "").trim();
    const problem = supportUrlProblem(url);
    if (problem) throw new Error(problem);
    return { ...base, url };
  }

  const rawOrigin = String(env.REMO_SUPPORT_ORIGIN ?? "").trim();
  const originProblem = supportOriginProblem(rawOrigin, { isProduction });
  if (originProblem) throw new Error(originProblem);
  const origin = new URL(rawOrigin).origin;

  const hmacSecret = String(env.REMO_SUPPORT_HMAC_SECRET ?? "").trim();
  if (!hmacSecret) {
    throw new Error("REMO_SUPPORT_HMAC_SECRET is required for the chatwoot provider");
  }

  return {
    ...base,
    origin,
    hmacSecret,
    // Optional until the agent exists: without it `/support/context` answers 401.
    contextToken: String(env.REMO_SUPPORT_CONTEXT_TOKEN ?? "").trim() || null,
  };
}

/**
 * The public half of the configuration: `GET /api/support/config` (§2.1).
 *
 * Secrets stay out by construction — the response is built from named fields, never by
 * spreading the resolved config.
 */
export function supportCapabilities(config) {
  if (!config || config.provider === "none") return { provider: "none", hours: { ...DEFAULT_SUPPORT_HOURS } };
  const answer = { provider: config.provider, hours: { ...config.hours } };
  if (config.url) answer.url = config.url;
  if (config.origin) answer.origin = config.origin;
  return answer;
}

/** The text the panel shows, in the reader's language. */
export function supportHours(locale, config = null) {
  const hours = config?.hours ?? DEFAULT_SUPPORT_HOURS;
  return String(locale ?? "").toLowerCase().startsWith("ru") ? hours.ru : hours.en;
}

/**
 * Chatwoot Identity Validation (§2.3): the hex HMAC of the support identifier.
 *
 * The hash has no expiry, which is exactly why the identifier is separate from the user
 * id and rotatable: one leaked hash must not identify the account elsewhere.
 */
export function signSupportIdentity(identifier, secret) {
  return createHmac("sha256", String(secret)).update(String(identifier)).digest("hex");
}

/** `sup_` plus 16 random bytes: stable per person, unrelated to `users.id`. */
export function randomSupportId() {
  return `sup_${randomBytes(16).toString("hex")}`;
}
