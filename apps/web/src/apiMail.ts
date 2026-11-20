/**
 * The mail-backed account routes (ADR-246, `spec/mail.md` §5.0).
 *
 * They live beside `api.ts` rather than inside it: the main client is at its file-size
 * budget, and these five calls are the only ones that depend on the mail driver being on.
 */
import { call } from "./apiCall";

/** What the server can offer without a session; all three follow the driver today. */
export interface AuthCapabilities {
  mail: boolean;
  passwordReset: boolean;
  emailVerification: boolean;
}

/** Without a session: the sign-in dialog asks this before offering "Forgot password?". */
export function authCapabilities(): Promise<AuthCapabilities> {
  return call<AuthCapabilities>("/auth/capabilities");
}

/** Always answers 202, whether or not the address belongs to an account. */
export function forgotPassword(email: string): Promise<{ ok: true }> {
  return call<{ ok: true }>("/auth/password/forgot", { method: "POST", body: { email } });
}

/** The token is one-time and short-lived; the server never signs the person in. */
export function resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
  return call<{ ok: true }>("/auth/password/reset", {
    method: "POST",
    body: { token, newPassword },
  });
}

/** Works with and without a session: a letter is often opened in another browser. */
export function verifyEmail(token: string): Promise<{ ok: true }> {
  return call<{ ok: true }>("/auth/email/verify", { method: "POST", body: { token } });
}

/** Needs a session; a confirmed address answers `alreadyVerified`. */
export function resendVerification(): Promise<{ ok: true; alreadyVerified?: boolean }> {
  return call<{ ok: true; alreadyVerified?: boolean }>("/auth/email/resend", { method: "POST" });
}
