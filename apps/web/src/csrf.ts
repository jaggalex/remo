/**
 * The CSRF token a mutation has to echo (ADR-062).
 *
 * The server sets `remo_csrf` on the first response. It is readable here and not by
 * another origin, so sending it back proves the request came from this page rather
 * than from a site riding the session cookie.
 */
export function csrfToken(): string | null {
  const match = /(?:^|;\s*)remo_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
