import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Access, type OrgSummary, type SessionUser } from "./api";
import { currentRoom } from "./identity";

/**
 * Who is signed in, and what this viewer may do with this board.
 *
 * One hook, one source: the server's `effective()` result is stored as-is, and every
 * capability in the UI is a read of that answer, not a local guess. The invitation token
 * is read once from the address (ADR-064/081).
 */
export function useBoardAccess(room: string | null = currentRoom()) {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  /** The organisation this board belongs to; a legacy room has none. */
  const [boardOrgId, setBoardOrgId] = useState<string | undefined>(undefined);
  /** The board's server-side name, kept when a template seeds a new board. */
  const [boardTitle, setBoardTitle] = useState<string | undefined>(undefined);
  /** A one-time invitation token from the URL. */
  const inviteToken = useMemo(
    () => new URLSearchParams(window.location.search).get("invite"),
    [],
  );
  const [inviteDone, setInviteDone] = useState(false);

  // A failure is not an error state: most visitors of a legacy room are anonymous.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((result) => {
        if (!alive) return;
        setMe(result.user);
        setOrgs(result.orgs);
        setSessionReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setMe(null);
        setOrgs([]);
        setSessionReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Re-read the organisation list after creating or renaming one (ADR-166). */
  const refreshOrgs = useCallback(async () => {
    try {
      const result = await api.me();
      setOrgs(result.orgs);
    } catch {
      // The next full sign-in or reload will try again; the current list stays usable.
    }
  }, []);

  /** Guards against a slow answer overwriting a newer access decision. */
  const accessSeq = useRef(0);
  const retryAccess = useRef<number | null>(null);

  /** What this viewer may do with this board, straight from the server. */
  const refreshAccess = useCallback(async () => {
    if (!room) {
      setAccess(null);
      setBoardOrgId(undefined);
      return;
    }
    const seq = ++accessSeq.current;
    try {
      const result = await api.access(room);
      if (seq !== accessSeq.current) return;
      if (retryAccess.current) {
        window.clearTimeout(retryAccess.current);
        retryAccess.current = null;
      }
      setAccess(result.access);
      setBoardOrgId(result.board?.orgId);
      setBoardTitle(result.board?.title);
    } catch (failure) {
      if (seq !== accessSeq.current) return;
      const status = failure instanceof ApiError ? failure.status : 0;
      const code = failure instanceof ApiError ? failure.code : "";
      // A network failure or a 5xx is not a decision. Keep the last one and retry;
      // showing "no access" would close the gate on a restarting server.
      if (status === 0 || status >= 500) {
        if (retryAccess.current) window.clearTimeout(retryAccess.current);
        retryAccess.current = window.setTimeout(() => void refreshAccess(), 2_000);
        return;
      }
      setAccess({
        allowed: false,
        role: null,
        capabilities: [],
        sources: [],
        reason:
          code === "PASSWORD_REQUIRED"
            ? "PASSWORD_REQUIRED"
            : code === "LINK_INACTIVE"
              ? "LINK_INACTIVE"
              : status === 401
                ? "AUTH_REQUIRED"
                : "NOT_FOUND",
      });
    }
  }, [room]);

  useEffect(
    () => () => {
      if (retryAccess.current) window.clearTimeout(retryAccess.current);
    },
    [],
  );

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess, me?.id]);

  const canShare = Boolean(access?.capabilities.includes("board.share"));
  const canExport = Boolean(access?.capabilities.includes("board.export"));
  const canBackup = Boolean(access?.capabilities.includes("board.backup"));
  // Import replaces the document and the discussion, so it is a management action; taking
  // a backup is not (ADR-161).
  const canImport = Boolean(access?.capabilities.includes("board.manage"));
  // AI is for an account that may edit. A public link is view-only: it has no account
  // behind the decision for an agent to act on behalf of (ADR-066, AG-12).
  const linkOnly = access?.sources?.length === 1 && access.sources[0] === "link";
  const canAskAgents = Boolean(
    me && boardOrgId && access?.allowed && !linkOnly && access.capabilities.includes("board.edit"),
  );
  const canFacilitate = Boolean(access?.capabilities.includes("board.facilitate"));
  const canManage = Boolean(access?.capabilities.includes("board.manage"));
  const canTransfer = Boolean(access?.capabilities.includes("board.transfer"));
  const denied = Boolean(access && !access.allowed);
  const unclaimed = access?.reason === "UNCLAIMED";

  return {
    me,
    setMe,
    orgs,
    refreshOrgs,
    sessionReady,
    access,
    refreshAccess,
    boardOrgId,
    boardTitle,
    authOpen,
    setAuthOpen,
    inviteToken,
    inviteDone,
    setInviteDone,
    canShare,
    canExport,
    canBackup,
    canImport,
    linkOnly,
    canAskAgents,
    canFacilitate,
    canManage,
    canTransfer,
    denied,
    unclaimed,
  };
}
