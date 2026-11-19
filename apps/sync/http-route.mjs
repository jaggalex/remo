/**
 * A bounded label for the HTTP request counter.
 *
 * The path is caller-controlled. A label per path lets an anonymous client grow the
 * in-memory metrics registry without bound, and protecting `/metrics` does not stop the
 * accumulation. Map each request to one of a fixed set of families; anything else is
 * `other`.
 */
const ROUTE_FAMILIES = new Set([
  "agent",
  "agent-tasks",
  "apps",
  "auth",
  "boards",
  "health",
  "integrations",
  "invitations",
  "metrics",
  "orgs",
  "search",
  "users",
  "vote-sessions",
  "webhooks",
]);

/** The second segments `/auth` serves. Anything else is a caller's string, not a route. */
const AUTH_ROUTES = new Set([
  "login",
  "logout",
  "me",
  "password",
  "preferences",
  "register",
  "sessions",
]);

export function routeLabel(pathname) {
  const parts = String(pathname).split("/").filter(Boolean);
  if (!parts.length) return "/";
  const [family, second] = parts;
  if (!ROUTE_FAMILIES.has(family)) return "other";
  // A board id is the only variable segment a route needs; its sub-route is not worth
  // a series of its own.
  if (family === "boards") return parts.length === 1 ? "/boards" : "/boards/:id";
  // `/auth/...` has a small fixed second segment; keep it so sign-in and sign-up are
  // distinguishable.
  if (family === "auth") {
    if (!second) return "/auth";
    return AUTH_ROUTES.has(second) ? `/auth/${second}` : "/auth/other";
  }
  return `/${family}`;
}
