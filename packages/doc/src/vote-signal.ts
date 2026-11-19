/**
 * Votes changed signal (ADR-115).
 *
 * A vote is a server row, so a peer cannot learn about it from the Yjs document. The
 * board socket carries one extra frame instead:
 *
 *   [12]
 *
 * It has no payload on purpose: the vote layer and the panel reload the session, and
 * the server decides who is in the room. A missed frame is recovered by the reload on
 * reconnect and by the slow poll, so the signal stays a nudge, not a second source of
 * truth.
 */
export const VOTES_CHANGED_MESSAGE = 12;

export function encodeVotesChanged(): Uint8Array {
  return new Uint8Array([VOTES_CHANGED_MESSAGE]);
}

export function isVotesChanged(bytes: Uint8Array): boolean {
  return bytes.length >= 1 && bytes[0] === VOTES_CHANGED_MESSAGE;
}
