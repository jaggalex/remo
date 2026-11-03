/**
 * The identity of this tab's live connection (ADR-151).
 *
 * Presence is per session, not per account: a laptop and a desktop signed into one
 * account are two cursors, two cameras and two follow targets. `sessionStorage` makes
 * the key survive a reload of this tab without leaking into a new tab, which must be a
 * separate session.
 */
export interface BrowserSession {
  key: string;
  /** When this tab joined, so duplicate labels are stable within a run. */
  joinedAt: number;
}

const STORAGE_KEY = "remo.session";

function randomKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadBrowserSession(): BrowserSession {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrowserSession>;
      if (typeof parsed.key === "string" && typeof parsed.joinedAt === "number") {
        return { key: parsed.key, joinedAt: parsed.joinedAt };
      }
    }
  } catch {
    /* private mode: a page load is still a valid session */
  }

  const session = { key: randomKey(), joinedAt: Date.now() };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* the key only needs to live for this page */
  }
  return session;
}
