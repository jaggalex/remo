/**
 * Provider secrets at rest.
 *
 * Envelope encryption: every credential gets its own data key (DEK); the DEK is wrapped
 * by a key-encryption key (KEK) that never lives in the database. A database dump or a
 * backup therefore contains ciphertext and wrapped keys, not usable credentials.
 *
 * The process that calls a provider still has to decrypt a secret while a task runs —
 * that is unavoidable. The surrounding controls are in spec/AI-agents-architecture.md:
 * KMS later, no secret in logs or API responses, allowlisted provider URLs, rotation and
 * fast revocation.
 */
import { lookup } from "node:dns/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

export class SecretError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SecretError";
    this.code = code;
  }
}

/** The KEK from the environment: 32 bytes, base64, plus a version id. */
export function kekFromEnv(env = process.env) {
  const raw = env.REMO_KEK;
  if (!raw) return null;
  let key;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new SecretError("BAD_KEK", "REMO_KEK is not valid base64");
  }
  if (key.length !== 32) {
    throw new SecretError("BAD_KEK", "REMO_KEK must be 32 bytes (base64)");
  }
  return { key, id: String(env.REMO_KEK_ID ?? "v1") };
}

/** Bind ciphertext to its row: moving it to another scope fails to decrypt. */
export function aadFor({ scope, scopeId, provider, id }) {
  return `${scope}:${scopeId}:${provider}:${id}`;
}

function seal(key, aad, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce };
}

function open(key, aad, ciphertext, nonce) {
  if (ciphertext.length < 16) throw new SecretError("BAD_CIPHERTEXT", "secret is truncated");
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Encrypt a provider secret for one credential row.
 *
 * `id` must be known before encryption; the API generates a UUID and passes it here so
 * the AAD can bind the ciphertext to the row.
 */
export function encryptSecret(secret, { scope, scopeId, provider, id, kek }) {
  if (!kek) throw new SecretError("NO_KEK", "the key-encryption key is not configured");
  const value = Buffer.from(String(secret), "utf8");
  if (!value.length) throw new SecretError("EMPTY_SECRET", "the key is empty");
  const aad = aadFor({ scope, scopeId, provider, id });
  const dek = randomBytes(32);
  try {
    const secretPart = seal(dek, aad, value);
    const wrappedPart = seal(kek.key, aad, dek);
    return {
      id,
      ciphertext: secretPart.ciphertext,
      nonce: secretPart.nonce,
      dekWrapped: wrappedPart.ciphertext,
      dekNonce: wrappedPart.nonce,
      kekId: kek.id,
    };
  } finally {
    dek.fill(0);
    value.fill(0);
  }
}

export function decryptSecret(row, { kek }) {
  if (!kek) throw new SecretError("NO_KEK", "the key-encryption key is not configured");
  const aad = aadFor({
    scope: row.scope,
    scopeId: row.scope_id ?? row.scopeId,
    provider: row.provider,
    id: row.id,
  });
  let dek;
  try {
    dek = open(kek.key, aad, row.dek_wrapped ?? row.dekWrapped, row.dek_nonce ?? row.dekNonce);
  } catch {
    throw new SecretError("DECRYPT_FAILED", "the credential could not be unwrapped");
  }
  try {
    const value = open(dek, aad, row.ciphertext, row.nonce);
    return value.toString("utf8");
  } catch {
    throw new SecretError("DECRYPT_FAILED", "the credential could not be decrypted");
  } finally {
    dek.fill(0);
  }
}

/** Stable short fingerprint for audit: never the secret itself. */
export function fingerprintSecret(secret) {
  return createHash("sha256").update(String(secret)).digest("hex").slice(0, 16);
}

export function newCredentialId() {
  return randomUUID();
}

/* ------------------------------------------------------------- base URLs -- */

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

/**
 * Validate a provider endpoint before it is stored.
 *
 * Users may bring their own gateway, which is also a way to send board content to an
 * arbitrary server. HTTPS is required; literal private hosts are refused; the provider
 * allowlist and DNS checks are applied by the API. Redirects are refused at call time.
 */
export function assertSafeBaseUrl(raw, { allowHttp = false, allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new SecretError("BAD_BASE_URL", "the provider URL is not valid");
  }
  if (url.username || url.password) {
    throw new SecretError("BAD_BASE_URL", "credentials in the URL are not allowed");
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new SecretError("BAD_BASE_URL", "the provider URL must use HTTPS");
  }
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw new SecretError("BAD_BASE_URL", "a private or loopback provider URL is not allowed");
  }
  return url.toString().replace(/\/$/, "");
}

/** Resolve a custom gateway and refuse one that points into a private network. */
export async function assertPublicDns(raw) {
  const host = new URL(String(raw)).hostname;
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SecretError("BAD_BASE_URL", "the provider host does not resolve");
  }
  if (!addresses.length) throw new SecretError("BAD_BASE_URL", "the provider host does not resolve");
  for (const address of addresses) {
    if (isPrivateHost(address.address)) {
      throw new SecretError("BAD_BASE_URL", "the provider host resolves to a private address");
    }
  }
  return true;
}

export const PROVIDER_PRESETS = {
  openrouter: "https://openrouter.ai/api/v1",
  cerebras: "https://api.cerebras.ai/v1",
  openai: "https://api.openai.com/v1",
};
