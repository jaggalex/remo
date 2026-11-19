import { frameBoxHolding } from "@remo/model";
import type { BoardDocument } from "./board";

/**
 * Grow the frames around a member that got bigger (ADR-243), in the caller's
 * transaction. Walks up the parents: a frame that grows is a member that grew. Stops at
 * the first parent that is not a frame, and does not grow a locked frame or a table
 * section's stored box. Membership is not touched: this changes geometry only.
 */
export function growFramesAround(board: BoardDocument, id: string): void {
  let child = board.readWidget(id);
  const seen = new Set<string>();
  while (child?.parentId && !seen.has(child.parentId)) {
    seen.add(child.parentId);
    const parent = board.readWidget(child.parentId);
    if (!parent || parent.type !== "frame") return;
    if (parent.locked || parent.layout?.kind === "table") return;
    const box = frameBoxHolding(parent, child);
    if (box === parent) return;
    const grown = { ...parent, ...box };
    board.widgets.set(parent.id, grown);
    child = grown;
  }
}
