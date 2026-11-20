/**
 * EN strings — the mail-backed account flows (ADR-246, `spec/mail.md` §7).
 *
 * Split from the sign-in table because these strings only exist when the server can send
 * mail; the keys are still one flat namespace (ADR-093).
 */
export const enMail = {
  "auth.forgot": "Forgot your password?",
  "auth.adminReset": "Only the server administrator can reset your password.",
  "mail.forgotTitle": "Reset your password",
  "mail.forgotBody": "Enter the email address of the account. We will send a link for a new password.",
  "mail.sendLink": "Send the link",
  "mail.close": "Close",
  "mail.savePassword": "Save password",
  "mail.sent": "If an account with this address exists, we sent a letter with a link. Check the Spam folder too.",
  "mail.networkError": "No connection to the server. Check your connection and try again.",
  "mail.rateLimited": "Too many attempts. Try again later.",
  "mail.resetTitle": "New password",
  "mail.resetBody": "Choose a new password for the account.",
  "mail.newPassword": "New password",
  "mail.show": "Show",
  "mail.hide": "Hide",
  "mail.resetDone": "Password changed. Sign in with the new password",
  "mail.tokenInvalid": "This link is not valid: it was already used or does not exist.",
  "mail.tokenExpired": "This link has expired.",
  "mail.requestNewLink": "Request a new link",
  "mail.verifyOk": "Email confirmed",
  "mail.verifyInvalid": "This confirmation link is not valid.",
  "mail.verifyExpired": "This confirmation link has expired.",
  "mail.verifyChanged": "The address on this link is no longer yours.",
  "mail.verifyFailed": "Could not confirm the email. Try again.",
  "mail.verifyTitle": "Confirm your email",
  "mail.verifyBody": "A confirmed address lets you invite people and receive letters about the account.",
  "mail.resend": "Send the letter again",
  "mail.resendSent": "The letter is sent. Check your inbox.",
  "mail.resendAlready": "The email is already confirmed.",
  "mail.resendRateLimited": "Letters are sent at most three times an hour. Try again later.",
  "mail.resendFailed": "Could not send the letter. Try again.",
  "mail.inviteSent": "Invitation sent to {email}",
  "mail.inviteNeedsVerified": "Confirm your email to invite people",
};
