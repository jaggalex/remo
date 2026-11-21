/**
 * Inbound payment webhooks (ADR-248, `spec/payment-providers.md` §5).
 *
 * The route is `/billing/webhooks/:connectionId/:token`: no session, no organisation in
 * the URL. The token proves the caller knows this connection, and the adapter proves the
 * delivery is genuine. Only then is the event written to the inbox; the answer says
 * "recorded", not "processed", because the drain owns the consequences.
 *
 * The body is read as raw bytes and never re-serialized before verification: a signature
 * over `JSON.stringify(JSON.parse(body))` is a signature over different bytes.
 *
 * One consequence is applied inline: a succeeded payment that carries a reusable method
 * stores it for autopay (`applyProviderEvent`), because that is what the first payment of
 * a subscription is for. Everything else waits for the drain.
 *
 * Store contract: `connectionById(id)` returns the connection including the sealed
 * envelope and `webhookToken`; `recordProviderEvent({ connectionId, providerEventKey,
 * type, payload })` inserts one row with `on conflict (connection_id, provider_event_key)
 * do nothing` and reports whether it was new. A duplicate delivery must not be an error.
 */
import { timingSafeEqual } from "node:crypto";
import { clientIp } from "./client-ip.mjs";
import { openConnectionSecret } from "./payment-connections.mjs";
import { paymentAdapters } from "./payment-adapters.mjs";
import { kekFromEnv } from "./secrets.mjs";
import { fail } from "./iam-http.mjs";

const MAX_BODY = 64 * 1024;

/**
 * Where each provider's published notification addresses come from. The list changes
 * without a release and an empty list must mean "refuse", so it is operator-provided
 * configuration rather than a constant that silently rots.
 */
const WEBHOOK_IPS_ENV = Object.freeze({ yookassa: "REMO_YOOKASSA_WEBHOOK_IPS" });

class BodyTooLarge extends Error {
  constructor() {
    super("the webhook body is larger than 64 KiB");
    this.name = "BodyTooLarge";
  }
}

/**
 * Raw bytes with a hard ceiling. `readJsonBody` is wrong here twice: it parses before the
 * adapter has checked anything, and it returns `null` for both an oversized and a broken
 * body, which cannot be answered with a distinct status.
 */
async function readRawBody(request, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      // Stop buffering. `resume()` hands the rest to the HTTP layer; a failure there is
      // irrelevant because the 413 closes the exchange anyway.
      try {
        request.resume?.();
      } catch {
        // nothing to recover: the answer is the same 413
      }
      throw new BodyTooLarge();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Constant-time comparison; a length leak is not a token leak. */
function tokenMatches(expected, given) {
  const left = Buffer.from(String(expected ?? ""), "utf8");
  const right = Buffer.from(String(given ?? ""), "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function allowedIpsFor(provider, env) {
  const name = WEBHOOK_IPS_ENV[provider];
  if (!name) return [];
  return String(env?.[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Apply one verified provider event after it reached the inbox.
 *
 * The only consequence implemented here is the saved method of §4: a provider that can
 * store a card returns a reusable reference on the first successful payment, and autopay
 * needs it. The reference is sealed by `savePaymentMethod`; this function never logs it.
 *
 * The consent version comes from the invoice lines, because the callback has no session
 * and no checkout body: the invoice is the durable record of what the payer agreed to.
 * A missing chain or a missing consent is a logged skip, never a failure — the event is
 * already in the inbox and a throw would make the provider repeat a delivery that can
 * never succeed.
 */
export async function applyProviderEvent({ store, connection, event, log = console }) {
  // `savedMethod` belongs to the normalized payment, not to the event envelope.
  const saved = event?.payment?.savedMethod;
  if (event?.type !== "payment.updated") return false;
  if (event?.payment?.status !== "succeeded" || !saved?.methodRef) return false;
  if (
    typeof store.paymentChainFor !== "function" ||
    typeof store.savePaymentMethod !== "function"
  ) {
    return false;
  }

  const paymentId = typeof event.paymentId === "string" ? event.paymentId : "";
  if (!paymentId) {
    log.warn?.(`[billing] webhook ${connection.id}: a saved method without our payment id`);
    return false;
  }
  const chain = await store.paymentChainFor(paymentId);
  if (!chain) {
    log.warn?.(`[billing] webhook ${connection.id}: payment ${paymentId} has no chain`);
    return false;
  }

  const consentVersion = consentVersionOf(chain.lines);
  if (!consentVersion) {
    // No autopay consent means no reusable token, whatever the provider returned.
    log.warn?.(`[billing] webhook ${connection.id}: no autopay consent for payment ${paymentId}`);
    return false;
  }

  try {
    await store.savePaymentMethod({
      orgId: chain.org_id,
      connectionId: connection.id,
      ref: saved.methodRef,
      display: saved.display,
      consentVersion,
      createdBy: null,
    });
  } catch (error) {
    // Names the failure, never the reference: the envelope may be unreadable or the row
    // may have lost its consent column, and either way the inbox row stays for a retry.
    log.error?.(
      `[billing] webhook ${connection.id}: the method was not saved (${error?.code ?? "ERROR"})`,
    );
    return false;
  }
  return true;
}

/** `lines` is JSON; the checkout wrote the consent into the subscription line. */
function consentVersionOf(lines) {
  const list = Array.isArray(lines) ? lines : [];
  for (const line of list) {
    const version = line?.autopayConsent?.version;
    if (typeof version === "string" && version.trim() !== "") return version;
  }
  return null;
}

/**
 * @returns {Promise<boolean>} true when the request belonged to the billing surface.
 */
export async function handlePaymentWebhook({
  request,
  response,
  store,
  connectionId,
  token,
  env = process.env,
  log = console,
  fetchImpl,
}) {
  if (!store || typeof store.connectionById !== "function") {
    fail(response, 501, "BILLING_UNAVAILABLE", "webhooks need the postgres store");
    return true;
  }

  const connection = await store.connectionById(String(connectionId ?? ""));
  // A wrong token and a missing connection get the same answer: the URL must not tell a
  // stranger which connection ids exist.
  if (!connection || connection.status === "draft" || !tokenMatches(connection.webhookToken, token)) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }

  if ((request.method ?? "POST") !== "POST") {
    fail(response, 405, "METHOD_NOT_ALLOWED", "use POST");
    return true;
  }

  const adapter = paymentAdapters(env)[connection.provider];
  if (!adapter) {
    fail(response, 501, "PROVIDER_NOT_READY", "this provider has no adapter yet");
    return true;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(request);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      fail(response, 413, "PAYLOAD_TOO_LARGE", "the notification is larger than 64 KiB");
      return true;
    }
    throw error;
  }

  // Manual connections have no secret: their "webhook" is a 404 from the adapter.
  let usable = connection;
  if (connection.has_secret || connection.ciphertext) {
    let secret;
    try {
      secret = openConnectionSecret(connection, { kek: kekFromEnv(env) });
    } catch (error) {
      log.error(`[billing] webhook ${connection.id}: the connection secret is unreadable (${error?.code})`);
      fail(response, 500, "PROVIDER_UNAVAILABLE", "the connection cannot be used");
      return true;
    }
    usable = { ...connection, secret };
  }

  const remoteIp = clientIp(request);
  let result;
  try {
    result = await adapter.parseWebhook(
      usable,
      { headers: request.headers ?? {}, rawBody, remoteIp },
      { fetchImpl, allowedIps: allowedIpsFor(connection.provider, env) },
    );
  } catch (error) {
    if (error?.retryable) {
      log.error(`[billing] webhook ${connection.id}: ${error.code ?? "provider unavailable"} (retry later)`);
      fail(response, 503, "PROVIDER_UNAVAILABLE", "retry the delivery later");
      return true;
    }
    log.error(`[billing] webhook ${connection.id}: ${error?.code ?? "provider error"}`);
    fail(response, 500, "PROVIDER_ERROR", "the notification could not be checked");
    return true;
  }

  if (!result?.verified) {
    // The body is untrusted: log the connection and the peer, never the payload.
    log.warn(`[billing] webhook ${connection.id} from ${remoteIp || "unknown"}: not verified`);
    fail(response, 401, "WEBHOOK_REJECTED", "the notification could not be verified");
    return true;
  }

  for (const event of result.events ?? []) {
    const recorded = await store.recordProviderEvent({
      connectionId: connection.id,
      providerEventKey: event.key,
      type: event.type,
      payload: event,
    });
    // A duplicate delivery is acknowledged again but must not apply its consequence
    // twice. The drain owns everything beyond the saved method for now.
    if (recorded === true) {
      try {
        await applyProviderEvent({ store, connection, event, log });
      } catch (error) {
        log.error?.(
          `[billing] webhook ${connection.id}: the event was not applied (${error?.code ?? "ERROR"})`,
        );
      }
    }
  }

  const answer = result.respond ?? { status: 200, body: "OK" };
  response.writeHead(answer.status, {
    "Content-Type": answer.contentType ?? "text/plain; charset=utf-8",
  });
  response.end(answer.body ?? "");
  return true;
}
