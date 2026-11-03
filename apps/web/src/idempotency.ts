/**
 * A request key for a write that must survive a retry (ADR-155).
 *
 * The server stores the key and replays the first result, so a lost response does not
 * become a second task or change set.
 */
export function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
