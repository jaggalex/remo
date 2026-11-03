import type { Camera } from "@remo/canvas";
import type { Presence } from "@remo/doc";

/**
 * Follow is attention, not board state (ADR-076, ADR-151).
 *
 * The target is a **session**, not a name: two windows of one account have separate
 * cameras, and the follower chooses which one to mirror. The state machine lives here,
 * away from the socket and from React, so the rules the product promises — a local pan
 * pauses, both sides can stop, a disconnect ends it — are unit-tested instead of being
 * implied by event handlers.
 */
export interface FollowState {
  /** Session key of the person being followed, or null. */
  target: string | null;
  /** The label to say in the pill and in notices. */
  targetLabel: string | null;
  /** A local pan or zoom paused the mirror; the pill offers Resume. */
  paused: boolean;
}

export const NO_FOLLOW: FollowState = { target: null, targetLabel: null, paused: false };

export type FollowEvent =
  | { type: "follow"; target: string; label: string }
  | { type: "unfollow" }
  | { type: "localMove" }
  | { type: "resume" }
  | { type: "stoppedByTarget" }
  | { type: "targetLeft" };

export function followReducer(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case "follow":
      return { target: event.target, targetLabel: event.label, paused: false };
    case "unfollow":
    case "stoppedByTarget":
    case "targetLeft":
      return NO_FOLLOW;
    case "localMove":
      return state.target ? { ...state, paused: true } : state;
    case "resume":
      return state.target ? { ...state, paused: false } : state;
    default:
      return state;
  }
}

/** How many people currently mirror this session, as everyone can see (ADR-076). */
export function followerCount(presence: readonly Presence[], sessionKey: string): number {
  return presence.filter((peer) => !peer.self && peer.followTo === sessionKey).length;
}

/**
 * The camera to mirror right now, or null.
 *
 * A paused follow returns nothing: the viewport stays where the person left it, which
 * is what "following paused" must mean.
 */
export function remoteCamera(
  presence: readonly Presence[],
  follow: FollowState,
): Camera | null {
  if (!follow.target || follow.paused) return null;
  const peer = presence.find(
    (candidate) => !candidate.self && candidate.sessionKey === follow.target,
  );
  return peer?.camera ?? null;
}

/** A "bring everyone" request newer than the one we already answered. */
export function pendingInvite(
  presence: readonly Presence[],
  seenAt: number,
  now = Date.now(),
): { from: string; name?: string; at: number } | null {
  for (const peer of presence) {
    if (peer.self || !peer.invite) continue;
    if (peer.invite.at > seenAt && now - peer.invite.at < 30_000) return peer.invite;
  }
  return null;
}

/** The board setting that turns a bring-everyone request into an immediate follow. */
export function autoFollow(setting: string | boolean | null | undefined): boolean {
  return setting === true || setting === "1" || setting === "true";
}
