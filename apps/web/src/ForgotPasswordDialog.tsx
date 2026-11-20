import { useState } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { ApiError } from "./apiCall";
import { forgotPassword } from "./apiMail";
import { useI18n } from "./i18n";

/**
 * "Forgot password" (ADR-246, `spec/mail.md` §7).
 *
 * The answer never says whether the address exists: after any server reply the form
 * shows one sentence, so the screen cannot be used to enumerate accounts. Only a
 * network failure is reported separately — there the request never reached the server.
 */
export function ForgotPasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.status === 429
            ? t("mail.rateLimited")
            : t("auth.failed")
          : t("mail.networkError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("mail.forgotTitle")} description={t("mail.forgotBody")} size="sm" onClose={onClose}>
      {sent ? (
        <div className="dialog-stack">
          <p className="auth-hint">{t("mail.sent")}</p>
          <div className="auth-actions">
            <Button variant="primary" onClick={onClose}>
              {t("mail.close")}
            </Button>
          </div>
        </div>
      ) : (
        <form className="dialog-stack" onSubmit={submit}>
          <Input
            label={t("auth.email")}
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
          {error && <p className="auth-error">{error}</p>}
          <div className="auth-actions">
            <Button onClick={onClose}>{t("auth.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              {busy ? t("auth.working") : t("mail.sendLink")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
