import { useState } from "react";
import { api, type SessionUser } from "./api";
import { useI18n } from "./i18n";

/**
 * Sign in or create an account.
 *
 * A dialog rather than a route: the board stays mounted behind it, so a person who
 * opens a protected link lands on the board they meant to see and signs in on top of it
 * instead of losing the URL. Email and password only — there is no mail infrastructure
 * yet, which the dialog says rather than hiding (spec/IAM-v1.md §6).
 */
export function AuthDialog({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (user: SessionUser) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "register"
          ? await api.register({ email, password, name: name || email.split("@")[0] || "You" })
          : await api.login({ email, password });
      onSignedIn(result.user);
      setPassword("");
      onClose();
    } catch (failure) {
      const code = failure instanceof Error ? (failure as { code?: string }).code ?? "" : "";
      setError(
        code === "INVALID_CREDENTIALS"
          ? t("auth.wrong")
          : code === "EMAIL_TAKEN"
            ? t("auth.taken")
            : code === "WEAK_PASSWORD"
              ? t("auth.weak")
              : t("auth.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <form
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("auth.title")}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "active" : undefined}
            onClick={() => setMode("login")}
          >
            {t("auth.login")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "active" : undefined}
            onClick={() => setMode("register")}
          >
            {t("auth.register")}
          </button>
        </div>

        {mode === "register" && (
          <label className="auth-field">
            <span>{t("auth.name")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="auth-field">
          <span>{t("auth.email")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="auth-field">
          <span>{t("auth.password")}</span>
          <input
            type="password"
            required
            minLength={mode === "register" ? 10 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
        </label>

        {mode === "register" && <p className="auth-hint">{t("auth.passwordHint")}</p>}
        {error && <p className="auth-error">{error}</p>}

        <div className="auth-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("auth.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? t("auth.working") : mode === "register" ? t("auth.create") : t("auth.enter")}
          </button>
        </div>
        <p className="auth-hint">{t("auth.noEmail")}</p>
      </form>
    </div>
  );
}
