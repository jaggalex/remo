import { useEffect, useRef, useState } from "react";
import {
  connectBoard,
  usePresence,
  type BoardConnection,
  type BoardDocument,
  type ConnectionStatus,
  type SaveState,
} from "@remo/doc";
import type { Access } from "./api";
import { currentRoom, syncUrl, type Identity } from "./identity";
import { loadBrowserSession } from "./session";
import type { TranslationKey } from "./i18n";

/**
 * The board's connection to its room, and the save state the topbar shows.
 *
 * The transport is additive: the document is already the source of truth, so remote
 * edits arrive as ordinary transactions. The socket is rebuilt only for a new document
 * or a new access check; a rename, a sign-in or a language change updates awareness in
 * place (ADR-149/151).
 */
export function useBoardSession({
  board,
  identity,
  accountId,
  access,
  refreshAccess,
  setNotice,
  t,
}: {
  board: BoardDocument;
  identity: Identity;
  /** The signed-in account; null for a guest. */
  accountId: string | null;
  access: Access | null;
  refreshAccess: () => Promise<void>;
  setNotice: (message: string) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  // One tab is one session: its key survives a reload, a new tab gets a new one (ADR-151).
  const [session] = useState(loadBrowserSession);
  const [connection, setConnection] = useState<BoardConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({
    state: "connecting",
    pending: 0,
    blocked: false,
  });
  const presence = usePresence(connection?.awareness ?? null, session.key);

  // A link visitor sees no member names, avatars or presence (ADR-069). The awareness
  // object still exists for cursors and sync; only the presentation is emptied, so a
  // public link never becomes a people directory.
  const linkVisitor = Boolean(access?.sources.includes("link"));
  const visiblePresence = linkVisitor ? [] : presence;

  // The connect effect must not depend on words or on the cursor name: editing the name
  // used to destroy and rebuild the socket on every keystroke, and switching language did
  // the same. The callback reads the current translator through a ref.
  const tRef = useRef(t);
  tRef.current = t;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  // The socket is rebuilt when the access decision changes in a way the handshake cares
  // about: signing in from a public link or losing edit rights. A plain refresh with the
  // same role and capabilities must not reconnect.
  const accessKey = access
    ? `${access.role ?? ""}:${[...access.capabilities].sort().join(",")}:${[...access.sources].sort().join(",")}`
    : "none";

  useEffect(() => {
    // Wait for the first access decision: connecting while it is unknown and then
    // rebuilding on the answer dropped this session's presence (and its follow target)
    // for a moment, which two same-account sessions then read as a renamed peer.
    if (!access || access.allowed === false) return;
    const connection = connectBoard(board, {
      url: syncUrl(),
      room: currentRoom(),
      user: {
        name: identityRef.current.name,
        color: identityRef.current.color,
        sessionKey: session.key,
        accountId: accountIdRef.current,
        joinedAt: session.joinedAt,
      },
      onAccessChanged: (code) => {
        setNotice(code === 4401 ? tRef.current("sync.sessionEnded") : tRef.current("sync.accessChanged"));
        void refreshAccess();
      },
    });
    setConnection(connection);
    setStatus(connection.status());
    setSynced(false);
    setSaveState(connection.saveState());
    const offStatus = connection.onStatus(setStatus);
    const offSynced = connection.onSynced(setSynced);
    const offSave = connection.onSaveState(setSaveState);
    return () => {
      offStatus();
      offSynced();
      offSave();
      connection.disconnect();
      setConnection(null);
    };
  }, [board, refreshAccess, session, accessKey, access]);

  // A failed upgrade (401/403/404) reaches the browser as close 1006, not 4403, so the
  // access callback never fires. While disconnected, refresh the decision so a revoked
  // editor sees the gate instead of an endless offline queue.
  useEffect(() => {
    if (status !== "disconnected") return;
    const refresh = () => void refreshAccess();
    const timer = window.setInterval(refresh, 5_000);
    const wake = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [status, refreshAccess]);

  // A denied decision means there is nothing to reconnect to. The next allowed decision
  // changes accessKey and rebuilds the socket.
  useEffect(() => {
    if (access?.allowed === false) connection?.disconnect();
  }, [access, connection]);

  // Renaming the cursor (or adopting the account name, ADR-149), signing in or changing
  // the account is awareness, not a new room: update it in place so the socket and the
  // document stay put. Two sessions of one account stay two entries (ADR-151).
  useEffect(() => {
    connection?.setUser({
      name: identity.name,
      color: identity.color,
      sessionKey: session.key,
      accountId,
      joinedAt: session.joinedAt,
    });
  }, [connection, identity.name, identity.color, accountId, session]);

  const saveLabel =
    saveState.state === "offline"
      ? t("sync.offline", { count: saveState.pending })
      : t(`sync.${saveState.state}` as "sync.saved");
  const saveTitle = t(`sync.${saveState.state}Title` as "sync.savedTitle");

  return { connection, status, synced, saveState, presence, visiblePresence, linkVisitor, saveLabel, saveTitle };
}
