import { useEffect, useState } from "react";
import { Button, Dialog, Input, Link, Tabs } from "@remo/ui";
import { api, type SessionUser } from "./api";
import { authCapabilities, type AuthCapabilities } from "./apiMail";
import { useI18n } from "./i18n";

/**
 * Sign in or create an account.
 *
 * A dialog rather than a route: the board stays mounted behind it, so a person who
 * opens a protected link lands on the board they meant to see and signs in on top of it
 * instead of losing the URL. Password reset is offered only when the server can send
 * mail; without it the dialog says who can help instead of promising a letter
 * (spec/mail.md §7, ADR-246).
 */
export function AuthDialog({
  open,
  onClose,
  onSignedIn,
  onForgot,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (user: SessionUser) => void;
  /** Opens the "Forgot password" form; the board without one goes to the home route. */
  onForgot?: () => void;
  /** A result from the reset form, shown above the fields. */
  notice?: string | null;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  // Asked on every open: an operator may enable mail while the app is running.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    authCapabilities()
      .then((result) => {
        if (alive) setCapabilities(result);
      })
      .catch(() => {
        if (alive) setCapabilities(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  const openForgot = () => {
    if (onForgot) onForgot();
    else window.location.assign("/?forgot=1");
  };

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
          ? capabilities && !capabilities.passwordReset
            ? t("auth.adminReset")
            : t("auth.wrong")
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
    <Dialog title={t("auth.title")} size="sm" onClose={onClose}>
      <form className="dialog-stack" onSubmit={submit}>
        <Tabs
          label={t("auth.title")}
          tabs={[
            { id: "login", label: t("auth.login") },
            { id: "register", label: t("auth.register") },
          ]}
          value={mode}
          onChange={(id) => setMode(id as typeof mode)}
        />

        {mode === "register" && (
          <Input label={t("auth.name")} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        )}
        <Input
          label={t("auth.email")}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        <Input
          label={t("auth.password")}
            type="password"
            required
            minLength={mode === "register" ? 10 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />

        {mode === "login" && capabilities?.passwordReset && (
          <Link
            href="?forgot=1"
            onClick={(event) => {
              event.preventDefault();
              openForgot();
            }}
          >
            {t("auth.forgot")}
          </Link>
        )}
        {mode === "register" && <p className="auth-hint">{t("auth.passwordHint")}</p>}
        {mode === "login" && notice && <p className="auth-hint">{notice}</p>}
        {error && <p className="auth-error">{error}</p>}

        <div className="auth-actions">
          <Button onClick={onClose}>{t("auth.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("auth.working") : mode === "register" ? t("auth.create") : t("auth.enter")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
