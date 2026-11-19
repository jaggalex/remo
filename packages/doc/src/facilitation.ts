import type { BoardDocument } from "./board";
import { LOCAL_ORIGIN } from "./origins";

/**
 * The one facilitation setting that is board state (ADR-076).
 *
 * Follow itself never touches the document. "Bring everyone" is a request; a workshop
 * that has agreed may make it immediate, and that agreement is what this flag records.
 */
export function setAllowBringEveryone(board: BoardDocument, enabled: boolean): void {
  board.transact(() => {
    if (enabled) board.meta.set("allow_bring_everyone", "1");
    else board.meta.delete("allow_bring_everyone");
  }, LOCAL_ORIGIN);
}
