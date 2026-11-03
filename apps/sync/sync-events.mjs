/**
 * The event drain, and its first real consumer: the organisation's webhook (ADR-094,
 * ADR-095).
 *
 * Domain events are produced inside the command transaction and wait in `event_outbox`.
 * The drain takes what is due, hands each row to the consumer, and records the outcome in
 * the same transaction — delivered, retry later, or dead. A consumer outage costs a
 * bounded number of retries and leaves evidence, it does not lose events.
 */
import { kekFromEnv } from "./secrets.mjs";
import {
  WEBHOOK_MAX_ATTEMPTS,
  deliverWebhook,
  openWebhookSecret,
  webhookBackoffMs,
} from "./webhooks.mjs";
import { safeFetch } from "./outbound.mjs";

/**
 * The webhook consumer: one endpoint per organisation, so a row with no endpoint (or a
 * disabled one) is "nobody asked" and is simply marked published.
 */
export function createWebhookConsumer({
  store,
  kek = null,
  fetchImpl = safeFetch,
  allowPrivate = false,
  log = console,
}) {
  return async function deliver(row) {
    if (!row.org_id) return;
    const hook = await store.getOrgWebhook(row.org_id);
    if (!hook || !hook.enabled) return;

    try {
      const secret = openWebhookSecret(hook, { kek: kek ?? kekFromEnv() });
      await deliverWebhook({ url: hook.url, secret, event: row, fetchImpl, allowPrivate });
      await store.touchWebhook(row.org_id, { ok: true }).catch(() => {});
    } catch (error) {
      // A status column is not worth failing the delivery record over: the outbox row
      // carries the retry, this is the operator's dashboard.
      await store.touchWebhook(row.org_id, { ok: false, error: error.message }).catch(() => {});
      log.error?.(`[webhooks] delivery to ${row.org_id} failed:`, error.message);
      throw error;
    }
  };
}

export function createEventDrain({
  store,
  log = console,
  intervalMs = 1000,
  batch = 20,
  handle = async () => {},
}) {
  let timer = null;
  let draining = false;

  async function drain() {
    if (draining || typeof store.drainEvents !== "function") return 0;
    draining = true;
    try {
      const { delivered } = await store.drainEvents({
        limit: batch,
        handle,
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        delayMs: webhookBackoffMs,
      });
      if (delivered) log.log(`[events] delivered ${delivered} event(s)`);
      return delivered;
    } catch (error) {
      log.error("[events] drain failed:", error.message);
      return 0;
    } finally {
      draining = false;
    }
  }

  /** Called once on listen; a disk store has no outbox, so there is nothing to drain. */
  function start() {
    if (typeof store.drainEvents !== "function") return;
    timer = setInterval(() => void drain(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { drain, start, stop };
}
