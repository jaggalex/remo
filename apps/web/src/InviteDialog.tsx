import { useEffect, useState } from "react";
import { Button, Dialog } from "@remo/ui";
import { api } from "./api";
import { useI18n } from "./i18n";

/**
 * Accepting an invitation.
 *
 * The link carries a one-time token; the account must match the invited email. A guest
 * sees only the board they were invited to, so after acceptance the app follows the
 * board id if the invitation has one (spec/IAM-v1.md §9).
 */
export function InviteDialog({
  token,
  signedIn,
  onSignIn,
  onDone,
}: {
  token: string;
  signedIn: boolean;
  /** Opens the sign-in dialog for a visitor who has no session yet. */
  onSignIn: () => void;
  onDone: (target: { orgId: string; boardId: string | null }) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    setError(null);
    setAccepted(false);
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptInvitation(token);
      setAccepted(true);
      onDone(result);
    } catch (failure) {
      const code = (failure as { code?: string }).code ?? "";
      setError(
        code === "EMAIL_MISMATCH"
          ? t("invite.wrongAccount")
          : code === "INVITATION_EXPIRED" || code === "INVITATION_INVALID"
            ? t("invite.gone")
            : t("invite.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("invite.title")} description={t("invite.body")} size="sm">
      <section className="dialog-stack">
        {error && <p className="auth-error">{error}</p>}
        {accepted && <p className="muted">{t("invite.accepted")}</p>}
        <div className="auth-actions">
          {signedIn ? (
            <Button variant="primary" disabled={busy || accepted} onClick={() => void accept()}>
              {busy ? t("auth.working") : t("invite.accept")}
            </Button>
          ) : (
            <Button variant="primary" onClick={onSignIn}>
              {t("invite.signInFirst")}
            </Button>
          )}
        </div>
      </section>
    </Dialog>
  );
}
