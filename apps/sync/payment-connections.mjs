/**
 * Opening a payment connection's sealed secret (ADR-248, `spec/payment-providers.md` §1,
 * §3.1).
 *
 * A connection's secret is one JSON document — `{ shopId, secretKey }` for YooKassa —
 * sealed with the KEK and bound to the row by the AAD. The AAD is assembled here and
 * nowhere else, so ciphertext copied to another row cannot be opened by accident.
 *
 * The plaintext exists only in the caller's local variable for the duration of one API
 * call. Nothing in this module logs it, and a failure names the envelope, never the key.
 */
import { SecretError, decryptSecret } from "./secrets.mjs";

/**
 * The row `decryptSecret` reads, built from the connection as stored.
 *
 * Both spellings are accepted because the pg layer maps columns to camelCase on reads
 * while `encryptSecret` returns camelCase itself.
 */
export function sealedConnectionRow(connection) {
  const id = connection?.id;
  return {
    scope: "connection",
    scope_id: id,
    provider: connection?.provider,
    id,
    ciphertext: connection?.ciphertext,
    nonce: connection?.nonce,
    dek_wrapped: connection?.dek_wrapped ?? connection?.dekWrapped,
    dek_nonce: connection?.dek_nonce ?? connection?.dekNonce,
  };
}

/**
 * Decrypt and parse the secret of one connection.
 *
 * A missing envelope and an unreadable one are the same answer to the caller: the
 * connection cannot be used until an operator rotates or re-enters its keys.
 */
export function openConnectionSecret(connection, { kek = null } = {}) {
  const row = sealedConnectionRow(connection);
  if (!row.ciphertext || !row.dek_wrapped) {
    throw new SecretError("NO_SECRET", "the connection has no sealed secret");
  }
  const plaintext = decryptSecret(row, { kek });
  let secret;
  try {
    secret = JSON.parse(plaintext);
  } catch {
    throw new SecretError("BAD_SECRET_JSON", "the connection secret is not a JSON object");
  }
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) {
    throw new SecretError("BAD_SECRET_JSON", "the connection secret is not a JSON object");
  }
  return secret;
}
