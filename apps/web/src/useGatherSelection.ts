import { useCallback } from "react";
import { gatherIntoSection } from "@remo/doc";
import { newId } from "@remo/model";
import type { BoardDocument } from "@remo/doc";

/**
 * The arrange bar's "Gather into section" action (ADR-198).
 *
 * `BoardApp` was at the size limit when the action arrived; the command's one-shot
 * callback lives here, with the title and the notice passed in by the app.
 */
export function useGatherSelection({
  board,
  setSelectedIds,
  notice,
  title,
  emptyMessage,
  skippedMessage,
}: {
  board: BoardDocument;
  setSelectedIds: (ids: string[]) => void;
  notice: (message: string) => void;
  title: string;
  emptyMessage: string;
  skippedMessage: (count: number) => string;
}) {
  return useCallback(
    (ids: readonly string[]) => {
      const result = gatherIntoSection(board, ids, { id: newId("frame"), title });
      if (!result.frameId) {
        notice(emptyMessage);
        return;
      }
      setSelectedIds([result.frameId]);
      if (result.skipped.length) notice(skippedMessage(result.skipped.length));
    },
    [board, emptyMessage, notice, setSelectedIds, skippedMessage, title],
  );
}
