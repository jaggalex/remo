import { describe, expect, it } from "vitest";
import {
  INTEGRATION_TOKEN_MAX_DAYS,
  INTEGRATION_SCOPES,
  expiryFromDays,
  hasScope,
  integrationFromRequest,
  normalizeScopes,
  newIntegrationToken,
} from "./integrations.mjs";

const token = (overrides = {}) => ({
  id: "token-1",
  org_id: "org-1",
  owner_id: "user-1",
  label: "ci",
  scopes: ["board.read"],
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  revoked_at: null,
  ...overrides,
});

/** A store whose only token is `row`; the secret is the one the request carries. */
function fakeStore(row) {
  return {
    async findIntegrationToken() {
      return row;
    },
    async touchIntegrationToken() {},
  };
}

const request = (secret) => ({ headers: { authorization: `Bearer ${secret}` } });

describe("integration scopes", () => {
  it("accepts only known capabilities, without duplicates", () => {
    expect(INTEGRATION_SCOPES).toEqual(["board.read", "board.edit"]);
    expect(normalizeScopes(["board.read", "board.read"])).toEqual(["board.read"]);
    expect(normalizeScopes(["board.read", "board.edit"])).toEqual(["board.read", "board.edit"]);
  });

  it("rejects an unknown scope and a non-list", () => {
    expect(normalizeScopes(["board.delete"])).toBeNull();
    expect(normalizeScopes("board.read")).toBeNull();
    expect(normalizeScopes(undefined)).toBeNull();
  });

  it("requires an end date within a year", () => {
    const now = Date.UTC(2026, 9, 28);
    expect(expiryFromDays(undefined, now).toISOString()).toBe(expiryFromDays(90, now).toISOString());
    expect(expiryFromDays(1, now).getTime()).toBeGreaterThan(now);
    expect(expiryFromDays(INTEGRATION_TOKEN_MAX_DAYS + 1, now)).toBeNull();
    expect(expiryFromDays(0, now)).toBeNull();
    expect(expiryFromDays("forever", now)).toBeNull();
  });

  it("narrows a person's access and never widens it", () => {
    const user = { kind: "user", user: { id: "u" }, scopes: null };
    const reader = { kind: "integration", user: { id: "u" }, scopes: ["board.read"] };
    const editor = { kind: "integration", user: { id: "u" }, scopes: ["board.edit"] };
    // A person is governed by the board; a token additionally needs the scope.
    expect(hasScope(user, "board.edit")).toBe(true);
    expect(hasScope(reader, "board.read")).toBe(true);
    expect(hasScope(reader, "board.edit")).toBe(false);
    expect(hasScope(editor, "board.read")).toBe(false);
    expect(hasScope(null, "board.read")).toBe(false);
  });
});

describe("token lookup", () => {
  it("generates a recognisable secret and ignores non-integration bearers", async () => {
    expect(newIntegrationToken()).toMatch(/^remo_it_/);
    const store = fakeStore(null);
    expect(await integrationFromRequest(request("agent_secret"), store)).toBeNull();
    expect(await integrationFromRequest({ headers: {} }, store)).toBeNull();
  });

  it("resolves a live token to its owner and scopes", async () => {
    const found = await integrationFromRequest(request("remo_it_live"), fakeStore(token()));
    expect(found).toMatchObject({
      id: "token-1",
      orgId: "org-1",
      ownerId: "user-1",
      label: "ci",
      scopes: ["board.read"],
    });
  });

  it("says which reason a refused token has", async () => {
    const revoked = await integrationFromRequest(
      request("remo_it_revoked"),
      fakeStore(token({ revoked_at: new Date().toISOString() })),
    );
    expect(revoked).toEqual({ refused: "INTEGRATION_TOKEN_REVOKED" });

    const expired = await integrationFromRequest(
      request("remo_it_expired"),
      fakeStore(token({ expires_at: new Date(Date.now() - 1000).toISOString() })),
    );
    expect(expired).toEqual({ refused: "INTEGRATION_TOKEN_EXPIRED" });

    const unknown = await integrationFromRequest(request("remo_it_unknown"), fakeStore(null));
    expect(unknown).toEqual({ refused: "INTEGRATION_TOKEN_UNKNOWN" });
  });
});
