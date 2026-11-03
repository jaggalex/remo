/**
 * Comments changed frames (ADR-104 amendment).
 *
 * Mirrors `packages/doc/src/comment-signal.ts`: one empty frame of type 11 tells the
 * peers in a room to reload the discussion. There is no payload because comments are
 * not document state and the socket is only a nudge, not a transport for them.
 */
export const COMMENTS_CHANGED_MESSAGE = 11;

export function encodeCommentsChanged() {
  return new Uint8Array([COMMENTS_CHANGED_MESSAGE]);
}
