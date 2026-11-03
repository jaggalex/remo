/**
 * Sign-up, sign-in, sign-out, the current user and a password change.
 */
import {
  DUMMY_PASSWORD_HASH,
  capabilitiesFor,
  hashPassword,
  hashToken,
  isEmail,
  newToken,
  normalizeEmail,
  orgCapabilitiesFor,
  passwordProblem,
  verifyPassword,
} from "./iam.mjs";
import { clearFailures, reserveAttempt } from "./attempts.mjs";
import { hashQueue } from "./hash-queue.mjs";
import {
  SESSION_DAYS,
  clearedSessionCookie,
  fail,
  json,
  orgSlugFor,
  readBody,
  sessionCookie,
} from "./iam-http.mjs";
import { csrfToken } from "./csrf.mjs";

const THEMES = new Set(["system", "light", "dark"]);
const LANGS = new Set(["ru", "en"]);

/** The one shape of an account's display preferences on the wire (ADR-150). */
function preferencesOf(row) {
  return { theme: row?.theme ?? null, lang: row?.lang ?? null };
}

export async function handleAuthRoutes(ctx) {
  const { request, response, url, parts, store, method, user, session, secure, audit } = ctx;

  if (url.pathname === "/auth/register" && method === "POST") {
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    const email = normalizeEmail(body.email);
    const name = String(body.name ?? "").trim() || email.split("@")[0];
    if (!isEmail(email)) return fail(response, 422, "BAD_EMAIL", "enter a valid email"), true;
    const weak = passwordProblem(body.password);
    if (weak) return fail(response, 422, weak.code, weak.message), true;

    // Registration is a second expensive hash and an account factory. Reserve one
    // attempt per address before hashing, so a burst cannot queue scrypt work.
    const registerIp = ctx.ip ?? "unknown";
    if (
      !reserveAttempt(`register:${registerIp}`, {
        limit: Number(process.env.REMO_REGISTER_LIMIT ?? 20),
        windowMs: 60 * 60_000,
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many accounts from this address" },
        { "Retry-After": "3600" },
      ), true;
    }

    if (await store.findUserByEmail(email)) {
      return fail(response, 409, "EMAIL_TAKEN", "this email already has an account"), true;
    }

    let passwordHash;
    try {
      passwordHash = await hashQueue.withSlot(() => hashPassword(body.password));
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }
    const created = await store.createUser({ email, passwordHash, name });
    const { org, team } = await store.createOrgWithOwner({
      name: `${name}'s workspace`,
      slug: orgSlugFor(name),
      userId: created.id,
    });
    const sessionToken = newToken();
    await store.createSession({
      userId: created.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      userAgent: request.headers["user-agent"] ?? null,
    });
    await audit({
      actorId: created.id,
      orgId: org.id,
      action: "auth.register",
      subject: email,
    });
    json(
      response,
      201,
      {
        user: {
          id: created.id,
          email: created.email,
          name: created.name,
          preferences: preferencesOf(created),
        },
        org,
        team,
        capabilities: capabilitiesFor("owner"),
      },
      { "Set-Cookie": sessionCookie(sessionToken, secure) },
    );
    return true;
  }

  if (url.pathname === "/auth/login" && method === "POST") {
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const email = normalizeEmail(body.email);
    const ip = ctx.ip ?? "unknown";
    const key = `login:${ip}:${email}`;
    const ipKey = `login-ip:${ip}`;
    // Reserve before the database lookup and scrypt: two parallel requests that both
    // read a count of nine must not both reach the hash.
    if (
      !reserveAttempt(ipKey, {
        limit: Number(process.env.REMO_LOGIN_IP_LIMIT ?? 100),
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many attempts; try again later" },
        { "Retry-After": "900" },
      ), true;
    }
    if (
      !reserveAttempt(key, {
        limit: Number(process.env.REMO_LOGIN_LIMIT ?? 10),
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many attempts; try again later" },
        { "Retry-After": "900" },
      ), true;
    }
    const found = await store.findUserByEmail(email);
    // Verify against a hash no account owns when the email is unknown: both failures
    // then cost the same scrypt work, so the answer does not reveal an account.
    let ok;
    try {
      ok = await hashQueue.withSlot(() =>
        verifyPassword(
          String(body.password ?? ""),
          found?.password_hash ?? DUMMY_PASSWORD_HASH,
        ),
      );
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }
    if (!ok || found?.state !== "active") {
      // The attempt is already reserved; a failure leaves it counted.
      return fail(response, 401, "INVALID_CREDENTIALS", "wrong email or password"), true;
    }
    clearFailures(key);
    const sessionToken = newToken();
    await store.createSession({
      userId: found.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      userAgent: request.headers["user-agent"] ?? null,
    });
    await audit({ actorId: found.id, action: "auth.login", subject: found.email });
    json(
      response,
      200,
      {
        user: {
          id: found.id,
          email: found.email,
          name: found.name,
          preferences: preferencesOf(found),
        },
      },
      { "Set-Cookie": sessionCookie(sessionToken, secure) },
    );
    return true;
  }

  if (url.pathname === "/auth/logout" && method === "POST") {
    if (session) await store.revokeSession(session.tokenHash);
    if (user) await audit({ actorId: user.id, action: "auth.logout", subject: user.email });
    json(response, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie });
    return true;
  }

  if (url.pathname === "/auth/me" && method === "GET") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const orgs = (await store.listOrgsForUser(user.id)).map((org) => ({
      ...org,
      capabilities: orgCapabilitiesFor(org),
    }));
    // The app reads the cookie directly; the field is the documented place a client
    // looks (spec/IAM-v1.md §6) and keeps the double-submit pair discoverable.
    json(response, 200, { user, orgs, csrfToken: csrfToken(request) });
    return true;
  }

  if (url.pathname === "/auth/sessions" && method === "GET") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const rows = await store.listSessionsForUser(user.id);
    json(response, 200, {
      sessionId: session.sessionId ?? null,
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        userAgent: row.user_agent ?? null,
        current: row.id === session.sessionId,
      })),
    });
    return true;
  }

  if (
    parts[0] === "auth" &&
    parts[1] === "sessions" &&
    parts.length === 3 &&
    method === "DELETE"
  ) {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const id = parts[2];
    const removed = await store.revokeSessionById(user.id, id);
    if (!removed) {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "session not found"), true;
    }
    const current = id === session.sessionId;
    await audit({ actorId: user.id, action: "auth.session_revoked", subject: id });
    json(
      response,
      200,
      { ok: true, current },
      current ? { "Set-Cookie": clearedSessionCookie } : {},
    );
    return true;
  }

  if (url.pathname === "/auth/preferences" && method === "PATCH") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body || typeof body !== "object") {
      return fail(response, 400, "BAD_JSON", "malformed request"), true;
    }
    const theme = body.theme ?? null;
    const lang = body.lang ?? null;
    if (theme !== null && !THEMES.has(theme)) {
      return fail(response, 422, "BAD_THEME", "theme must be system, light or dark"), true;
    }
    if (lang !== null && !LANGS.has(lang)) {
      return fail(response, 422, "BAD_LANG", "language must be ru or en"), true;
    }
    const preferences = await store.updateUserPreferences(user.id, { theme, lang });
    json(response, 200, { preferences });
    return true;
  }

  if (url.pathname === "/auth/password" && method === "POST") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const found = await store.findUserByEmail(user.email);
    if (!found || !(await verifyPassword(String(body.currentPassword ?? ""), found.password_hash))) {
      return fail(response, 403, "INVALID_CREDENTIALS", "current password is wrong"), true;
    }
    const weak = passwordProblem(body.newPassword);
    if (weak) return fail(response, 422, weak.code, weak.message), true;
    await store.updatePassword(user.id, await hashPassword(body.newPassword));
    // Changing a password ends every other session, the way people expect.
    await store.revokeUserSessions(user.id);
    await audit({ actorId: user.id, action: "auth.password_changed", subject: user.email });
    json(response, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie });
    return true;
  }

  return false;
}
