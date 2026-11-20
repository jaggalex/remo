import { useSyncExternalStore } from "react";
import type { Access, OrgSummary } from "./api";

/**
 * The server's access answer, readable from the canvas leaves.
 *
 * `useBoardAccess` makes the decision once per room; the canvas needs one bit of it —
 * may this person take an original file — and the object bar sits three levels below the
 * props that carry `canExport`, because `BoardApp` is at the size ratchet and does not
 * grow for one button (ADR-093, ADR-134). This is a projection of that one answer, not a
 * second request and not a second rule: nothing here decides access, it only repeats what
 * `effective()` said.
 */

interface Snapshot {
  room: string | null;
  allowed: boolean;
  capabilities: readonly string[];
  /** The slug of the board's organisation, for a link to the plans screen. */
  orgSlug: string | null;
}

const EMPTY: Snapshot = { room: null, allowed: false, capabilities: [], orgSlug: null };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function same(a: Snapshot, b: Snapshot): boolean {
  return (
    a.room === b.room &&
    a.allowed === b.allowed &&
    a.orgSlug === b.orgSlug &&
    a.capabilities.length === b.capabilities.length &&
    a.capabilities.every((value, index) => value === b.capabilities[index])
  );
}

/** Called by `useBoardAccess` whenever the boarded room's answer changes. */
export function publishAccess(
  room: string,
  access: Access | null,
  orgs: readonly OrgSummary[],
  boardOrgId: string | undefined,
): void {
  const next: Snapshot = {
    room,
    allowed: access?.allowed === true,
    capabilities: access?.capabilities ?? [],
    orgSlug: orgs.find((org) => org.id === boardOrgId)?.slug ?? null,
  };
  if (same(next, snapshot)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * May this person edit the open room, as of the last published answer?
 *
 * For a non-React path that has to decide before it starts work: a paste of a picture is
 * an upload, and an upload without `board.edit` is a refused request, not a card.
 */
export function canEditNow(): boolean {
  return snapshot.capabilities.includes("board.edit");
}

/** Does this person hold `capability` on the open room? */
export function useBoardCapability(capability: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.capabilities.includes(capability),
    () => false,
  );
}

/**
 * Where "See plans" goes: the organisation screen on its plan tab.
 *
 * A board has no billing tab of its own — plans are bought by the organisation — so the
 * banner links to the screen that has one. The slug is optional: the organisation home
 * falls back to the active organisation when the address names none.
 */
export function plansUrl(): string {
  const slug = snapshot.orgSlug;
  const query = slug ? `?org=${encodeURIComponent(slug)}&billing=1` : "?billing=1";
  return `/${query}`;
}
