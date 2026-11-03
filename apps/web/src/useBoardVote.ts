import { useCallback, useState } from "react";
import type { BoardConnection } from "@remo/doc";
import { api } from "./api";
import { useVoteSessions } from "./useVoteSessions";

/**
 * The board's vote state and the two actions the canvas needs (ADR-115).
 *
 * App owns the hook once; the layer on the canvas, the bar and the panel all read the
 * same session, so a count can never differ between them.
 */
export function useBoardVote({
  boardId,
  connection,
  t,
}: {
  boardId: string;
  connection: BoardConnection | null;
  t: (key: "facilitation.vote.failed") => string;
}) {
  const vote = useVoteSessions({ boardId, connection, t });
  const [open, setOpen] = useState(false);

  const cast = useCallback(
    (objectId: string) => {
      const session = vote.active;
      if (session) void vote.run(() => api.castVote(session.id, objectId));
    },
    [vote],
  );

  const withdraw = useCallback(
    (objectId: string) => {
      const session = vote.active;
      if (session) void vote.run(() => api.withdrawVote(session.id, objectId));
    },
    [vote],
  );

  return { vote, open, setOpen, cast, withdraw };
}
