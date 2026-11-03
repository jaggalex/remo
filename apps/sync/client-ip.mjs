/**
 * The client address a rate limit and an audit row are keyed on.
 *
 * Behind the shipped proxies the socket peer is the proxy, not the person: nginx on
 * loopback, or the web container on the backend network. Keying a limiter on that
 * address makes one bucket for the whole internet. `X-Forwarded-For` is only read when
 * the operator says the service sits behind a proxy (`REMO_TRUST_PROXY`), because the
 * header is client-controlled on a direct connection.
 */
import { isIP } from "node:net";

function proxyTrusted() {
  return /^(1|true|yes)$/i.test(String(process.env.REMO_TRUST_PROXY ?? ""));
}

/** The first address in `X-Forwarded-For`, or the socket peer. */
export function clientIp(request) {
  const peer = request.socket?.remoteAddress ?? "";
  if (!proxyTrusted()) return peer || "unknown";

  const forwarded = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim();
  if (isIP(forwarded)) return forwarded;

  const real = String(request.headers["x-real-ip"] ?? "").trim();
  if (isIP(real)) return real;

  // A proxy that sends no usable header is still a peer we can count.
  return peer || "unknown";
}
