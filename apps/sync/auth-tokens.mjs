/**
 * One-off account tokens for password reset and address verification (ADR-246).
 *
 * The token exists in the letter and nowhere else: the database keeps a SHA-256 hash, so
 * a dump cannot be replayed into a reset. Every token is single use, and issuing a new
 * one of the same purpose voids the older ones.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

/** §5.1 and §5.3: a reset link is short-lived, a verification link may live a day. */
export const AUTH_TOKEN_TTL_MS = {
  password_reset: 60 * 60 * 1000,
  email_verify: 24 * 60 * 60 * 1000,
};

export function newAuthToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAuthToken(token) {
  return createHash("sha256").update(String(token)).digest();
}

/**
 * Burn the same amount of work whether or not the address exists.
 *
 * The forgot route must not reveal an account by being measurably faster, so the unknown
 * branch computes hashes too. It is cheap; the point is that the shape of the work matches.
 */
export function dummyAuthTokenWork() {
  hashAuthToken(newAuthToken());
  hashAuthToken(newAuthToken());
}

export async function issueAuthToken(store, { userId, purpose, email, now = Date.now() }) {
  const ttl = AUTH_TOKEN_TTL_MS[purpose];
  if (!ttl) throw new Error(`unknown auth token purpose: ${purpose}`);
  const token = newAuthToken();
  const expiresAt = new Date(now + ttl);
  await store.issueAuthToken({
    id: randomUUID(),
    userId,
    purpose,
    tokenHash: hashAuthToken(token),
    email,
    expiresAt,
  });
  return { token, expiresAt };
}

/** The reset itself runs in one store transaction: password, tokens, sessions. */
export async function resetPasswordWithToken(store, { token, passwordHash }) {
  if (!token) return { status: "invalid" };
  return store.completePasswordReset({ tokenHash: hashAuthToken(token), passwordHash });
}
