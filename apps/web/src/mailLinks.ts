/**
 * The three mail links that arrive from a letter (ADR-246, `spec/mail.md` §7).
 *
 * `?reset=` and `?verify=` carry one-time secrets, so the app reads them once and removes
 * them from the address before any request can put them in history or a `Referer`.
 * `?forgot=1` is not a secret; it only opens the form and is cleared with the rest when
 * the flow is finished.
 */
export interface MailLinks {
  forgot: boolean;
  resetToken: string | null;
  verifyToken: string | null;
}

/** Read once per page load: StrictMode renders the App twice, the token appears once. */
let cached: MailLinks | null = null;

export function readMailLinks(): MailLinks {
  if (cached) return cached;
  const params = new URLSearchParams(window.location.search);
  cached = {
    forgot: params.get("forgot") === "1",
    resetToken: params.get("reset") || null,
    verifyToken: params.get("verify") || null,
  };
  return cached;
}

function rewrite(change: (params: URLSearchParams) => void) {
  const url = new URL(window.location.href);
  change(url.searchParams);
  window.history.replaceState(null, "", url);
}

/** Drop the two secret tokens immediately; the dialogs already hold their copies. */
export function stripMailTokens() {
  const links = readMailLinks();
  if (!links.resetToken && !links.verifyToken) return;
  rewrite((params) => {
    params.delete("reset");
    params.delete("verify");
  });
}

/** The address names the form while it is open, like `?invite=` names its dialog. */
export function showForgot() {
  const links = readMailLinks();
  links.forgot = true;
  rewrite((params) => params.set("forgot", "1"));
}

/** A finished or dismissed flow leaves no mail parameters behind. */
export function clearMailParams() {
  const links = readMailLinks();
  links.forgot = false;
  links.resetToken = null;
  links.verifyToken = null;
  rewrite((params) => {
    params.delete("forgot");
    params.delete("reset");
    params.delete("verify");
  });
}
