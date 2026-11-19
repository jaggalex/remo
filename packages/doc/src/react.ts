import { useCallback, useSyncExternalStore } from "react";
import type { BoardDocument, BoardSnapshot } from "./board";

/** React binding for the shared document: renders snapshots, never local copies. */
export function useBoard(board: BoardDocument): BoardSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => board.subscribe(listener),
    [board],
  );
  const snapshot = useCallback(() => board.snapshot(), [board]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
