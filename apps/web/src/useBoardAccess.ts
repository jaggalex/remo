import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Access, type OrgSummary, type SessionUser } from "./api";
import { currentRoom } from "./identity";

/**
 * Who is signed in, and what this viewer may do with this board.
 *
 * One hook, one source: the server's `effective()` result is stored as-is, and every
 * capability in the UI is a read of that answer, not a local guess. The invitation token
 * is read once from the address (ADR-064/081).
 */
export function useBoardAccess() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
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
      })
      .catch(() => {
        if (!alive) return;
        setMe(null);
        setOrgs([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** What this viewer may do with this board, straight from the server. */
  const refreshAccess = useCallback(async () => {
    try {
      const result = await api.access(currentRoom());
      setAccess(result.access);
      setBoardOrgId(result.board?.orgId);
      setBoardTitle(result.board?.title);
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : 0;
      const code = failure instanceof ApiError ? failure.code : "";
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
  }, []);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess, me?.id]);

  const canShare = Boolean(access?.capabilities.includes("board.share"));
  const canExport = Boolean(access?.capabilities.includes("board.export"));
  const canBackup = Boolean(access?.capabilities.includes("board.backup"));
  // Import replaces the shared document, so it needs the same grant as editing and the
  // stronger backup grant (ADR-071).
  const canImport = Boolean(canBackup && access?.capabilities.includes("board.edit"));
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
