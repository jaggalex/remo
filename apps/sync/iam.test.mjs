import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  capabilitiesFor,
  effective,
  hashPassword,
  hashToken,
  isEmail,
  MIN_PASSWORD,
  newToken,
  normalizeEmail,
  passwordProblem,
  strongestRole,
  verifyPassword,
} from "./iam.mjs";

/**
 * The access rule, tested as a rule (ADR-061, spec/IAM-v1.md §4).
 *
 * Deny by default, suspension overrides everything, sources are reported so "why do I
 * still have access" has an answer, and an administrator role is never an input.
 */

const board = (over = {}) => ({
  id: "b1",
  ownerId: "owner-1",
  orgId: "org-1",
  teamId: "team-1",
  visibility: "private",
  archivedAt: null,
  aclVersion: 3,
  ...over,
});

const member = (over = {}) => ({
  userId: "u1",
  org: { relation: "member", state: "active" },
  teamRole: "member",
  ...over,
});

describe("capabilities", () => {
  it("gives a viewer read only and a commenter the social layer", () => {
    expect(capabilitiesFor("viewer")).toEqual(["board.read", "board.export"]);
    expect(capabilitiesFor("commenter")).toEqual([
      "board.read",
      "board.comment",
      "board.export",
    ]);
  });

  it("separates editing from sharing and from ownership", () => {
    // spec/IAM-v1.md §3: an editor may share when the organisation allows it; the
    // `canShare` filter below is what removes the capability, not the base role.
    expect(capabilitiesFor("editor")).toContain("board.share");
    expect(capabilitiesFor("coowner")).toContain("board.share");
    expect(capabilitiesFor("coowner")).not.toContain("board.delete");
    expect(capabilitiesFor("owner")).toContain("board.delete");
  });

  it("removes sharing from an editor when the organisation forbids it", () => {
    expect(capabilitiesFor("editor", { canShare: false })).toEqual([
      "board.read",
      "board.comment",
      "board.edit",
      "board.export",
      "board.backup",
      "board.facilitate",
    ]);
    // The owner's authority is not a member policy.
    expect(capabilitiesFor("owner", { canShare: false })).toContain("board.share");
  });

  it("separates facilitation from reading and editing", () => {
    expect(capabilitiesFor("viewer")).not.toContain("board.facilitate");
    expect(capabilitiesFor("commenter")).not.toContain("board.facilitate");
    expect(capabilitiesFor("editor")).toContain("board.facilitate");
    expect(capabilitiesFor("coowner")).toContain("board.facilitate");
    expect(capabilitiesFor("owner")).toContain("board.facilitate");
  });

  it("takes the strongest of several roles", () => {
    expect(strongestRole(["viewer", "editor", "commenter"])).toBe("editor");
    expect(strongestRole([])).toBeNull();
  });
});

describe("effective access", () => {
  it("lets the owner in", () => {
    const access = effective({ board: board(), viewer: member({ userId: "owner-1" }) });
    expect(access).toMatchObject({ allowed: true, role: "owner", reason: "ALLOW" });
    expect(access.capabilities).toContain("board.transfer");
    expect(access.sources).toEqual(["owner"]);
  });

  it("closes a room that has no owner, whoever asks", () => {
    const unowned = board({ ownerId: null, orgId: null, teamId: null, visibility: "link" });
    // Even the link and an org grant do not reopen it (ADR-174): there is no owner to
    // derive a viewer from, and the legacy rule is gone.
    const link = effective({
      board: unowned,
      viewer: null,
      grants: [{ subjectType: "org", subjectId: "org-1", role: "editor" }],
      link: { role: "viewer" },
    });
    expect(link).toMatchObject({ allowed: false, reason: "UNCLAIMED", capabilities: [] });
    expect(
      effective({ board: unowned, viewer: member(), grants: [] }).reason,
    ).toBe("UNCLAIMED");
  });

  it("denies a stranger and says it needs an account", () => {
    const access = effective({ board: board(), viewer: null });
    expect(access).toMatchObject({ allowed: false, reason: "AUTH_REQUIRED" });
  });

  it("denies a signed-in user with no grant", () => {
    const access = effective({ board: board(), viewer: member({ userId: "u2" }) });
    expect(access).toMatchObject({ allowed: false, reason: "FORBIDDEN" });
  });

  it("applies a direct grant", () => {
    const access = effective({
      board: board(),
      viewer: member({ userId: "u2" }),
      grants: [{ subjectType: "user", subjectId: "u2", role: "editor" }],
    });
    expect(access).toMatchObject({ allowed: true, role: "editor" });
    expect(access.sources).toEqual(["grant:user"]);
  });

  it("applies a team grant only to a member of that team", () => {
    const grants = [{ subjectType: "team", subjectId: "team-1", role: "editor" }];
    expect(
      effective({ board: board(), viewer: member({ userId: "u2" }), grants }),
    ).toMatchObject({ allowed: true, role: "editor", sources: ["grant:team"] });

    expect(
      effective({
        board: board(),
        viewer: member({ userId: "u2", teamRole: null }),
        grants,
      }),
    ).toMatchObject({ allowed: false });
  });

  it("applies an org grant to an active member, not to a guest", () => {
    const grants = [{ subjectType: "org", subjectId: "org-1", role: "viewer" }];
    expect(
      effective({ board: board(), viewer: member({ userId: "u2" }), grants }),
    ).toMatchObject({ allowed: true, role: "viewer" });

    expect(
      effective({
        board: board(),
        viewer: member({ userId: "u2", org: { relation: "guest", state: "active" } }),
        grants,
      }),
    ).toMatchObject({ allowed: false });
  });

  it("takes the maximum over sources and reports them all", () => {
    const access = effective({
      board: board(),
      viewer: member({ userId: "u2" }),
      grants: [
        { subjectType: "user", subjectId: "u2", role: "viewer" },
        { subjectType: "team", subjectId: "team-1", role: "editor" },
      ],
    });
    expect(access.role).toBe("editor");
    expect(access.sources.sort()).toEqual(["grant:team", "grant:user"]);
  });

  it("drops every grant when the person is not in the organisation", () => {
    const access = effective({
      board: board(),
      viewer: { userId: "u2", org: null, teamRole: "member" },
      grants: [
        { subjectType: "user", subjectId: "u2", role: "editor" },
        { subjectType: "team", subjectId: "team-1", role: "editor" },
      ],
    });
    expect(access).toMatchObject({ allowed: false, reason: "FORBIDDEN" });
    // Even ownership needs a seat: a removed owner cannot open their own board.
    const ownerGone = effective({
      board: board(),
      viewer: { userId: "owner-1", org: { relation: "member", state: "removed" }, teamRole: null },
    });
    expect(ownerGone.allowed).toBe(false);
  });

  it("is deny-overrides for a suspended member", () => {
    const access = effective({
      board: board(),
      viewer: member({ userId: "u2", org: { relation: "member", state: "suspended" } }),
      grants: [{ subjectType: "user", subjectId: "u2", role: "editor" }],
    });
    expect(access).toMatchObject({ allowed: false, reason: "ORG_SUSPENDED" });
  });

  it("does not let an administrator role in by itself", () => {
    // The rule has no admin input at all: an org_admin without a grant is a stranger.
    const access = effective({
      board: board(),
      viewer: member({ userId: "admin-1" }),
      grants: [],
    });
    expect(access.allowed).toBe(false);
  });

  it("makes an archived board read-only", () => {
    const access = effective({
      board: board({ archivedAt: "2026-10-25T00:00:00Z" }),
      viewer: member({ userId: "editor-1" }),
      grants: [{ subjectType: "user", subjectId: "editor-1", role: "editor" }],
    });
    expect(access.allowed).toBe(true);
    expect(access.capabilities).toEqual(["board.read"]);
  });

  it("lets a public link in read-only, and only when the policy allows it", () => {
    const shared = board({ visibility: "link" });
    expect(
      effective({ board: shared, viewer: null, link: { role: "viewer" }, policy: { publicLinks: true } }),
    ).toMatchObject({ allowed: true, role: "viewer", sources: ["link"] });

    expect(
      effective({ board: shared, viewer: null, link: { role: "viewer" }, policy: { publicLinks: false } }),
    ).toMatchObject({ allowed: false });

    // A private board ignores the link entirely.
    expect(
      effective({ board: board(), viewer: null, link: { role: "viewer" } }),
    ).toMatchObject({ allowed: false });
  });

  it("never lets a link escalate above viewer or take data out", () => {
    const access = effective({
      board: board({ visibility: "link" }),
      viewer: null,
      link: { role: "editor" },
    });
    expect(access.role).toBe("viewer");
    expect(access.capabilities).not.toContain("board.export");
    expect(access.capabilities).not.toContain("board.backup");
  });

  it("keeps export for a signed-in viewer who also has a grant", () => {
    // The link is present on every read of a link-shared board. It must not strip the
    // grant's capabilities from someone who signed in (ADR-071).
    const access = effective({
      board: board({ visibility: "link" }),
      viewer: member({ userId: "viewer-1" }),
      grants: [{ subjectType: "user", subjectId: "viewer-1", role: "viewer" }],
      link: { role: "viewer" },
    });
    expect(access.sources).toEqual(["grant:user", "link"]);
    expect(access.capabilities).toContain("board.export");
    expect(access.capabilities).not.toContain("board.backup");
  });
});

describe("passwords", () => {
  it("round-trips a password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
    await expect(verifyPassword("correct horse batterY", stored)).resolves.toBe(false);
  });

  it("has a dummy hash with the same scrypt parameters as a real one", async () => {
    // Sign-in verifies this when the email is unknown. Same parameters means the
    // failure costs the same work, so timing cannot reveal an account (ADR-062).
    const real = await hashPassword("correct horse battery");
    expect(DUMMY_PASSWORD_HASH.split("$").slice(0, 4)).toEqual(real.split("$").slice(0, 4));
    await expect(verifyPassword("anything", DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });

  it("stores a different hash for the same password (per-user salt)", async () => {
    const a = await hashPassword("same password 123");
    const b = await hashPassword("same password 123");
    expect(a).not.toBe(b);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
  });

  it("enforces the minimum length", () => {
    expect(passwordProblem("short")).toMatchObject({ code: "WEAK_PASSWORD" });
    expect(passwordProblem("x".repeat(MIN_PASSWORD))).toBeNull();
  });
});

describe("tokens and email", () => {
  it("creates distinct tokens and hashes them deterministically", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(hashToken(a).equals(hashToken(a))).toBe(true);
    expect(hashToken(a).equals(hashToken(b))).toBe(false);
  });

  it("normalizes email case but keeps the local part intact", () => {
    expect(normalizeEmail("  Alice+Tag@Example.COM ")).toBe("alice+tag@example.com");
    expect(isEmail("alice@example.com")).toBe(true);
    expect(isEmail("not-an-email")).toBe(false);
  });
});
