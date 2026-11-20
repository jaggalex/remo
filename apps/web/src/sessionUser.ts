/**
 * The signed-in account, as every screen receives it from `/auth/me`.
 *
 * It lives beside `api.ts` rather than inside it: the API client is at its file-size
 * budget, and a shared shape is not a reason to grow the client (ADR-093).
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  handle: string;
  /** True once a mail link proved the address; false while mail is off (ADR-246). */
  emailVerified?: boolean;
  /** Display preferences that follow the account, not the browser (ADR-150). */
  preferences?: { theme: "system" | "light" | "dark" | null; lang: "ru" | "en" | null };
}
