/**
 * Integration tokens: a person's board access, narrowed by scopes (ADR-096).
 *
 * The secret is `remo_it_…` and is shown once; only its hash is stored. A request that
 * carries one is resolved to the token's owner, and the effective permission is the
 * owner's current access on the board intersected with the token's scopes. A scope can
 * narrow that access, never widen it.
 */
import { hashToken, newToken } from "./iam.mjs";
import { sessionFromRequest } from "./iam-http.mjs";

export const INTEGRATION_TOKEN_PREFIX = "remo_it_";

/** The capability names the product already uses on a board. */
export const INTEGRATION_SCOPES = ["board.read", "board.edit"];

export const INTEGRATION_TOKEN_DAYS = 90;
export const INTEGRATION_TOKEN_MAX_DAYS = 365;

export function newIntegrationToken() {
  return `${INTEGRATION_TOKEN_PREFIX}${newToken(32)}`;
}

export function hashIntegrationToken(secret) {
  return hashToken(secret);
}

/** `scopes` is a subset of the known ones; an empty list is a token that can do nothing. */
export function normalizeScopes(input) {
  if (!Array.isArray(input)) return null;
  const scopes = [...new Set(input.map((scope) => String(scope)))];
  if (scopes.some((scope) => !INTEGRATION_SCOPES.includes(scope))) return null;
  return scopes;
}

export function expiryFromDays(days, now = Date.now()) {
  const value = Number(days ?? INTEGRATION_TOKEN_DAYS);
  if (!Number.isFinite(value) || value < 1 || value > INTEGRATION_TOKEN_MAX_DAYS) return null;
  return new Date(now + Math.round(value) * 24 * 60 * 60 * 1000);
}

export function bearerToken(request) {
  const header = String(request.headers.authorization ?? "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * The token behind a request, or null. A revoked or expired token is null with a reason,
 * so the route can say which one instead of pretending the token is unknown.
 */
export async function integrationFromRequest(request, store, { now = Date.now() } = {}) {
  const secret = bearerToken(request);
  if (!secret || !secret.startsWith(INTEGRATION_TOKEN_PREFIX)) return null;
  if (typeof store.findIntegrationToken !== "function") return null;
  const row = await store.findIntegrationToken(hashIntegrationToken(secret));
  if (!row) return { refused: "INTEGRATION_TOKEN_UNKNOWN" };
  if (row.revoked_at) return { refused: "INTEGRATION_TOKEN_REVOKED" };
  if (new Date(row.expires_at).getTime() <= now) return { refused: "INTEGRATION_TOKEN_EXPIRED" };
  // The token row is RLS-protected; touch it inside its own organisation.
  const touch = () => store.touchIntegrationToken(row.id);
  await (store.withTenant ? store.withTenant(row.org_id, touch) : touch()).catch(() => {});
  return {
    id: row.id,
    orgId: row.org_id,
    ownerId: row.owner_id,
    label: row.label,
    scopes: row.scopes ?? [],
  };
}

/**
 * Who is asking: a signed-in person, or an integration presenting a token. Used by the
 * read API and the command route, the two places a token may act.
 */
export async function callerFromRequest(request, store) {
  const session = await sessionFromRequest(request, store);
  if (session) {
    return { kind: "user", user: session.user, session, scopes: null };
  }
  const token = await integrationFromRequest(request, store);
  if (!token) return null;
  if (token.refused) return { kind: "refused", reason: token.refused };
  return {
    kind: "integration",
    // The token acts as its owner; `user.id` is the owner so board access is unchanged.
    user: { id: token.ownerId, name: token.label },
    token,
    scopes: token.scopes,
  };
}

/**
 * A token belongs to one organisation. Acting as its owner elsewhere would give a member
 * a credential that organisation's admins cannot see or revoke (ADR-161).
 */
export function callerReachesOrg(caller, orgId) {
  return caller?.kind !== "integration" || caller.token.orgId === orgId;
}

/** A scope check for an integration; a person's access is already the full answer. */
export function hasScope(caller, scope) {
  if (!caller) return false;
  if (caller.kind !== "integration") return true;
  return caller.scopes.includes(scope);
}
