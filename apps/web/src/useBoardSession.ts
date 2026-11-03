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

  useEffect(() => {
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
  }, [board, refreshAccess, session]);

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
