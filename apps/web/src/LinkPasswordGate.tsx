import { useState } from "react";
import { api, ApiError } from "./api";
import { useI18n } from "./i18n";

/**
 * The password gate for a public link (ADR-069).
 *
 * The check is server-side; this form only carries the attempt. A wrong password says
 * exactly that — it never claims the password changed unless the version moved, because
 * that message would be false on the first wrong attempt of a new password.
 */
export function LinkPasswordGate({
  boardId,
  onUnlocked,
}: {
  boardId: string;
  onUnlocked: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="link-gate"
      onSubmit={(event) => {
        event.preventDefault();
        if (!password) return;
        setBusy(true);
        setError(null);
        api
          .unlockLink(boardId, password)
          .then(() => onUnlocked())
          .catch((failure) => {
            const code = failure instanceof ApiError ? failure.code : "";
            setError(
              code === "WRONG_PASSWORD"
                ? t("iam.wrongLinkPassword")
                : code === "LINK_EXPIRED"
                  ? t("iam.linkExpired")
                  : failure instanceof Error
                    ? failure.message
                    : t("iam.unlockFailed"),
            );
            setBusy(false);
          });
      }}
    >
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder={t("iam.linkPasswordPlaceholder")}
        aria-label={t("iam.linkPassword")}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" className="primary-button" disabled={busy || !password}>
        {t("iam.unlock")}
      </button>
      {error && <p className="auth-error">{error}</p>}
    </form>
  );
}
