/**
 * Identity, sessions and access decisions (ADR-061…063, spec/IAM-v1.md).
 *
 * Kept free of SQL and HTTP so the rules can be tested as rules: the store loads the
 * facts, `effective()` decides, the API and the socket enforce. That split is what the
 * research document calls "one place that computes access, many places that enforce it".
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/* ------------------------------------------------------------------ roles -- */

/** Board roles, weakest first. `owner` is a column on the board, not a role value. */
export const ROLES = ["viewer", "commenter", "editor", "coowner"];

const RANK = { viewer: 1, commenter: 2, editor: 3, coowner: 4, owner: 5 };

/**
 * What each board role may do.
 *
 * `commenter` now has `board.comment`: comments live in their own server tables, so the
 * role can write a message without receiving write access to the Yjs document
 * (ADR-104/105). The role stops being an alias of `viewer` (ADR-063 amendment).
 */
export const CAPABILITIES = {
  // A viewer may take a visible artefact (PNG/PDF) with them; taking the whole board
  // as a backup is a separate, stronger grant (ADR-071).
  viewer: ["board.read", "board.export"],
  commenter: ["board.read", "board.comment", "board.export"],
  editor: [
    "board.read",
    "board.comment",
    "board.edit",
    "board.share",
    "board.export",
    "board.backup",
    "board.facilitate",
  ],
  coowner: [
    "board.read",
    "board.comment",
    "board.edit",
    "board.share",
    "board.manage",
    "board.export",
    "board.backup",
    "board.facilitate",
  ],
  owner: [
    "board.read",
    "board.comment",
    "board.edit",
    "board.share",
    "board.manage",
    "board.transfer",
    "board.delete",
    "board.export",
    "board.backup",
    "board.facilitate",
  ],
};

export function rankOf(role) {
  return RANK[role] ?? 0;
}

export function strongestRole(roles) {
  let best = null;
  for (const role of roles) {
    if (role && rankOf(role) > rankOf(best)) best = role;
  }
  return best;
}

/**
 * Organisation-level capabilities.
 *
 * `board.create` belongs to an active member, not to a guest and not to a pending
 * invitation (ADR-100). It is deliberately not a board role: creating a board happens
 * before a board exists.
 */
export function orgCapabilitiesFor(membership) {
  if (!membership) return [];
  return membership.state === "active" && membership.relation === "member"
    ? ["board.create"]
    : [];
}

/** Capabilities of a role, with the organisation's sharing policy applied. */
export function capabilitiesFor(role, { canShare = true } = {}) {
  if (!role) return [];
  const all = CAPABILITIES[role] ?? [];
  // An editor may share only when the organisation allows members to share; owners and
  // co-owners always may (they are the sharing authority for their board).
  if (!canShare && (role === "editor" || role === "viewer" || role === "commenter")) {
    return all.filter((capability) => capability !== "board.share");
  }
  return all;
}

/* ----------------------------------------------------------------- access -- */

/**
 * Effective access to one board.
 *
 * Inputs are facts, not queries:
 *   board      { id, ownerId, orgId, teamId, visibility, archivedAt }
 *   viewer     { userId, org: { relation, state } | null, teamRole: string | null } | null
 *   grants     [{ subjectType: "user"|"team"|"org", subjectId, role }]
 *   policy     { canShare, publicLinks }
 *   link       { role } | null          — a valid public-link token for this board
 *
 * Returns `{ allowed, role, capabilities, sources, reason }`. Deny is the default and
 * every failure has a reason code, because "why can I not open this" is a support
 * question with a correct answer.
 */
export function effective({ board, viewer, grants = [], policy = {}, link = null }) {
  const deny = (reason) => ({ allowed: false, role: null, capabilities: [], sources: [], reason });

  if (!board) return deny("NOT_FOUND");

  // Suspension is deny-overrides: it closes direct grants, team grants and links alike
  // for someone inside the organisation (spec/IAM-v1.md §4).
  if (viewer?.org?.state === "suspended") return deny("ORG_SUSPENDED");

  const sources = [];
  const roles = [];
  // Every source except the public link requires a seat in the organisation: a grant
  // left behind after someone was removed must not keep working (spec/IAM-v1.md §4).
  const inOrg = viewer?.org?.state === "active";

  if (inOrg && viewer?.userId && board.ownerId && viewer.userId === board.ownerId) {
    roles.push("owner");
    sources.push("owner");
  } else {
    for (const grant of grants) {
      if (inOrg && grant.subjectType === "user" && grant.subjectId === viewer?.userId) {
        roles.push(grant.role);
        sources.push("grant:user");
      }
      if (grant.subjectType === "team" && board.teamId && grant.subjectId === board.teamId) {
        if (inOrg && viewer?.teamRole) {
          roles.push(grant.role);
          sources.push("grant:team");
        }
      }
      if (grant.subjectType === "org" && grant.subjectId === board.orgId) {
        // A guest is in the organisation's registry but does not inherit its sharing
        // (the research document's explicit warning, EXT-09).
        if (viewer?.org?.state === "active" && viewer.org.relation === "member") {
          roles.push(grant.role);
          sources.push("grant:org");
        }
      }
    }

    // A public link is its own subject: it grants a read-only role to whoever holds the
    // token, and it is the only source that works without an account.
    if (board.visibility === "link" && link && policy.publicLinks !== false) {
      roles.push(link.role === "editor" ? "viewer" : link.role || "viewer");
      sources.push("link");
    }
  }

  const role = strongestRole(roles);
  if (!role) return deny(viewer?.userId ? "FORBIDDEN" : "AUTH_REQUIRED");

  let capabilities = capabilitiesFor(role, { canShare: policy.canShare !== false });

  // A public link is a read grant, never a data-egress grant (ADR-069/071). The
  // restriction is about *how* the person got in: a signed-in viewer who also holds a
  // grant keeps `board.export`, otherwise opening a link-shared board would silently
  // take export away from every legitimate viewer.
  const linkOnly = sources.length === 1 && sources[0] === "link";
  if (linkOnly) {
    capabilities = capabilities.filter(
      (capability) => capability !== "board.export" && capability !== "board.backup",
    );
  }

  // An archived board is read-only for everyone; only the owner may bring it back, and
  // that is a separate command (`board.manage` is removed here, not granted).
  if (board.archivedAt) {
    capabilities = capabilities.filter((capability) => capability === "board.read");
  }

  return {
    allowed: capabilities.includes("board.read"),
    role,
    capabilities,
    sources: [...new Set(sources)],
    reason: "ALLOW",
    // The version an ETag or a socket must compare before trusting a cached decision.
    aclVersion: board.aclVersion ?? 1,
  };
}

/* --------------------------------------------------------------- passwords -- */

/**
 * scrypt from the standard library: no native dependency to build, and its parameters
 * are explicit rather than whatever a platform default happens to be.
 */
const SCRYPT = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  // 128 * N * r is 32 MiB at these parameters; Node's default cap is exactly that, and
  // the check is strict, so the budget is stated rather than inferred.
  maxmem: 96 * 1024 * 1024,
};

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const key = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64"),
      expected.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
    );
    return expected.length === key.length && timingSafeEqual(expected, key);
  } catch {
    return false;
  }
}

/** Shortest password we accept. Length beats punctuation rules at this size. */
export const MIN_PASSWORD = 10;

export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return { code: "WEAK_PASSWORD", message: `password must be at least ${MIN_PASSWORD} characters` };
  }
  if (password.length > 200) {
    return { code: "WEAK_PASSWORD", message: "password is too long" };
  }
  return null;
}

/* ------------------------------------------------------------------ tokens -- */

/** Opaque session or invite token; only its hash is stored. */
export function newToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest();
}

/** Emails are matched case-insensitively; the local part keeps its dots and pluses. */
export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}
