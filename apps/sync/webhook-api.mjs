/**
 * The organisation's webhook endpoint (ADR-095).
 *
 * Admin-only, because the endpoint decides where a workspace's events go. The signing
 * secret is generated here and returned exactly once: `GET` shows a fingerprint, never
 * the secret, the same rule provider keys follow.
 */
import { assertPublicDns, assertSafeBaseUrl, kekFromEnv } from "./secrets.mjs";
import { fail, json, readBody } from "./iam-http.mjs";
import { newWebhookSecret, sealWebhookSecret } from "./webhooks.mjs";

function publicView(row) {
  if (!row) return { configured: false };
  return {
    configured: true,
    url: row.url,
    enabled: row.enabled,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rotatedAt: row.rotated_at,
    lastDeliveryAt: row.last_delivery_at,
    lastError: row.last_error,
  };
}

/**
 * A public HTTPS endpoint, checked the same way a provider key's base URL is.
 *
 * A self-hosted installation may legitimately talk to an integration inside its own
 * network, so `REMO_WEBHOOK_ALLOW_PRIVATE=1` lifts the private-host and DNS checks. The
 * default refuses both, and HTTPS is required either way.
 */
async function validatedUrl(raw) {
  const allowPrivate = process.env.REMO_WEBHOOK_ALLOW_PRIVATE === "1";
  const url = assertSafeBaseUrl(raw, { allowPrivate });
  if (!allowPrivate) await assertPublicDns(url);
  return url;
}

export async function handleWebhookRoutes(ctx) {
  const { request, response, url, store, method, parts, audit, requireUser, isOrgAdmin } = ctx;
  if (parts[0] !== "orgs" || parts[2] !== "webhook") return false;

  const me = requireUser();
  if (!me) return true;
  const orgId = parts[1];
  if (!(await isOrgAdmin(orgId, me.id))) {
    return fail(response, 403, "FORBIDDEN", "only an organisation admin can configure the webhook"), true;
  }

  if (parts.length === 3 && method === "GET") {
    json(response, 200, { webhook: publicView(await store.getOrgWebhook(orgId)) });
    return true;
  }

  if (parts.length === 3 && method === "PUT") {
    const body = await readBody(request);
    if (!body?.url) return fail(response, 422, "WEBHOOK_URL_REQUIRED", "a URL is required"), true;
    let endpoint;
    try {
      endpoint = await validatedUrl(String(body.url));
    } catch (error) {
      return fail(response, 422, error.code ?? "BAD_WEBHOOK_URL", error.message), true;
    }
    const kek = kekFromEnv();
    if (!kek) {
      return fail(
        response,
        409,
        "WEBHOOK_LOCKED",
        "set REMO_KEK (32 bytes, base64) before configuring a webhook",
      ), true;
    }
    const secret = newWebhookSecret();
    const row = await store.saveOrgWebhook({
      orgId,
      url: endpoint,
      secret: sealWebhookSecret({ orgId, secret, kek }),
      createdBy: me.id,
    });
    await audit({ actorId: me.id, orgId, action: "webhook.set", subject: endpoint });
    // The only time the secret is visible. Store it now or rotate later.
    json(response, 201, { webhook: publicView(row), secret });
    return true;
  }

  if (parts.length === 3 && method === "DELETE") {
    const removed = await store.deleteOrgWebhook(orgId);
    if (!removed) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no webhook"), true;
    await audit({ actorId: me.id, orgId, action: "webhook.removed" });
    json(response, 200, { ok: true });
    return true;
  }

  if (parts[3] === "rotate" && method === "POST") {
    const current = await store.getOrgWebhook(orgId);
    if (!current) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no webhook"), true;
    const kek = kekFromEnv();
    if (!kek) {
      return fail(response, 409, "WEBHOOK_LOCKED", "the key-encryption key is not configured"), true;
    }
    const secret = newWebhookSecret();
    const row = await store.saveOrgWebhook({
      orgId,
      url: current.url,
      secret: sealWebhookSecret({ orgId, secret, kek }),
      createdBy: me.id,
      rotated: true,
    });
    await audit({ actorId: me.id, orgId, action: "webhook.rotate", subject: current.url });
    json(response, 200, { webhook: publicView(row), secret });
    return true;
  }

  if (parts[3] === "deliveries" && method === "GET") {
    const events = await store.listOrgEvents(orgId, {
      limit: Math.min(Number(url.searchParams.get("limit") ?? 50), 200),
      dead: url.searchParams.get("dead") === "1",
    });
    json(response, 200, { events });
    return true;
  }

  if (parts[3] === "replay" && method === "POST") {
    const body = await readBody(request);
    const eventIds = Array.isArray(body?.eventIds)
      ? body.eventIds.filter((id) => typeof id === "string").slice(0, 200)
      : null;
    const requeued = await store.resetOrgEvents({ orgId, eventIds });
    await audit({
      actorId: me.id,
      orgId,
      action: "webhook.replay",
      after: { count: requeued, explicit: Boolean(eventIds) },
    });
    json(response, 200, { requeued });
    return true;
  }

  return false;
}
