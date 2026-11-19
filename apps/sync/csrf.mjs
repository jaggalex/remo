/**
 * The CSRF boundary for cookie-authenticated mutations and socket upgrades (ADR-062).
 *
 * The session lives in an httpOnly cookie, so a request the browser makes on its own
 * behalf is indistinguishable from one an attacker's page makes with the user's cookie
 * unless the server asks for something the attacker cannot read. Two checks do that:
 *
 * - `Origin` must be one this deployment answers on. A browser always sends it on an
 *   unsafe request and cannot forge it; a non-browser client (CLI, agent, test) sends
 *   none, carries no ambient cookie, and is not a CSRF vector.
 * - A browser request that carries a session or link-unlock cookie must echo the
 *   `remo_csrf` cookie in `X-CSRF-Token`. The cookie is readable by the app's own
 *   JavaScript and not by another origin, so a cross-site page cannot produce the pair.
 *
 * `SameSite=Lax` is the first line, not the whole answer: the guide lives on a sibling
 * subdomain, which is same-site but a different origin.
 */
import { timingSafeEqual } from "node:crypto";
import { cookies } from "./http-boundary.mjs";

export const CSRF_COOKIE = "remo_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIES = ["remo_session", "remo_link_unlock"];
const CSRF_MAX_AGE = 30 * 24 * 60 * 60;

/** A mutation is anything a browser would not replay from a link or a prefetch. */
export function isMutationMethod(method) {
  return !SAFE_METHODS.has(String(method ?? "GET").toUpperCase());
}

/** The origin this request was addressed to, from the proxy-aware scheme and `Host`. */
function requestOrigin(request) {
  const host = request.headers.host;
  if (!host) return null;
  const forwarded = String(request.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const proto =
    forwarded === "https" || forwarded === "http"
      ? forwarded
      : request.socket?.encrypted
        ? "https"
        : "http";
  return `${proto}://${host}`;
}

/** Every origin a mutation may come from: this host, the app origin, the CORS origin. */
export function allowedOrigins(request) {
  const out = new Set();
  const own = requestOrigin(request);
  if (own) out.add(own);
  for (const raw of [process.env.REMO_APP_ORIGIN, process.env.REMO_CORS_ORIGIN]) {
    if (!raw || raw === "*") continue;
    try {
      out.add(new URL(raw).origin);
    } catch {
      /* a malformed setting is ignored, never a reason to allow everything */
    }
  }
  return out;
}

/** True when the request either has no `Origin` or names an origin we serve. */
export function originAllowed(request) {
  const header = request.headers.origin;
  if (!header) return true;
  let origin;
  try {
    origin = new URL(header).origin;
  } catch {
    return false;
  }
  return allowedOrigins(request).has(origin);
}

export function csrfCookie(token, secure) {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=${CSRF_MAX_AGE}${
    secure ? "; Secure" : ""
  }`;
}

export function csrfToken(request) {
  return cookies(request)[CSRF_COOKIE] ?? null;
}

function sameToken(given, expected) {
  if (typeof given !== "string" || !given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Why this mutation must be refused, or null when it may proceed.
 *
 * Returned as a code rather than answered here: the HTTP server and the socket
 * upgrade answer differently, and a second copy of the decision is what ADR-062
 * exists to prevent.
 */
export function csrfProblem(request) {
  if (!isMutationMethod(request.method)) return null;

  const origin = request.headers.origin;
  // No Origin: not a browser, so there is no ambient credential to ride on. A bearer
  // token is sent explicitly and is not attached by the browser to a forged request.
  if (!origin) return null;
  if (!originAllowed(request)) return "ORIGIN_NOT_ALLOWED";

  const carried = cookies(request);
  const cookieAuthenticated = SESSION_COOKIES.some((name) => Boolean(carried[name]));
  if (!cookieAuthenticated) return null;

  const expected = carried[CSRF_COOKIE];
  const given = request.headers[CSRF_HEADER];
  if (!expected || !given) return "CSRF_TOKEN_MISSING";
  return sameToken(given, expected) ? null : "CSRF_TOKEN_INVALID";
}
