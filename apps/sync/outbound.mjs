/**
 * One outbound HTTP client for AI providers (ADR-062 boundary, security review).
 *
 * A credential's base URL is user input, so the request cannot simply hand the name to
 * the resolver and hope: DNS can answer with a private address or change between the
 * check and the connection (rebinding). This client resolves all addresses first, refuses
 * any private one, and then pins the connection to the verified address through the TLS
 * socket's `lookup`. Redirects are refused rather than followed, because a public URL can
 * redirect to `169.254.169.254` after the check.
 *
 * It speaks only HTTPS and returns the small slice of the fetch API the AI client uses
 * (`ok`, `status`, `text()`, `json()`).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPrivateHost } from "./secrets.mjs";

const MAX_BODY = 2 * 1024 * 1024;

export class OutboundError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OutboundError";
    this.code = code;
  }
}

/** A verified public address for one host, or an error that names the reason. */
export async function resolvePublicAddress(hostname, { allowPrivate = false } = {}) {
  const host = String(hostname).replace(/^\[|\]$/g, "").replace(/%[^%]*$/, "");
  if (!host || (!allowPrivate && isPrivateHost(host))) {
    throw new OutboundError("PRIVATE_HOST", "the provider host is private or loopback");
  }
  let rows;
  try {
    rows = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new OutboundError("DNS_FAILED", "the provider host does not resolve");
  }
  if (!rows.length) throw new OutboundError("DNS_FAILED", "the provider host does not resolve");
  for (const row of rows) {
    if (!allowPrivate && isPrivateHost(row.address)) {
      throw new OutboundError("PRIVATE_HOST", "the provider host resolves to a private address");
    }
  }
  // IPv4 first keeps the common case (and certificate validation) simple; the address
  // chosen here is the only one the socket is allowed to reach.
  return rows.find((row) => row.family === 4) ?? rows[0];
}

/** Redirects are never followed: the Location header is another, unchecked URL. */
export function assertNotRedirect(status) {
  if (status >= 300 && status < 400) {
    throw new OutboundError("REDIRECT_REFUSED", "the provider redirected; redirects are not allowed");
  }
}

function parseJson(text) {
  return JSON.parse(text);
}

/**
 * A fetch-shaped request to a verified public HTTPS host.
 *
 * `requestImpl` exists for tests; production always uses `https.request`.
 */
export function safeFetchWith(requestImpl, rawUrl, options = {}) {
  const {
    method = "GET",
    headers = {},
    body = undefined,
    timeoutMs = 60_000,
    signal = null,
    allowPrivate = false,
  } = options;

  let target;
  try {
    target = new URL(String(rawUrl));
  } catch {
    return Promise.reject(new OutboundError("BAD_URL", "the provider URL is not valid"));
  }
  if (target.protocol !== "https:") {
    return Promise.reject(new OutboundError("BAD_URL", "the provider URL must use HTTPS"));
  }
  if (target.username || target.password) {
    return Promise.reject(new OutboundError("BAD_URL", "credentials in the URL are not allowed"));
  }

  return resolvePublicAddress(target.hostname, { allowPrivate }).then(
    ({ address, family }) =>
      new Promise((resolve, reject) => {
        const host = target.hostname.replace(/^\[|\]$/g, "");
        const payload = body == null ? null : Buffer.from(String(body), "utf8");
        const framedHeaders = {
          ...headers,
          host: target.host,
          ...(payload ? { "content-length": String(payload.length) } : {}),
        };
        let settled = false;
        let deadline = null;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (deadline) clearTimeout(deadline);
          signal?.removeEventListener?.("abort", onAbort);
          fn(value);
        };
        const onAbort = () => request.destroy(new OutboundError("ABORTED", "the request was aborted"));
        const request = requestImpl(
          {
            protocol: "https:",
            hostname: host,
            port: target.port || 443,
            path: `${target.pathname}${target.search}`,
            method,
            headers: framedHeaders,
            // SNI is the name, never the pinned address; a literal IP has no name.
            ...(isIP(host) ? {} : { servername: host }),
            // The one place the check and the connection meet: the resolver is not
            // consulted again, so a second answer cannot point somewhere private.
            // Node calls `lookup` with `{ all: true }` on some versions; the callback
            // shape differs, so both forms must be answered or the socket fails with
            // ERR_INVALID_IP_ADDRESS before a request exists.
            lookup: (_name, lookupOptions, callback) =>
              lookupOptions?.all
                ? callback(null, [{ address, family }])
                : callback(null, address, family),
            timeout: timeoutMs,
          },
          (response) => {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
              size += chunk.length;
              if (size > MAX_BODY) {
                request.destroy(new OutboundError("RESPONSE_TOO_LARGE", "the provider answer is too large"));
                return;
              }
              chunks.push(chunk);
            });
            response.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              const status = response.statusCode ?? 0;
              try {
                assertNotRedirect(status);
              } catch (error) {
                finish(reject, error);
                return;
              }
              finish(resolve, {
                ok: status >= 200 && status < 300,
                status,
                text: async () => text,
                json: async () => parseJson(text),
              });
            });
            // A peer can close after the headers without ever ending the body. The
            // socket timeout does not fire once the socket is gone, so without these
            // the promise stays pending and the agent/webhook loop never ticks again.
            response.on("aborted", () =>
              finish(reject, new OutboundError("RESPONSE_ABORTED", "the provider aborted the answer")),
            );
            response.on("error", (error) => finish(reject, error));
            response.on("close", () => {
              if (!response.complete) {
                finish(
                  reject,
                  new OutboundError("RESPONSE_ABORTED", "the provider closed before the answer finished"),
                );
              }
            });
          },
        );
        // The hard deadline is independent of the socket: a destroyed socket emits no
        // timeout, but the caller must still get an answer.
        deadline = setTimeout(() => {
          finish(reject, new OutboundError("TIMEOUT", "the provider did not finish in time"));
          request.destroy();
        }, timeoutMs + 1_000);
        request.on("timeout", () =>
          request.destroy(new OutboundError("TIMEOUT", "the provider did not answer in time")),
        );
        request.on("error", (error) => finish(reject, error));
        request.on("close", () => {
          if (!settled) {
            finish(reject, new OutboundError("RESPONSE_ABORTED", "the connection closed before an answer"));
          }
        });
        if (signal) {
          if (signal.aborted) {
            request.destroy(new OutboundError("ABORTED", "the request was aborted"));
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        if (payload) request.write(payload);
        request.end();
      }),
  );
}

/** The production transport. */
export function safeFetch(rawUrl, options = {}) {
  return safeFetchWith(httpsRequest, rawUrl, options);
}
