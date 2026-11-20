/**
 * The mail drain (ADR-246).
 *
 * The same shape as the event drain: claim a batch with a five-minute lease, hand each
 * row to the driver, record the outcome in the same row. Mail differs from webhooks in
 * one place only — a person is waiting, so the ladder is shorter and an expired link is
 * never sent at all.
 */
import { backoffMs } from "./backoff.mjs";
import { render } from "./mail-templates.mjs";
import { sealedMailRow } from "./pg/mail.mjs";
import { decryptSecret, kekFromEnv } from "./secrets.mjs";

/** Six attempts: 5 s, 15 s, 1 min, 5 min, 15 min, 30 min, then the dead letter. The last
 * step is only reached by an installation that raises `MAIL_MAX_ATTEMPTS`. */
export const MAIL_SCHEDULE = [5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000];
export const MAIL_MAX_ATTEMPTS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAIL_RETENTION_MS = 30 * DAY_MS;
const TOKEN_RETENTION_MS = 7 * DAY_MS;
const PURGE_EVERY_MS = 60 * 60 * 1000;

function short(id) {
  return String(id ?? "").slice(0, 8);
}

export function createMailDrain({
  store,
  driver,
  config,
  log = console,
  metrics = null,
  kek = null,
  now = () => Date.now(),
  intervalMs = 2000,
}) {
  let timer = null;
  let running = false;
  // -Infinity so the first pass cleans up immediately; hourly afterwards.
  let lastPurge = Number.NEGATIVE_INFINITY;

  async function purgeIfDue() {
    if (typeof store.purgeMailRows !== "function") return;
    if (now() - lastPurge < PURGE_EVERY_MS) return;
    lastPurge = now();
    try {
      await store.purgeMailRows({
        mailCutoff: new Date(now() - MAIL_RETENTION_MS),
        tokenCutoff: new Date(now() - TOKEN_RETENTION_MS),
      });
    } catch (error) {
      log.error("[mail] purge failed:", error.message);
    }
  }

  async function deliver(row) {
    if (row.valid_until && new Date(row.valid_until).getTime() <= now()) {
      // The link in this mail is already useless; sending it would only confuse.
      await store.markMailDead(row.id, { attempts: row.attempts ?? 0, error: "EXPIRED" });
      metrics?.inc("remo_mail_dead_total", { template: row.template, code: "EXPIRED" });
      log.log(`[mail] dead ${row.template} ${short(row.id)} EXPIRED`);
      return;
    }

    try {
      const params = { ...(row.params ?? {}), product: config?.productName ?? "remo" };
      if (row.sealed_ciphertext) {
        const secret = JSON.parse(decryptSecret(sealedMailRow(row), { kek: kek ?? kekFromEnv() }));
        Object.assign(params, secret);
      }
      const { subject, text, html } = render(row.template, row.locale, params);
      const { providerId } = await driver.send({
        id: row.id,
        template: row.template,
        link: typeof params.link === "string" ? params.link : null,
        to: row.to_email,
        from: config.from,
        replyTo: config.replyTo ?? undefined,
        subject,
        text,
        html,
      });
      await store.markMailSent(row.id, providerId ?? null);
      metrics?.inc("remo_mail_sent_total", { template: row.template });
      log.log(`[mail] sent ${row.template} ${short(row.id)}`);
    } catch (error) {
      const code = error?.code ?? error?.name ?? "MAIL_ERROR";
      const attempts = (row.attempts ?? 0) + 1;
      metrics?.inc("remo_mail_failed_total", { template: row.template, code });
      if (error?.retryable !== true || attempts >= MAIL_MAX_ATTEMPTS) {
        await store.markMailDead(row.id, { attempts, error: code });
        metrics?.inc("remo_mail_dead_total", { template: row.template, code });
        log.error(`[mail] dead ${row.template} ${short(row.id)} ${code}`);
        return;
      }
      const delay = backoffMs(attempts, MAIL_SCHEDULE);
      await store.markMailRetry(row.id, {
        attempts,
        error: code,
        nextAttemptAt: new Date(now() + delay),
      });
      log.log(`[mail] retry ${attempts}/${MAIL_MAX_ATTEMPTS} ${row.template} ${short(row.id)} ${code}`);
    }
  }

  async function drain({ onlyId = null } = {}) {
    if (running || !driver || typeof store.claimMailBatch !== "function") return 0;
    running = true;
    try {
      let rows = await store.claimMailBatch(config?.batch ?? 10);
      if (onlyId) {
        // `pnpm mail:test` must not send somebody else's queued letter; rows it claimed by
        // accident go back to the queue at once.
        const others = rows.filter((row) => row.id !== onlyId).map((row) => row.id);
        rows = rows.filter((row) => row.id === onlyId);
        if (others.length && typeof store.releaseMailClaim === "function") {
          await store.releaseMailClaim(others);
        }
      }
      for (const row of rows) await deliver(row);
      await purgeIfDue();
      return rows.length;
    } catch (error) {
      log.error("[mail] drain failed:", error.message);
      return 0;
    } finally {
      running = false;
    }
  }

  /** Called once on listen; a disk store or a disabled driver has nothing to drain. */
  function start() {
    if (!driver) return;
    timer = setInterval(() => void drain(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { drain, start, stop };
}
