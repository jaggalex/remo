import { describe, expect, it } from "vitest";
import {
  SecretError,
  aadFor,
  assertSafeBaseUrl,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  isPrivateHost,
  kekFromEnv,
} from "./secrets.mjs";

const kek = { key: Buffer.alloc(32, 7), id: "v1" };
const otherKek = { key: Buffer.alloc(32, 8), id: "v2" };
const meta = { scope: "user", scopeId: "u1", provider: "openrouter", id: "c1" };

describe("secret envelope", () => {
  it("round-trips a secret and stores nothing readable", () => {
    const row = encryptSecret("sk-or-secret-value", { ...meta, kek });
    expect(row.ciphertext.toString("utf8")).not.toContain("sk-or");
    expect(row.dekWrapped.toString("utf8")).not.toContain("sk-or");
    const decrypted = decryptSecret(
      { ...row, scope: meta.scope, scope_id: meta.scopeId, provider: meta.provider, id: meta.id },
      { kek },
    );
    expect(decrypted).toBe("sk-or-secret-value");
  });

  it("binds the ciphertext to its row and key", () => {
    const row = encryptSecret("secret", { ...meta, kek });
    expect(() =>
      decryptSecret(
        { ...row, scope: "org", scope_id: "o1", provider: "openrouter", id: "c1" },
        { kek },
      ),
    ).toThrow(SecretError);
    expect(() =>
      decryptSecret(
        { ...row, scope: "user", scope_id: "u1", provider: "openrouter", id: "c2" },
        { kek },
      ),
    ).toThrow(SecretError);
    expect(() =>
      decryptSecret(
        { ...row, scope: "user", scope_id: "u1", provider: "openrouter", id: "c1" },
        { kek: otherKek },
      ),
    ).toThrow(SecretError);
  });

  it("rejects an empty secret and a missing KEK", () => {
    expect(() => encryptSecret("", { ...meta, kek })).toThrow(/empty/);
    expect(() => encryptSecret("x", { ...meta, kek: null })).toThrow(/key-encryption/);
  });

  it("fingerprints deterministically without revealing the value", () => {
    const first = fingerprintSecret("sk-or-secret-value");
    expect(first).toHaveLength(16);
    expect(first).toBe(fingerprintSecret("sk-or-secret-value"));
    expect(first).not.toContain("secret");
    expect(first).not.toBe(fingerprintSecret("other"));
  });

  it("reads a 32-byte base64 KEK", () => {
    expect(kekFromEnv({ REMO_KEK: Buffer.alloc(32, 1).toString("base64") })).toEqual({
      key: Buffer.alloc(32, 1),
      id: "v1",
    });
    expect(kekFromEnv({})).toBeNull();
    expect(() => kekFromEnv({ REMO_KEK: "short" })).toThrow(/32 bytes/);
  });
});

describe("provider URLs", () => {
  it("accepts public HTTPS endpoints", () => {
    expect(assertSafeBaseUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("refuses loopback, private hosts, credentials and plain HTTP", () => {
    for (const url of [
      "http://openrouter.ai/api/v1",
      "https://localhost:8080/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.5/v1",
      "https://192.168.1.2/v1",
      "https://172.20.1.1/v1",
      "https://[::1]/v1",
      "https://[::ffff:127.0.0.1]:9443/v1",
      "https://[::ffff:7f00:1]/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pass@example.com/v1",
    ]) {
      expect(() => assertSafeBaseUrl(url)).toThrow(SecretError);
    }
  });

  it("classifies hosts", () => {
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("fd00::1")).toBe(true);
    expect(isPrivateHost("fe80::1")).toBe(true);
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("::ffff:7f00:1")).toBe(true);
    expect(isPrivateHost("[::ffff:10.0.0.1]")).toBe(true);
    expect(isPrivateHost("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("224.0.0.1")).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(aadFor(meta)).toBe("user:u1:openrouter:c1");
  });
});
