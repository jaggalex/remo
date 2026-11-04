/**
 * The organisation filter of the board directory (ADR-166).
 *
 * This is navigation, not access: it decides which boards the directory lists and in
 * which organisation a new board starts. The board still decides what a person may do.
 * `null` means every organisation the person can see.
 */
const KEY = "remo.activeOrg";

export function loadActiveOrg(): string | null {
  try {
    return window.localStorage.getItem(KEY) || null;
  } catch {
    // Private mode: the filter simply does not survive a reload.
    return null;
  }
}

export function saveActiveOrg(orgId: string | null): void {
  try {
    if (orgId) window.localStorage.setItem(KEY, orgId);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode — see loadActiveOrg */
  }
}
