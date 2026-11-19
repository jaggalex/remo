/**
 * Comments changed signal (ADR-104 amendment).
 *
 * Comments are server rows, so a peer cannot learn about a new one from the Yjs
 * document. The board socket carries one extra frame instead:
 *
 *   [11]
 *
 * It has no payload on purpose: the panel reloads the list, and the server decides who
 * is in the room. A missed frame is recovered by the reload on reconnect, so the
 * signal can stay a nudge rather than a second source of truth.
 */
export const COMMENTS_CHANGED_MESSAGE = 11;

export function encodeCommentsChanged(): Uint8Array {
  return new Uint8Array([COMMENTS_CHANGED_MESSAGE]);
}

export function isCommentsChanged(bytes: Uint8Array): boolean {
  return bytes.length >= 1 && bytes[0] === COMMENTS_CHANGED_MESSAGE;
}
