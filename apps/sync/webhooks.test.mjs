import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deliverWebhook,
  newWebhookSecret,
  openWebhookSecret,
  sealWebhookSecret,
  signWebhook,
  signatureHeader,
  webhookBackoffMs,
  webhookEnvelope,
} from "./webhooks.mjs";
import { kekFromEnv } from "./secrets.mjs";

const orgId = "0f0e0d0c-0b0a-4908-8706-050403020100";
const secret = "whsec_test_secret";
const kek = { key: randomBytes(32), id: "test" };

describe("webhook signature", () => {
  it("is HMAC-SHA256 over the timestamp and the exact body", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const timestamp = 1_700_000_000;
    const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(signWebhook(secret, timestamp, body)).toBe(expected);
  });

  it("sends the timestamp it signed, in the documented header format", () => {
    const body = "{}";
    const header = signatureHeader(secret, body, 1_700_000_123);
    expect(header).toMatch(/^t=1700000123,v1=[0-9a-f]{64}$/);
    expect(header.split(",")[1]).toBe(`v1=${signWebhook(secret, 1_700_000_123, body)}`);
  });

  it("generates prefixed secrets of the documented shape", () => {
    const first = newWebhookSecret();
    expect(first).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/);
    expect(newWebhookSecret()).not.toBe(first);
  });
});

describe("webhook secret at rest", () => {
  it("round-trips through the envelope and fails for another organisation", () => {
    const sealed = sealWebhookSecret({ orgId, secret, kek });
    expect(sealed.ciphertext.toString("utf8")).not.toContain(secret);
    expect(openWebhookSecret({ ...sealed, org_id: orgId }, { kek })).toBe(secret);
    expect(() =>
      openWebhookSecret({ ...sealed, org_id: "11111111-1111-4111-8111-111111111111" }, { kek }),
    ).toThrowError(/unwrapped/);
  });

  it("refuses to seal without a key", () => {
    expect(() => sealWebhookSecret({ orgId, secret, kek: null })).toThrowError(/key-encryption/);
    expect(kekFromEnv({})).toBeNull();
  });
});

describe("retry ladder", () => {
  it("grows and stops at three hours", () => {
    const ladder = [1, 2, 3, 4, 5, 6, 7, 8, 12].map(webhookBackoffMs);
    expect(ladder).toEqual([
      10_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 10_800_000, 10_800_000,
    ]);
    expect(webhookBackoffMs(0)).toBe(10_000);
  });
});

describe("webhook envelope", () => {
  it("is ids and types, with the payload as given", () => {
    const envelope = webhookEnvelope({
      id: "evt_1",
      type: "board.item.created",
      org_id: orgId,
      board_id: "board-1",
      actor_id: "user-1",
      actor_type: "user",
      subject: "item_1",
      payload: { objectType: "sticky_note" },
      occurred_at: new Date("2026-10-27T10:00:00.000Z"),
    });
    expect(envelope).toEqual({
      id: "evt_1",
      type: "board.item.created",
      orgId,
      boardId: "board-1",
      actor: { id: "user-1", type: "user" },
      subject: "item_1",
      payload: { objectType: "sticky_note" },
      occurredAt: "2026-10-27T10:00:00.000Z",
    });
  });
});

describe("delivery attempt", () => {
  const event = {
    id: "evt_1",
    type: "board.item.created",
    org_id: orgId,
    board_id: "board-1",
    actor_id: "user-1",
    actor_type: "user",
    subject: "item_1",
    payload: {},
    occurred_at: new Date(),
    attempts: 2,
  };

  it("posts the signed envelope and reports the status", async () => {
    let captured = null;
    const fetchImpl = async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 204 };
    };
    const result = await deliverWebhook({
      url: "https://example.test/hook",
      secret,
      event,
      fetchImpl,
      allowPrivate: true,
      now: 1_700_000_500_000,
    });
    expect(result.status).toBe(204);
    expect(captured.url).toBe("https://example.test/hook");
    expect(captured.options.method).toBe("POST");
    expect(captured.options.redirect).toBe("error");
    expect(captured.options.allowPrivate).toBe(true);
    expect(captured.options.headers["X-Remo-Event"]).toBe("evt_1");
    expect(captured.options.headers["X-Remo-Event-Type"]).toBe("board.item.created");
    expect(captured.options.headers["X-Remo-Attempt"]).toBe("3");
    // The consumer can verify what it received with nothing but the secret and the body.
    const [t, v1] = captured.options.headers["X-Remo-Signature"].split(",");
    expect(t).toBe("t=1700000500");
    expect(v1).toBe(`v1=${signWebhook(secret, 1_700_000_500, captured.options.body)}`);
  });

  it("throws on a non-2xx answer so the drain records a retry", async () => {
    await expect(
      deliverWebhook({
        url: "https://example.test/hook",
        secret,
        event,
        fetchImpl: async () => ({ ok: false, status: 500 }),
      }),
    ).rejects.toThrow("endpoint answered 500");
  });

  it("names a timeout instead of leaking the abort error", async () => {
    const fetchImpl = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    await expect(
      deliverWebhook({ url: "https://example.test/hook", secret, event, fetchImpl }),
    ).rejects.toThrow("endpoint timed out");
  });
});
