/**
 * The support HTTP surface (ADR-250, `spec/support.md` §2.3–§2.5).
 *
 * Four routes, one provider switch:
 *
 *   GET  /support/config          no session; the mode and the waiting text
 *   POST /support/identity        session + CSRF; the signed identity for the widget
 *   POST /support/identity/rotate session + CSRF + instance operator; a new identifier
 *   GET  /support/context         bearer token; read-only aggregates for the first-line agent
 *
 * The server has already stripped `/api` (the same contract as `/auth`), and the global
 * CSRF check has already run for every non-GET. Nothing here can change a room, an
 * organisation or a bill: identity only writes the person's own `support_id`, context is
 * a read.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { buildInfo } from "./build-info.mjs";
import { entitlementsFor } from "./billing.mjs";
import { fail, json } from "./iam-http.mjs";
import { reserveQuota } from "./attempts.mjs";
import {
  randomSupportId,
  signSupportIdentity,
  supportCapabilities,
} from "./support.mjs";

/** 600 calls an hour per token (spec §2.5). */
const CONTEXT_LIMIT = 600;
const CONTEXT_WINDOW_MS = 60 * 60_000;
const IDENTIFIER = /^sup_[0-9a-f]{32}$/;

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(String(expected ?? ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function bearer(request) {
  const header = String(request.headers.authorization ?? "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function supportIdentity({ response, store, user, support }) {
  if (!support.hmacSecret) {
    return fail(response, 503, "SUPPORT_NOT_CONFIGURED", "support identity is not configured");
  }
  if (!store.pool) {
    return fail(response, 501, "IAM_UNAVAILABLE", "support needs the postgres store");
  }

  // The identifier is created on the first visit and never replaced by this route: a
  // leaked hash can only be revoked by the operator rotation, not by reloading the panel.
  const candidate = randomSupportId();
  const { rows } = await store.pool.query(
    `update users set support_id = coalesce(support_id, $2)
      where id = $1
      returning support_id`,
    [user.id, candidate],
  );
  const identifier = rows[0]?.support_id;
  if (!identifier) {
    return fail(response, 409, "SUPPORT_IDENTITY_UNAVAILABLE", "the account has no support identity");
  }

  // Plan and organisation come from the person's first organisation — the same answer
  // `/auth/me` gives the account menu. Room content is never part of an attribute.
  const orgs = await store.listOrgsForUser(user.id);
  const org = orgs[0] ?? null;
  const plan = org ? (await entitlementsFor(store, org.id)).plan : null;
  const build = buildInfo();

  json(response, 200, {
    identifier,
    identifierHash: signSupportIdentity(identifier, support.hmacSecret),
    name: user.name,
    email: user.email,
    attributes: {
      remo_user_id: user.id,
      plan,
      org_id: org?.id ?? null,
      org_name: org?.name ?? null,
      lang: user.preferences?.lang ?? "ru",
      app_version: `${build.version}+${build.build}`,
      // The installation's region, not the browser's: it tells the operator which
      // privacy regime the conversation falls under (spec §3.1).
      region: process.env.REMO_REGION ?? "ru",
    },
  });
}

/** Used/maximum for a context organisation; the plan fields stay null until billing. */
async function orgContext(store, org) {
  const entitlements = await entitlementsFor(store, org.id);
  const counts = await store.withTenant(org.id, async () => {
    const { rows: seats } = await store.pool.query(
      `select count(*)::int as used
         from org_memberships
        where org_id = $1 and state = 'active' and relation = 'member'`,
      [org.id],
    );
    const { rows: rooms } = await store.pool.query(
      `select count(*)::int as used
         from boards
        where org_id = $1 and archived_at is null`,
      [org.id],
    );
    return { seats: seats[0]?.used ?? 0, rooms: rooms[0]?.used ?? 0 };
  });

  return {
    id: org.id,
    name: org.name,
    plan: entitlements.plan,
    status: entitlements.status,
    seats: { used: counts.seats, max: entitlements.limits.seats },
    rooms: { used: counts.rooms, max: entitlements.limits.rooms },
  };
}

/**
 * The operator's rotation (§2.3): a new `support_id` for the signed-in account.
 *
 * Only an `instance_operators` holder may do it (ADR-248): the identifier is what Chatwoot
 * trusts, so replacing it is an installation-level act, not a profile setting. The account
 * is untouched — the same person, a different handle the widget knows them by — and the
 * audit row is what proves who retired the old one.
 */
async function rotateSupportIdentity({ response, store, user, audit }) {
  if (!store.pool) {
    return fail(response, 501, "IAM_UNAVAILABLE", "support needs the postgres store");
  }
  if (!(await store.isInstanceOperator(user.id))) {
    return fail(
      response,
      403,
      "FORBIDDEN",
      "only an instance operator may rotate a support identity",
    );
  }

  const identifier = await store.rotateSupportId(user.id, randomSupportId());
  if (!identifier) {
    return fail(response, 409, "SUPPORT_IDENTITY_UNAVAILABLE", "the account has no support identity");
  }

  await audit({ action: "support.identity_rotated", subject: identifier, actorId: user.id });
  json(response, 200, { identifier });
}

async function supportContext({ request, response, store, support, audit }) {
  const token = bearer(request);
  if (!support.contextToken || !sameSecret(token, support.contextToken)) {
    return fail(response, 401, "UNAUTHORIZED", "a support context token is required");
  }
  // The raw token never becomes a map key; a hash keeps an in-memory leak uninteresting.
  const key = `support-context:${createHash("sha256").update(token).digest("hex")}`;
  // `contextLimit` has no environment variable. It is a test seam so the quota regression
  // does not have to send six hundred requests; production always uses 600.
  if (!reserveQuota(key, { limit: support.contextLimit ?? CONTEXT_LIMIT, windowMs: CONTEXT_WINDOW_MS })) {
    return fail(response, 429, "RATE_LIMITED", "too many context reads; try again later");
  }
  if (!store.pool) {
    return fail(response, 501, "IAM_UNAVAILABLE", "support context needs the postgres store");
  }

  const identifier = String(new URL(request.url, "http://localhost").searchParams.get("identifier") ?? "").trim();
  if (!IDENTIFIER.test(identifier)) {
    // A malformed identifier is an unknown one: the answer carries no metadata either way.
    return fail(response, 404, "NOT_FOUND", "no such support identifier");
  }

  const { rows } = await store.pool.query(
    `select id, email_verified_at, created_at, state
       from users
      where support_id = $1`,
    [identifier],
  );
  const found = rows[0];
  if (!found) return fail(response, 404, "NOT_FOUND", "no such support identifier");

  const orgs = await store.listOrgsForUser(found.id);
  const context = [];
  for (const org of orgs) context.push(await orgContext(store, org));

  // Every read is recorded: the agent's access to personal data must be visible (ADR-250).
  await audit({ action: "support.context_read", subject: identifier });

  json(response, 200, {
    user: {
      emailVerified: Boolean(found.email_verified_at),
      createdAt: found.created_at,
      state: found.state,
    },
    orgs: context,
    // Billing and the mailbox exist in the product but not yet in this contract (§2.5).
    billing: null,
    limits: { storageUsedBytes: 0 },
  });
}

/**
 * @returns {Promise<boolean>} true when the request was a support route.
 */
export async function handleSupportRoutes({
  request,
  response,
  url,
  method,
  store,
  session,
  user,
  audit,
  support = null,
}) {
  if (!url.pathname.startsWith("/support/") && url.pathname !== "/support") return false;

  // `none` is not "a route that says no": the surface does not exist at all (§2.1).
  if (!support || support.provider === "none") {
    fail(response, 404, "NOT_FOUND", "support is not configured");
    return true;
  }

  if (url.pathname === "/support/config" && method === "GET") {
    json(response, 200, supportCapabilities(support));
    return true;
  }

  if (url.pathname === "/support/identity" && method === "POST") {
    if (!session) {
      fail(response, 401, "AUTH_REQUIRED", "sign in first");
      return true;
    }
    if (support.provider !== "chatwoot") {
      // `link` opens someone else's page; there is no widget to sign into.
      fail(response, 404, "NOT_FOUND", "support identity is not configured");
      return true;
    }
    await supportIdentity({ response, store, user, support });
    return true;
  }

  if (url.pathname === "/support/identity/rotate" && method === "POST") {
    if (!session) {
      fail(response, 401, "AUTH_REQUIRED", "sign in first");
      return true;
    }
    if (support.provider !== "chatwoot") {
      fail(response, 404, "NOT_FOUND", "support identity is not configured");
      return true;
    }
    await rotateSupportIdentity({ response, store, user, audit });
    return true;
  }

  if (url.pathname === "/support/context" && method === "GET") {
    await supportContext({ request, response, store, support, audit });
    return true;
  }

  fail(response, 404, "NOT_FOUND", "no such support route");
  return true;
}
