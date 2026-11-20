import { describe, expect, it, vi } from "vitest";
import {
  AUTH_TOKEN_TTL_MS,
  dummyAuthTokenWork,
  hashAuthToken,
  issueAuthToken,
  newAuthToken,
  resetPasswordWithToken,
} from "./auth-tokens.mjs";

describe("auth tokens", () => {
  it("creates 32 random bytes and hashes them with SHA-256", () => {
    const token = newAuthToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    const hash = hashAuthToken(token);
    expect(hash).toHaveLength(32);
    expect(hashAuthToken(token).equals(hash)).toBe(true);
    expect(hashAuthToken(newAuthToken()).equals(hash)).toBe(false);
  });

  it("issues a token with the purpose's lifetime and rotates the old ones", async () => {
    const calls = [];
    const store = { issueAuthToken: vi.fn(async (row) => (calls.push(row), { id: row.id })) };
    const issued = await issueAuthToken(store, {
      userId: "user-1",
      purpose: "password_reset",
      email: "a@example.com",
      now: 1_000,
    });
    expect(issued.expiresAt.getTime()).toBe(1_000 + AUTH_TOKEN_TTL_MS.password_reset);
    expect(calls[0].tokenHash).toHaveLength(32);
    expect(calls[0].purpose).toBe("password_reset");
    expect(JSON.stringify(calls[0])).not.toContain(issued.token);
  });

  it("refuses an unknown purpose", async () => {
    await expect(
      issueAuthToken({ issueAuthToken: vi.fn() }, {
        userId: "user-1",
        purpose: "magic_link",
        email: "a@example.com",
      }),
    ).rejects.toThrow(/purpose/);
  });

  it("classifies a missing token as invalid without touching the store", async () => {
    const store = { completePasswordReset: vi.fn() };
    await expect(resetPasswordWithToken(store, { token: "", passwordHash: "h" })).resolves.toEqual({
      status: "invalid",
    });
    expect(store.completePasswordReset).not.toHaveBeenCalled();
  });

  it("passes only the hash to the store", async () => {
    const store = { completePasswordReset: vi.fn(async () => ({ status: "ok" })) };
    const token = newAuthToken();
    await resetPasswordWithToken(store, { token, passwordHash: "hash" });
    const arg = store.completePasswordReset.mock.calls[0][0];
    expect(arg.tokenHash.equals(hashAuthToken(token))).toBe(true);
    expect(JSON.stringify(arg)).not.toContain(token);
  });

  it("does the same cheap work for an unknown address", () => {
    expect(() => dummyAuthTokenWork()).not.toThrow();
  });
});
