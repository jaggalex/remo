import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardConnection } from "@remo/doc";
import { api, type VoteSession } from "./api";

/**
 * One voting session per board, read by both the board and the panel (ADR-115).
 *
 * The session is a server record, so two surfaces need the same copy: the vote layer
 * draws counts on the objects, the panel manages the session. One hook owns the fetch,
 * the socket nudge and the slow poll, instead of each surface asking on its own.
 *
 * A nudge arrives over the board socket (`onVotesChanged`); the poll is the fallback
 * for a missed frame and for a session that ends by its own timer.
 */
export interface VoteController {
  boardId: string;
  sessions: VoteSession[];
  /** The open session, or the most recent one when nothing is running. */
  active: VoteSession | null;
  running: boolean;
  busy: boolean;
  error: string | null;
  /** Server clock minus local clock, so a countdown does not depend on the device. */
  offset: number;
  load: () => Promise<void>;
  /** Run one server action and reload the session; one busy flag for every control. */
  run: (action: () => Promise<unknown>) => Promise<void>;
}

export function useVoteSessions({
  boardId,
  connection,
  t,
}: {
  boardId: string;
  connection: BoardConnection | null;
  t: (key: "facilitation.vote.failed") => string;
}): VoteController {
  const [sessions, setSessions] = useState<VoteSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const active = useMemo(
    () => sessions.find((session) => session.state === "open") ?? sessions[0] ?? null,
    [sessions],
  );
  const running = active?.state === "open";

  const load = useCallback(async () => {
    try {
      const result = await api.boardVoteSessions(boardId);
      setSessions(result.sessions);
      const first = result.sessions[0];
      if (first) setOffset(new Date(first.serverNow).getTime() - Date.now());
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("facilitation.vote.failed"));
    }
  }, [boardId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A vote is not a document change, so the room gets a nudge instead (ADR-115).
  useEffect(() => {
    if (!connection) return;
    return connection.onVotesChanged(() => void load());
  }, [connection, load]);

  // The fallback: a missed frame, or a session that ended by its own timer.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 4000);
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [running, load]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await load();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("facilitation.vote.failed"));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  return { boardId, sessions, active, running, busy, error, offset, load, run };
}
