import { useState } from "react";
import { Banner } from "@remo/ui";
import { ApiError } from "./apiCall";
import { resendVerification } from "./apiMail";
import { useI18n } from "./i18n";

/**
 * What an invitation creation says about mail (ADR-246, `spec/mail.md` §7).
 *
 * The link stays usable and copyable in both cases: a letter that was not queued, or a
 * confirmed-address requirement, changes what the inviter is told, not the invitation.
 */
export function InviteSent({ email }: { email: string }) {
  const { t } = useI18n();
  return <p className="share-caption">{t("mail.inviteSent", { email })}</p>;
}

/**
 * The server refuses to send invitations in the name of an unconfirmed address.
 * The fix is the same letter registration sends, so this offers exactly that.
 */
export function EmailVerificationNeeded() {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "already" | "rate" | "error">("idle");

  const resend = async () => {
    setState("sending");
    try {
      const result = await resendVerification();
      setState(result.alreadyVerified ? "already" : "sent");
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setState(code === "RATE_LIMITED" ? "rate" : "error");
    }
  };

  return (
    <>
      <Banner
        tone="warning"
        title={t("mail.inviteNeedsVerified")}
        action={{ label: t("mail.resend"), onClick: () => void resend() }}
      />
      {state === "sent" && <p className="share-caption">{t("mail.resendSent")}</p>}
      {state === "already" && <p className="share-caption">{t("mail.resendAlready")}</p>}
      {state === "rate" && <p className="auth-error">{t("mail.resendRateLimited")}</p>}
      {state === "error" && <p className="auth-error">{t("mail.resendFailed")}</p>}
    </>
  );
}
