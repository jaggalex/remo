/**
 * Password recovery (ADR-246, `spec/mail.md` §5.0–5.2).
 *
 * Two rules shape the routes: an unknown address must be indistinguishable from a known
 * one, and a reset must never sign anybody in. The token is checked and consumed in one
 * store transaction that also rotates the password and revokes every session.
 */
import { clearFailures, reserveAttempt } from "./attempts.mjs";
import {
  dummyAuthTokenWork,
  hashAuthToken,
  issueAuthToken,
  resetPasswordWithToken,
} from "./auth-tokens.mjs";
import { hashQueue } from "./hash-queue.mjs";
import { fail, json, readBody } from "./iam-http.mjs";
import { hashPassword, normalizeEmail, passwordProblem } from "./iam.mjs";
import { enqueueMail, pickLocale } from "./mail.mjs";

const FORGOT_IP_LIMIT = 10;
const FORGOT_EMAIL_LIMIT = 3;
const RESET_IP_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const RESET_WINDOW_MS = 15 * 60 * 1000;

function forgotLink(origin) {
  return `${origin}/?forgot=1`;
}

/** The letter that tells someone their password changed; link-free when mail is off. */
async function notifyPasswordChanged(store, { userId, email, config, log }) {
  try {
    const user = await store.findUserById(userId);
    await enqueueMail(
      store,
      {
        userId,
        toEmail: email,
        template: "password_changed",
        locale: pickLocale({ userLang: user?.lang }),
        params: { email, forgotLink: forgotLink(config.appOrigin) },
      },
      { config },
    );
  } catch (error) {
    // The password has already changed; a failed notice must not turn that into an error.
    log.error("[auth] password_changed mail failed:", error.message);
  }
}

export async function handleRecoveryRoutes(ctx) {
  const { request, response, url, method, store, mail, mailConfig, audit, ip, log = console } = ctx;

  if (url.pathname === "/auth/capabilities" && method === "GET") {
    json(response, 200, mail ?? { mail: false, passwordReset: false, emailVerification: false });
    return true;
  }

  if (url.pathname === "/auth/password/forgot" && method === "POST") {
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const email = normalizeEmail(body.email);
    // The answer is the same for every address and every limit: only the letter differs.
    const answer = () => (json(response, 202, { ok: true }), true);
    if (!email) return answer();

    const ipAllowed = reserveAttempt(`forgot-ip:${ip ?? "unknown"}`, {
      limit: FORGOT_IP_LIMIT,
      windowMs: HOUR_MS,
    });
    const emailAllowed = reserveAttempt(`forgot-email:${email}`, {
      limit: FORGOT_EMAIL_LIMIT,
      windowMs: HOUR_MS,
    });
    if (!ipAllowed || !emailAllowed) return answer();
    if (!mailConfig || mailConfig.driver === "disabled") return answer();

    const found = await store.findUserByEmail(email);
    if (!found || found.state !== "active") {
      dummyAuthTokenWork();
      return answer();
    }

    try {
      const issued = await issueAuthToken(store, {
        userId: found.id,
        purpose: "password_reset",
        email: found.email,
      });
      await enqueueMail(
        store,
        {
          userId: found.id,
          toEmail: found.email,
          template: "password_reset",
          locale: pickLocale({
            userLang: found.lang,
            acceptLanguage: request.headers["accept-language"],
          }),
          params: { name: found.name },
          linkParams: { link: `${mailConfig.appOrigin}/?reset=${issued.token}` },
          validUntil: issued.expiresAt,
        },
        { config: mailConfig },
      );
      await audit({
        actorId: found.id,
        action: "auth.password_reset_requested",
        subject: found.id,
      });
    } catch (error) {
      log.error("[auth] forgot failed:", error.message);
    }
    return answer();
  }

  if (url.pathname === "/auth/password/reset" && method === "POST") {    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    if (
      !reserveAttempt(`reset-ip:${ip ?? "unknown"}`, {
        limit: RESET_IP_LIMIT,
        windowMs: RESET_WINDOW_MS,
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many attempts; try again later" },
        { "Retry-After": String(Math.round(RESET_WINDOW_MS / 1000)) },
      ), true;
    }

    const weak = passwordProblem(body.newPassword);
    if (weak) return fail(response, 422, weak.code, weak.message), true;

    let passwordHash;
    try {
      passwordHash = await hashQueue.withSlot(() => hashPassword(body.newPassword));
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }

    const result = await resetPasswordWithToken(store, {
      token: String(body.token ?? ""),
      passwordHash,
    });
    if (result.status === "expired") {
      return fail(response, 400, "TOKEN_EXPIRED", "this link has expired; request a new one"), true;
    }
    if (result.status !== "ok") {
      return fail(response, 400, "TOKEN_INVALID", "this link is not valid; request a new one"), true;
    }

    clearFailures(`reset-ip:${ip ?? "unknown"}`);
    await audit({ actorId: result.userId, action: "auth.password_reset", subject: result.userId });
    await notifyPasswordChanged(store, {
      userId: result.userId,
      email: result.email,
      config: mailConfig ?? { appOrigin: "" },
      log,
    });
    // No automatic sign-in: the link may have leaked, so only the password changes.
    return json(response, 200, { ok: true }), true;
  }

  if (url.pathname === "/auth/email/verify" && method === "POST") {
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    if (!mailConfig || mailConfig.driver === "disabled") {
      return fail(response, 404, "MAIL_DISABLED", "this installation does not send mail"), true;
    }
    const row = await store.findAuthToken(hashAuthToken(String(body.token ?? "")), "email_verify");
    if (!row) return fail(response, 400, "TOKEN_INVALID", "this link is not valid"), true;
    const owner = await store.findUserById(row.user_id);
    if (!owner) return fail(response, 400, "TOKEN_INVALID", "this link is not valid"), true;
    if (owner.email_verified_at && !row.used_at) {
      // Already proven: the link is spent, the address is confirmed either way.
      await store.consumeAuthToken(row.id);
      return json(response, 200, { ok: true }), true;
    }
    if (row.used_at) {
      return owner.email_verified_at
        ? (json(response, 200, { ok: true }), true)
        : (fail(response, 400, "TOKEN_INVALID", "this link is not valid"), true);
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return fail(response, 400, "TOKEN_EXPIRED", "this link has expired; request a new one"), true;
    }
    if (row.email !== owner.email) {
      return fail(response, 409, "EMAIL_CHANGED", "the address on this link is no longer yours"), true;
    }
    if (!(await store.consumeAuthToken(row.id))) {
      return fail(response, 400, "TOKEN_INVALID", "this link is not valid"), true;
    }
    await store.setEmailVerified(owner.id, owner.email);
    await audit({ actorId: owner.id, action: "auth.email_verified", subject: owner.id });
    return json(response, 200, { ok: true }), true;
  }

  if (url.pathname === "/auth/email/resend" && method === "POST") {
    if (!store.createUser) return fail(response, 501, "IAM_UNAVAILABLE", "accounts need postgres"), true;
    const me = ctx.user;
    if (!me) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    if (!mailConfig || mailConfig.driver === "disabled") {
      return fail(response, 404, "MAIL_DISABLED", "this installation does not send mail"), true;
    }
    if (me.emailVerified) return json(response, 200, { ok: true, alreadyVerified: true }), true;
    if (
      !reserveAttempt(`verify-resend:${me.id}`, {
        limit: 3,
        windowMs: HOUR_MS,
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many letters; try again later" },
        { "Retry-After": String(Math.round(HOUR_MS / 1000)) },
      ), true;
    }
    try {
      const user = await store.findUserById(me.id);
      const issued = await issueAuthToken(store, {
        userId: me.id,
        purpose: "email_verify",
        email: user.email,
      });
      await enqueueMail(
        store,
        {
          userId: me.id,
          toEmail: user.email,
          template: "verify_email",
          locale: pickLocale({
            userLang: user.lang,
            acceptLanguage: request.headers["accept-language"],
          }),
          params: { name: user.name },
          linkParams: { link: `${mailConfig.appOrigin}/?verify=${issued.token}` },
          validUntil: issued.expiresAt,
        },
        { config: mailConfig },
      );
    } catch (error) {
      log.error("[auth] resend failed:", error.message);
      return fail(response, 502, "MAIL_FAILED", "the letter could not be queued"), true;
    }
    return json(response, 200, { ok: true }), true;
  }

  return false;
}
