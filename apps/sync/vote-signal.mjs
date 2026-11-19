/**
 * Votes changed frames (ADR-115).
 *
 * Mirrors `packages/doc/src/vote-signal.ts`: one empty frame of type 12 tells the peers
 * in a room to reload the voting session. There is no payload because votes are not
 * document state and the socket is only a nudge, not a transport for them.
 */
export const VOTES_CHANGED_MESSAGE = 12;

export function encodeVotesChanged() {
  return new Uint8Array([VOTES_CHANGED_MESSAGE]);
}
