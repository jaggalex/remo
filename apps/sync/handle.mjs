/**
 * The public handle rules (ADR-164).
 *
 * A handle is the mentionable identity: lower-case, 3–32 characters, letters, digits,
 * `_`, `-` and `.`, and it must start and end with a letter or digit. Parentheses,
 * spaces and control characters are not in the alphabet; they are rejected rather than
 * silently removed from a handle a person typed.
 */
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 32;
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;
const RESERVED = new Set(["admin", "support", "remo", "system", "everyone", "here"]);

/** The stored form: trimmed and lower-case. */
export function normalizeHandle(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

/** A problem with a caller-supplied handle, or null. */
export function handleProblem(raw) {
  const handle = normalizeHandle(raw);
  if (handle.length < HANDLE_MIN) {
    return { code: "HANDLE_TOO_SHORT", message: `the handle needs at least ${HANDLE_MIN} characters` };
  }
  if (handle.length > HANDLE_MAX) {
    return { code: "HANDLE_TOO_LONG", message: `the handle may have at most ${HANDLE_MAX} characters` };
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return {
      code: "BAD_HANDLE",
      message: "use letters, digits, dot, dash or underscore; start and end with a letter or digit",
    };
  }
  if (RESERVED.has(handle)) {
    return { code: "HANDLE_RESERVED", message: "this handle is reserved" };
  }
  return null;
}

/** A stable, valid base derived from an email when registration omits a handle. */
export function deriveHandle(email) {
  let handle = String(email ?? "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, HANDLE_MAX);
  if (handle.length < HANDLE_MIN) handle = `${handle}user`.slice(0, HANDLE_MAX);
  if (!HANDLE_PATTERN.test(handle)) handle = "user";
  return handle;
}

/** The n-th candidate after a collision; still inside the handle alphabet. */
export function handleCandidate(base, attempt) {
  const suffix = String(attempt);
  const trimmed = base.slice(0, HANDLE_MAX - suffix.length).replace(/[^a-z0-9]+$/g, "");
  return `${trimmed || "user"}${suffix}`;
}
