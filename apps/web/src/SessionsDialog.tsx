import { useEffect, useState } from "react";
import { Button, Dialog } from "@remo/ui";
import { useI18n } from "./i18n";
import { sessionsApi, type AccountSession } from "./sessionsApi";

/**
 * The devices signed in to this account (ADR-153).
 *
 * A session is a browser, not a person: the list is how a person finds the old laptop
 * they left signed in and ends it without changing the password and closing everything.
 */
export function SessionsDialog({
  open,
  onClose,
  onCurrentRevoked,
}: {
  open: boolean;
  onClose: () => void;
  /** The current session was ended: the app must drop back to signed-out state. */
  onCurrentRevoked: () => void;
}) {
  const { t, lang } = useI18n();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSessions(null);
    setError(null);
    sessionsApi
      .list()
      .then((result) => {
        if (alive) setSessions(result.sessions);
      })
      .catch(() => {
        if (!alive) return;
        setSessions([]);
        setError(t("sessions.failed"));
      });
    return () => {
      alive = false;
    };
  }, [open, t]);

  if (!open) return null;

  async function revoke(session: AccountSession) {
    setBusy(session.id);
    setError(null);
    try {
      const result = await sessionsApi.revoke(session.id);
      if (result.current) {
        onCurrentRevoked();
        return;
      }
      setSessions((current) => current?.filter((row) => row.id !== session.id) ?? null);
    } catch {
      setError(t("sessions.revokeFailed"));
    } finally {
      setBusy(null);
    }
  }

  const device = (ua: string | null) => deviceLabel(ua, t("sessions.unknownDevice"));
  const when = (iso: string) => formatWhen(iso, lang);

  return (
    <Dialog title={t("sessions.title")} description={t("sessions.body")} onClose={onClose}>
      {error && <p className="auth-error">{error}</p>}
      {sessions === null ? (
        <p className="muted">{t("sessions.loading")}</p>
      ) : sessions.length === 0 ? (
        <p className="muted">{t("sessions.empty")}</p>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <div className="session-device">
                <b>{device(session.userAgent)}</b>
                {session.current && (
                  <span className="session-current">{t("sessions.current")}</span>
                )}
                <span className="session-meta">
                  {t("sessions.lastSeen", { when: when(session.lastSeenAt) })}
                </span>
              </div>
              <Button
                variant="ghost"
                disabled={busy === session.id}
                onClick={() => void revoke(session)}
              >
                {session.current ? t("sessions.signOutCurrent") : t("sessions.signOut")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function deviceLabel(ua: string | null, unknown: string): string {
  if (!ua) return unknown;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ") || unknown;
}

function formatWhen(iso: string, lang: "ru" | "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
