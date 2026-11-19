import { call } from "./api";

/** One browser session as the account owner sees it (ADR-153); never a token. */
export interface AccountSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

export const sessionsApi = {
  list: () => call<{ sessionId: string | null; sessions: AccountSession[] }>("/auth/sessions"),
  revoke: (id: string) =>
    call<{ ok: true; current: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
