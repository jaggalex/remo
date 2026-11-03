import type { Widget } from "./types";

/**
 * Who may release a lock (ADR-107).
 *
 * The author keeps control of their own object; a board manager is the escape hatch
 * for a person who left or a lock that blocks the team. A lock written before the
 * author was recorded has no `lockedBy`: it stays releasable by any editor until it is
 * toggled once, which is the only migration and is visible in the UI.
 *
 * This is coordination, not access control: a raw document client with write access
 * can still clear the flag. Every surface that promises otherwise is wrong.
 */
export function canUnlock(
  widget: Pick<Widget, "locked" | "lockedBy">,
  actorId: string | null | undefined,
  canManage: boolean,
): boolean {
  if (!widget.locked) return true;
  if (!widget.lockedBy) return true;
  if (canManage) return true;
  return Boolean(actorId) && widget.lockedBy === actorId;
}

/** The name to show when a refusal has to explain the lock. */
export function lockAuthorName(
  widget: Pick<Widget, "lockedBy" | "lockedByName">,
): string | null {
  if (!widget.lockedBy) return null;
  return widget.lockedByName?.trim() || widget.lockedBy;
}
