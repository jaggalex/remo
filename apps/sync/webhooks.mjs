/**
 * Signed webhook delivery (ADR-095).
 *
 * The protocol is small on purpose: the body is the event envelope, the signature covers
 * the timestamp and the exact bytes, and the event id is the idempotency key. A consumer
 * verifies with `t=` (five-minute window) and `v1=` (HMAC-SHA256 over `"<t>.<body>"`).
 *
 * The secret is sealed with the same envelope as provider keys. One endpoint per
 * organisation, so the organisation id is also the credential id in the AAD.
 */
import { createHmac } from "node:crypto";
import { newToken } from "./iam.mjs";
import { decryptSecret, encryptSecret, fingerprintSecret } from "./secrets.mjs";
import { safeFetch } from "./outbound.mjs";

export const WEBHOOK_SECRET_PREFIX = "whsec_";
/** Eight failures: 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, then the dead letter. */
export const WEBHOOK_MAX_ATTEMPTS = 8;
const BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000];

export function webhookBackoffMs(attempts) {
  const index = Math.min(Math.max(Math.trunc(attempts), 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

export function newWebhookSecret() {
  return `${WEBHOOK_SECRET_PREFIX}${newToken(32)}`;
}

/** `t=<unix>,v1=<hex>` over `"<t>.<body>"`, the format `spec/webhooks.md` documents. */
export function signWebhook(secret, timestamp, body) {
  return createHmac("sha256", String(secret))
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function signatureHeader(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${signWebhook(secret, timestamp, body)}`;
}

export function sealWebhookSecret({ orgId, secret, kek }) {
  const sealed = encryptSecret(secret, {
    scope: "org",
    scopeId: orgId,
    provider: "webhook",
    id: orgId,
    kek,
  });
  return {
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    dekWrapped: sealed.dekWrapped,
    dekNonce: sealed.dekNonce,
    kekId: sealed.kekId,
    fingerprint: fingerprintSecret(secret),
  };
}

export function openWebhookSecret(row, { kek }) {
  return decryptSecret(
    {
      ...row,
      id: row.org_id,
      scope: "org",
      scope_id: row.org_id,
      provider: "webhook",
    },
    { kek },
  );
}

/** What goes over the wire: ids, types and the payload — never board text by default. */
export function webhookEnvelope(row) {
  const occurredAt =
    row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at;
  return {
    id: row.id,
    type: row.type,
    orgId: row.org_id,
    boardId: row.board_id,
    actor: { id: row.actor_id ?? null, type: row.actor_type },
    subject: row.subject ?? null,
    payload: row.payload ?? {},
    occurredAt: occurredAt ?? null,
  };
}

/**
 * One delivery attempt. Throws on a non-2xx answer or a timeout so the drain can record
 * a retry; never returns the secret or the response body to a caller.
 */
export async function deliverWebhook({
  url,
  secret,
  event,
  fetchImpl = safeFetch,
  allowPrivate = false,
  timeoutMs = 5000,
  now = Date.now(),
}) {
  const body = JSON.stringify(webhookEnvelope(event));
  const timestamp = Math.floor(now / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "remo-webhook/1",
        "X-Remo-Event": event.id,
        "X-Remo-Event-Type": event.type,
        "X-Remo-Attempt": String((event.attempts ?? 0) + 1),
        "X-Remo-Signature": signatureHeader(secret, body, timestamp),
      },
      body,
      redirect: "error",
      signal: controller.signal,
      allowPrivate,
    });
    if (!response.ok) throw new Error(`endpoint answered ${response.status}`);
    return { status: response.status };
  } catch (error) {
    throw new Error(error?.name === "AbortError" ? "endpoint timed out" : error.message);
  } finally {
    clearTimeout(timer);
  }
}
