import { useCallback, useState } from "react";
import type { BoardDocument } from "@remo/doc";

/**
 * Undo and redo for the rail (ADR-119).
 *
 * The document owns the stacks; this hook only makes React repaint, because a rail
 * button is outside the canvas that observes the document.
 */
export function useBoardHistory(board: BoardDocument) {
  const [, forceRender] = useState(0);
  const undo = useCallback(() => {
    board.undoOnce();
    forceRender((n) => n + 1);
  }, [board]);
  const redo = useCallback(() => {
    board.redoOnce();
    forceRender((n) => n + 1);
  }, [board]);
  return { undo, redo, forceRender };
}
