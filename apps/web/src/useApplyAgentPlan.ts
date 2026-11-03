import { useCallback } from "react";
import {
  applyAgentPlan,
  type AgentPlan,
  type AppliedAgentPlan,
  type BoardDocument,
} from "@remo/doc";
import type { Widget } from "@remo/model";

/**
 * The client half of ADR-142, kept out of `App` because that file is at the size
 * ceiling: validate, preflight, one local transaction, then select what appeared.
 *
 * The transaction is the document's, so ⌘Z removes the whole structure in one step and
 * a remote peer receives an ordinary local update.
 */
export function useApplyAgentPlan({
  board,
  author,
  setSelectedIds,
}: {
  board: BoardDocument;
  author: string;
  setSelectedIds: (ids: string[]) => void;
}) {
  return useCallback(
    (
      plan: AgentPlan,
      provenance: Widget["agent"],
      options?: { allowedIds?: string[] },
    ): AppliedAgentPlan => {
      const applied = applyAgentPlan(board, plan, {
        approved: true,
        author,
        provenance,
        ...(options?.allowedIds ? { allowedIds: options.allowedIds } : {}),
      });
      // A structure is a frame (or a header plus lanes); selecting it shows the result
      // the person just accepted. A tidy selects what moved and the blocks it created.
      const frames = applied.objectIds.filter((id) => board.widgets.get(id)?.type === "frame");
      const tidied = [...new Set([...applied.movedIds, ...frames])];
      setSelectedIds(tidied.length ? tidied : applied.objectIds);
      return applied;
    },
    [board, author, setSelectedIds],
  );
}
