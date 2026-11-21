/**
 * Address classification for outbound requests.
 *
 * This lives in its own module rather than beside the credential code: the AI gateway
 * needs the ban without the KEK and the secret-envelope machinery (`spec/ai-gateway.md`
 * §11).
 */

/** Split a dotted quad, or null when the text is not one. */
function ipv4Octets(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return octets;
}

/** Private, loopback, link-local, documentation and reserved IPv4 space. */
function isPrivateV4(host) {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, including cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // multicast, reserved and broadcast
  return false;
}

/** Turn the last 32 bits of an IPv6 address into a dotted quad, when they fit. */
function mappedV4(rest) {
  if (ipv4Octets(rest)) return rest;
  const groups = rest.split(":");
  if (groups.length < 1 || groups.length > 2) return null;
  const words = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  if (words.some((word) => Number.isNaN(word))) return null;
  const high = words.length === 2 ? words[0] : 0;
  const low = words.length === 2 ? words[1] : words[0];
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * A host that must never be reached by an outbound request.
 *
 * IPv6 is not simplified to "contains a colon": IPv4-mapped addresses (`::ffff:127.0.0.1`,
 * `::ffff:7f00:1`) reach loopback through an IPv6 socket, so they are unwrapped and
 * classified as IPv4. Unique-local, link-local, loopback, unspecified, multicast and the
 * documentation prefix are refused too.
 */
export function isPrivateHost(hostname) {
  const host = String(hostname)
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%[^%]*$/, "") // zone id, e.g. fe80::1%eth0
    .replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    const mapped = host.match(/^::ffff:(.+)$/);
    if (mapped) {
      const v4 = mappedV4(mapped[1]);
      if (v4 && isPrivateV4(v4)) return true;
      if (v4) return false;
    }
    const compatible = host.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (compatible) return isPrivateV4(compatible[1]);
    if (/^64:ff9b::/.test(host)) {
      const v4 = mappedV4(host.replace(/^64:ff9b::/, ""));
      return Boolean(v4 && isPrivateV4(v4));
    }
    const first = parseInt(host.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // link local fe80::/10
    if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
    if (host.startsWith("2001:db8:")) return true; // documentation
    return false;
  }
  return isPrivateV4(host);
}
