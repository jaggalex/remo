import { useEffect, useRef, useState } from "react";
import { Banner } from "@remo/ui";
import type { SessionUser } from "./api";
import { ApiError } from "./apiCall";
import { authCapabilities, verifyEmail } from "./apiMail";
import { ForgotPasswordDialog } from "./ForgotPasswordDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { clearMailParams, stripMailTokens, type MailLinks } from "./mailLinks";
import { useI18n } from "./i18n";

type Verification = "idle" | "pending" | "ok" | "invalid" | "expired" | "changed" | "failed";

const BANNER_PREFIX = "remo.verifyBanner.";

function bannerKey(userId: string) {
  return `${BANNER_PREFIX}${userId}`;
}

/** The banner is hidden for this browser session only; a new sign-in shows it again. */
function bannerHidden(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(bannerKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** Called after a successful sign-in: the reminder belongs to the session that starts now. */
export function resetVerificationBanner(userId: string) {
  try {
    window.sessionStorage.removeItem(bannerKey(userId));
  } catch {
    // Private mode keeps it visible, which is the harmless direction.
  }
}

/**
 * The home-side halves of the mail flow (ADR-246, `spec/mail.md` §7).
 *
 * A confirmation link works with or without a session, so it is answered here, above the
 * sign-in gate. The unverified-address banner lives here and only here: the board is for
 * work and has no room for it.
 */
export function HomeMail({
  me,
  links,
  forgotOpen,
  onForgotClose,
  onNeedLink,
  onVerified,
  onOpenLogin,
}: {
  me: SessionUser | null;
  links: MailLinks;
  forgotOpen: boolean;
  onForgotClose: () => void;
  onNeedLink: () => void;
  onVerified: () => void;
  onOpenLogin: (notice: string) => void;
}) {
  const { t } = useI18n();
  const [verification, setVerification] = useState<Verification>(links.verifyToken ? "pending" : "idle");
  const [mailEnabled, setMailEnabled] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const [resetToken, setResetToken] = useState(links.resetToken);
  const verifyStarted = useRef(false);
  const verifiedRef = useRef(onVerified);
  verifiedRef.current = onVerified;

  // The dialogs already hold their copies; the address must not keep the secret.
  useEffect(() => {
    stripMailTokens();
  }, []);

  useEffect(() => {
    const token = links.verifyToken;
    if (!token || verifyStarted.current) return;
    verifyStarted.current = true;
    verifyEmail(token)
      .then(() => {
        setVerification("ok");
        verifiedRef.current();
      })
      .catch((failure: unknown) => {
        const code = failure instanceof ApiError ? failure.code : "";
        setVerification(
          code === "TOKEN_EXPIRED"
            ? "expired"
            : code === "TOKEN_INVALID"
              ? "invalid"
              : code === "EMAIL_CHANGED"
                ? "changed"
                : "failed",
        );
      });
  }, [links.verifyToken]);

  // "Confirm your email" is worth a banner only while the installation can send one.
  useEffect(() => {
    if (me?.emailVerified !== false) {
      setMailEnabled(null);
      return;
    }
    let alive = true;
    authCapabilities()
      .then((result) => {
        if (alive) setMailEnabled(result.mail);
      })
      .catch(() => {
        if (alive) setMailEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [me?.emailVerified]);

  const meId = me?.id;
  useEffect(() => {
    setHidden(meId ? bannerHidden(meId) : false);
  }, [meId]);

  const verifyText =
    verification === "ok"
      ? t("mail.verifyOk")
      : verification === "expired"
        ? t("mail.verifyExpired")
        : verification === "invalid"
          ? t("mail.verifyInvalid")
          : verification === "changed"
            ? t("mail.verifyChanged")
            : t("mail.verifyFailed");

  const showBanner = verification === "ok" || verification === "invalid" || verification === "expired" || verification === "changed" || verification === "failed";
  /** The account the reminder belongs to; null when there is nothing to remind. */
  const remindUserId = me?.emailVerified === false ? me.id : null;

  return (
    <>
      {(showBanner || (remindUserId && mailEnabled && !hidden)) && (
        <div className="home-mail">
          {showBanner && (
            <Banner
              tone={verification === "ok" ? "success" : "danger"}
              onClose={() => setVerification("idle")}
            >
              {verifyText}
            </Banner>
          )}
          {!showBanner && remindUserId && mailEnabled && !hidden && (
            <Banner
              tone="warning"
              title={t("mail.verifyTitle")}
              onClose={() => {
                setHidden(true);
                try {
                  window.sessionStorage.setItem(bannerKey(remindUserId), "1");
                } catch {
                  // The banner returns on the next load; nothing breaks.
                }
              }}
            >
              {t("mail.verifyBody")}
            </Banner>
          )}
        </div>
      )}

      <ForgotPasswordDialog open={forgotOpen} onClose={onForgotClose} />

      {resetToken && (
        <ResetPasswordDialog
          token={resetToken}
          onClose={() => {
            setResetToken(null);
            clearMailParams();
          }}
          onNeedLink={() => {
            setResetToken(null);
            onNeedLink();
          }}
          onDone={() => {
            setResetToken(null);
            clearMailParams();
            onOpenLogin(t("mail.resetDone"));
          }}
        />
      )}
    </>
  );
}
