/**
 * The support configuration and identity (ADR-250, `spec/support.md` §2.1, §2.3).
 *
 * No database here: the point is that a wrong configuration fails at start, that the
 * public answer never carries a secret, and that the HMAC matches Chatwoot's vector.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPPORT_HOURS,
  randomSupportId,
  resolveSupportConfig,
  signSupportIdentity,
  supportCapabilities,
  supportHours,
  supportOriginProblem,
  supportUrlProblem,
} from "./support.mjs";

const CHATWOOT = {
  REMO_SUPPORT_PROVIDER: "chatwoot",
  REMO_SUPPORT_ORIGIN: "https://support.example.com",
  REMO_SUPPORT_HMAC_SECRET: "support-test-secret",
  REMO_SUPPORT_CONTEXT_TOKEN: "context-token",
};

describe("support configuration", () => {
  it("is off by default", () => {
    const config = resolveSupportConfig({});
    expect(config.provider).toBe("none");
    expect(config.hours).toEqual(DEFAULT_SUPPORT_HOURS);
  });

  it("rejects an unknown provider instead of falling back to none", () => {
    expect(() => resolveSupportConfig({ REMO_SUPPORT_PROVIDER: "zendesk" })).toThrow(
      /REMO_SUPPORT_PROVIDER/,
    );
  });

  it("requires a URL for the link mode and accepts a mailbox", () => {
    expect(() => resolveSupportConfig({ REMO_SUPPORT_PROVIDER: "link" })).toThrow(
      /REMO_SUPPORT_URL/,
    );
    expect(
      resolveSupportConfig({
        REMO_SUPPORT_PROVIDER: "link",
        REMO_SUPPORT_URL: "mailto:support@example.com",
      }).url,
    ).toBe("mailto:support@example.com");
    expect(supportUrlProblem("javascript:alert(1)")).toMatch(/http, https or mailto/);
  });

  it("requires a bare https origin and a secret for chatwoot", () => {
    expect(() => resolveSupportConfig({ REMO_SUPPORT_PROVIDER: "chatwoot" })).toThrow(
      /REMO_SUPPORT_ORIGIN/,
    );
    expect(() =>
      resolveSupportConfig({ ...CHATWOOT, REMO_SUPPORT_HMAC_SECRET: "" }),
    ).toThrow(/REMO_SUPPORT_HMAC_SECRET/);
    expect(supportOriginProblem("https://support.example.com/widget")).toMatch(/origin/);
    expect(supportOriginProblem("http://support.example.com", { isProduction: true })).toMatch(
      /https/,
    );
  });

  it("normalizes the origin and keeps the secret out of the public answer", () => {
    const config = resolveSupportConfig({ ...CHATWOOT, REMO_SUPPORT_ORIGIN: "https://support.example.com/" });
    expect(config.origin).toBe("https://support.example.com");
    expect(supportCapabilities(config)).toEqual({
      provider: "chatwoot",
      origin: "https://support.example.com",
      hours: DEFAULT_SUPPORT_HOURS,
    });
    expect(JSON.stringify(supportCapabilities(config))).not.toContain("support-test-secret");
    expect(JSON.stringify(supportCapabilities(config))).not.toContain("context-token");
  });

  it("splits the waiting text into RU and EN", () => {
    const config = resolveSupportConfig({
      REMO_SUPPORT_HOURS: "Пн–Пт, 10:00–19:00|Mon–Fri, 10:00–19:00",
    });
    expect(supportHours("ru", config)).toBe("Пн–Пт, 10:00–19:00");
    expect(supportHours("en-US", config)).toBe("Mon–Fri, 10:00–19:00");
    expect(() => resolveSupportConfig({ REMO_SUPPORT_HOURS: "только по-русски" })).toThrow(
      /RU\|EN/,
    );
  });
});

describe("support identity", () => {
  it("signs the identifier with HMAC-SHA256 in hex", () => {
    // A fixed vector: `openssl dgst -sha256 -hmac support-test-secret`.
    expect(
      signSupportIdentity("sup_0123456789abcdef0123456789abcdef", "support-test-secret"),
    ).toBe("8db0e878dfd81047ea61ec24887715fb379144de7afb9392cef475caa0c86c58");
  });

  it("mints a separate, random identifier", () => {
    const first = randomSupportId();
    const second = randomSupportId();
    expect(first).toMatch(/^sup_[0-9a-f]{32}$/);
    expect(second).toMatch(/^sup_[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});
