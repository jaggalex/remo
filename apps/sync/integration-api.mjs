/**
 * Integration tokens (ADR-096): create, list, revoke.
 *
 * Admin-only, because a token is a person's authority made portable. The secret is shown
 * exactly once; the list carries labels, scopes and dates, never the secret or its hash.
 */
import { fail, json, readBody } from "./iam-http.mjs";
import {
  INTEGRATION_SCOPES,
  expiryFromDays,
  hashIntegrationToken,
  newIntegrationToken,
  normalizeScopes,
} from "./integrations.mjs";

function publicView(row) {
  return {
    id: row.id,
    label: row.label,
    scopes: row.scopes ?? [],
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at,
  };
}

export async function handleIntegrationRoutes(ctx) {
  const { request, response, store, method, parts, audit, requireUser, isOrgAdmin } = ctx;
  if (parts[0] !== "orgs" || parts[2] !== "integration-tokens") return false;

  const me = requireUser();
  if (!me) return true;
  const orgId = parts[1];
  if (!(await isOrgAdmin(orgId, me.id))) {
    return fail(response, 403, "FORBIDDEN", "only an organisation admin can manage tokens"), true;
  }

  if (parts.length === 3 && method === "GET") {
    json(response, 200, {
      tokens: (await store.listIntegrationTokens(orgId)).map(publicView),
    });
    return true;
  }

  if (parts.length === 3 && method === "POST") {
    const body = await readBody(request);
    const scopes = normalizeScopes(body?.scopes);
    if (!scopes) {
      return fail(
        response,
        422,
        "BAD_SCOPES",
        `scopes must be a list drawn from ${INTEGRATION_SCOPES.join(", ")}`,
      ), true;
    }
    if (!scopes.length) {
      return fail(response, 422, "SCOPES_REQUIRED", "a token with no scopes can do nothing"), true;
    }
    const expiresAt = expiryFromDays(body?.expiresInDays);
    if (!expiresAt) {
      return fail(
        response,
        422,
        "BAD_EXPIRY",
        "expiresInDays must be between 1 and 365; a token without an end date is not allowed",
      ), true;
    }
    const secret = newIntegrationToken();
    const row = await store.createIntegrationToken({
      orgId,
      ownerId: me.id,
      label: String(body?.label ?? "").slice(0, 120),
      scopes,
      expiresAt,
      tokenHash: hashIntegrationToken(secret),
      createdBy: me.id,
    });
    await audit({
      actorId: me.id,
      orgId,
      action: "integration.token.created",
      subject: row.id,
      after: { label: row.label, scopes, expiresAt: row.expires_at },
    });
    // The only time the secret is visible.
    json(response, 201, { token: publicView(row), secret });
    return true;
  }

  if (parts.length === 4 && method === "DELETE") {
    const revoked = await store.revokeIntegrationToken({ orgId, id: parts[3] });
    if (!revoked) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no active token"), true;
    await audit({
      actorId: me.id,
      orgId,
      action: "integration.token.revoked",
      subject: parts[3],
    });
    json(response, 200, { ok: true });
    return true;
  }

  return false;
}
