import { describe, expect, it } from "vitest";
import { accessForBoard } from "./iam-api.mjs";

/**
 * The public link is a board property with optional password and expiry (ADR-069).
 * These tests pin the decision boundary: what an anonymous visitor gets, when the gate
 * appears, and that a signed-in member is never stopped by the link password.
 */

const BOARD = {
  id: "public-board",
  ownerId: "owner-1",
  orgId: "org-1",
  teamId: "team-1",
  visibility: "link",
  archivedAt: null,
  aclVersion: 1,
};

function storeWith({ link = {}, grants = [], member = null } = {}) {
  const calls = { unlock: 0 };
  return {
    calls,
    async accessFacts() {
      return {
        board: BOARD,
        viewer: member
          ? { userId: member, org: { relation: "member", state: "active" }, teamRole: null }
          : null,
        grants,
        policy: {},
      };
    },
    async getBoardLink() {
      return {
        enabled: true,
        role: "viewer",
        has_password: false,
        password_hash: null,
        password_version: 1,
        expires_at: null,
        ...link,
      };
    },
    async validLinkUnlock() {
      calls.unlock += 1;
      return Boolean(link.unlocked);
    },
  };
}

describe("public link access", () => {
  it("lets an anonymous visitor read an enabled link", async () => {
    const resolved = await accessForBoard({
      store: storeWith(),
      boardId: BOARD.id,
      userId: null,
    });
    expect(resolved.access).toMatchObject({ allowed: true, role: "viewer", sources: ["link"] });
    expect(resolved.passwordRequired).toBe(false);
  });

  it("stops at the password gate without an unlock and discloses nothing", async () => {
    const resolved = await accessForBoard({
      store: storeWith({ link: { has_password: true, password_hash: "scrypt$x" } }),
      boardId: BOARD.id,
      userId: null,
    });
    expect(resolved.access.allowed).toBe(false);
    expect(resolved.passwordRequired).toBe(true);
    expect(resolved.access.reason).toBe("AUTH_REQUIRED");
  });

  it("accepts a valid unlock for the current password version", async () => {
    const store = storeWith({
      link: { has_password: true, password_hash: "scrypt$x", unlocked: true },
    });
    const resolved = await accessForBoard({
      store,
      boardId: BOARD.id,
      userId: null,
      unlockToken: "unlock-token",
    });
    expect(resolved.access.allowed).toBe(true);
    expect(resolved.passwordRequired).toBe(false);
    expect(store.calls.unlock).toBe(1);
  });

  it("treats an expired link as off, with no password prompt", async () => {
    const resolved = await accessForBoard({
      store: storeWith({ link: { expires_at: "2020-01-01T00:00:00Z" } }),
      boardId: BOARD.id,
      userId: null,
    });
    expect(resolved.access.allowed).toBe(false);
    expect(resolved.passwordRequired).toBe(false);
  });

  it("marks a disabled link as inactive instead of a generic sign-in prompt", async () => {
    const resolved = await accessForBoard({
      store: storeWith({ link: { enabled: false } }),
      boardId: BOARD.id,
      userId: null,
    });
    expect(resolved.access.allowed).toBe(false);
    expect(resolved.linkInactive).toBe(true);
    expect(resolved.passwordRequired).toBe(false);
  });

  it("marks an expired link as inactive", async () => {
    const resolved = await accessForBoard({
      store: storeWith({ link: { expires_at: "2020-01-01T00:00:00Z" } }),
      boardId: BOARD.id,
      userId: null,
    });
    expect(resolved.linkInactive).toBe(true);
  });

  it("never grants a link to an archived board", async () => {
    const store = storeWith();
    store.accessFacts = async () => ({
      board: { ...BOARD, archivedAt: "2026-10-01T00:00:00Z" },
      viewer: null,
      grants: [],
      policy: {},
    });
    const resolved = await accessForBoard({ store, boardId: BOARD.id, userId: null });
    expect(resolved.access.allowed).toBe(false);
  });

  it("does not put a signed-in member behind the link password", async () => {
    const resolved = await accessForBoard({
      store: storeWith({
        link: { has_password: true, password_hash: "scrypt$x" },
        grants: [{ subjectType: "user", subjectId: "member-1", role: "editor" }],
        member: "member-1",
      }),
      boardId: BOARD.id,
      userId: "member-1",
    });
    expect(resolved.access.allowed).toBe(true);
    expect(resolved.access.role).toBe("editor");
    expect(resolved.passwordRequired).toBe(false);
  });
});
