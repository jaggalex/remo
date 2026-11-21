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
import { isPrivateHost } from "@remo/outbound";

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

// The ban lives in `@remo/outbound` so the AI gateway can apply it without loading the
// KEK machinery. It is re-exported here because the credential API and its tests read it
// from this module.
export { isPrivateHost };

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
