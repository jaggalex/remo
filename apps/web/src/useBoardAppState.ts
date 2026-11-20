import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BoardDocument,
  useBoard,
  type BoardFragment,
  type ConnectorOptions,
  type StyleSnapshot,
} from "@remo/doc";
import { rigidWaypoints } from "@remo/model";
import { useBoardContextMenu } from "./useBoardContextMenu";
import { useBoardHeader } from "./useBoardHeader";
import { currentRoom, loadIdentity, type Identity } from "./identity";
import { useCursorIdentity } from "./useCursorIdentity";
import { useI18n } from "./i18n";
import { useRoomAgent } from "./useRoomAgent";
import { useInfoCard } from "./useInfoCard";
import { useApplyAgentPlan } from "./useApplyAgentPlan";
import { useTidyCommand } from "./useTidyCommand";
import { useBoardCommands } from "./useBoardCommands";
import { useGatherSelection } from "./useGatherSelection";
import { useBoardVote } from "./useBoardVote";
import { useFollowAttention } from "./useFollowAttention";
import { useBoardAccess } from "./useBoardAccess";
import { useBoardKeyboard } from "./useBoardKeyboard";
import { useBoardSession } from "./useBoardSession";
import { useBoardTemplates } from "./useBoardTemplates";
import { useBoardNavigation } from "./useBoardNavigation";
import { useNewObjectEditing } from "./useNewObjectEditing";
import { useBoardHistory } from "./useBoardHistory";
import { useBoardTools } from "./useBoardTools";
import { useBoardChrome } from "./useBoardChrome";
import { useSharedTimer } from "./useSharedTimer";
import { cameraStore } from "./cameraStore";
import { useNotice } from "./useNotice";
import { api } from "./api";
import { DEFAULT_SETTINGS, loadSettings, type BoardSettings } from "./settings";

/**
 * Everything `BoardApp` holds before it renders: the document, the person, the room's
 * access and the panels' open state.
 *
 * The split exists because the component reached the file-size limit (ADR-093) with a
 * header, a canvas and six overlays around it. Moving the state into one hook keeps the
 * component a description of the screen and leaves the effects together, where the
 * order in which they run is visible in one file. Behaviour is unchanged: the same
 * hooks, in the same order, called once per mounted board.
 */
export function useBoardAppState() {
  const board = useMemo(() => new BoardDocument(), []);
  const { widgets, kanbanStates, title, groupNames, tags, allowBringEveryone } = useBoard(board);
  const { t, typeName, lang, setLang } = useI18n();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedWaypoint, setFocusedWaypoint] = useState<{
    connectorId: string;
    waypointId: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const { notice, showNotice } = useNotice();
  const requestDelete = useCallback((ids: readonly string[]) => {
    if (ids.length) setPendingDelete([...ids]);
  }, []);
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const [cameraEpoch, setCameraEpoch] = useState(0);
  /** Where the last context menu was opened, so a command that needs a point can use it. */
  const menuPoint = useRef<{ x: number; y: number } | null>(null);
  const [settings, setSettings] = useState<BoardSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateRequest, setTemplateRequest] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<"people" | "audit" | "agents">("people");
  const openAccount = useCallback((tab: "people" | "audit" | "agents" = "people") => {
    setAccountTab(tab);
    setAccountOpen(true);
  }, []);
  const [agentOpen, setAgentOpen] = useState(false);
  const roomId = currentRoom();
  const tidy = useTidyCommand({ openAgents: () => setAgentOpen(true) });
  const [timerOpen, setTimerOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  /** A counter, not a boolean: the rail asks the comments panel to start placement. */
  const [commentRequest, setCommentRequest] = useState(0);
  const {
    me, setMe, sessionReady,
    orgs,
    refreshOrgs,
    access,
    refreshAccess,
    boardOrgId,
    boardTitle,
    authOpen,
    setAuthOpen,
    canShare,
    canExport,
    canBackup,
    canImport,
    canAskAgents,
    canFacilitate,
    canManage,
    canTransfer,
    denied,
    unclaimed,
  } = useBoardAccess();
  const { renameSelf, forgetAccountName } = useCursorIdentity({ accountName: me?.name, setIdentity });
  const { openBoard, copyObjectLink, revealWidget } = useBoardNavigation({
    widgets,
    setSelectedIds,
    setCamera: cameraStore.update,
    notify: showNotice,
    t,
  });
  /** Leave the board for the organisation home: the board unmounts with the address. */
  const openHome = useCallback(() => {
    const slug = orgs.find((org) => org.id === boardOrgId)?.slug;
    window.location.assign(slug ? `${window.location.pathname}?org=${encodeURIComponent(slug)}` : window.location.pathname);
  }, [boardOrgId, orgs]);

  const readOnly = !(access?.allowed === true && access.capabilities.includes("board.edit"));
  const {
    connection,
    status,
    synced,
    saveState,
    visiblePresence,
    saveLabel,
    saveTitle,
  } = useBoardSession({ board, identity, accountId: me?.id ?? null, accountHandle: me?.handle ?? null, access, refreshAccess,
    setNotice: showNotice, t });
  // Two different reasons stop writes: access, and the offline queue limit.
  const writeBlocked = readOnly || saveState.blocked;
  const roomAgent = useRoomAgent({
    board, widgets, selectedIds, roomId, boardTitle: title || boardTitle || "",
    canEdit: !writeBlocked,
    accountId: me?.id ?? null, synced,
    identityKey: `${me?.id ?? ""}:${access?.aclVersion ?? 0}`,
    openSettings: () => openAccount("agents"),
  });
  /** One voting session, shared by the panel and the chips on the board (ADR-115). */
  const { vote, open: voteOpen, setOpen: setVoteOpen, cast, withdraw } = useBoardVote({
    boardId: currentRoom(),
    connection,
    t,
  });
  /**
   * Why the rail is off, in words.
   *
   * A dimmed tool must say what stops it (§10.2, Р1): view-only access and a full offline
   * queue are different problems with different answers.
   */
  const blockedHint = readOnly ? t("tool.readOnly") : t("sync.blocked");
  /**
   * The bottom-centre slot belongs to one plate at a time.
   *
   * While a voting session runs — or its results are still unpublished, so the line
   * stays on the board — the hint is not rendered, and the line never has to dodge it
   * (§10.4, Н1/Н3).
   */
  const hintAllowed = !(vote.active && (vote.running || !vote.active.publishedAt));
  /**
   * Last fragment copied in this tab.
   *
   * The system clipboard is the real transport, but a LAN address served over
   * plain HTTP has no `navigator.clipboard.readText`, so the same tab keeps its own
   * copy and paste still works.
   */
  const clipboardFragment = useRef<BoardFragment | null>(null);
  /**
   * Style copied with "Copy style".
   *
   * Like the source product, this is a separate clipboard from the object clipboard:
   * pasting a style must not paste the object, and the system clipboard is for text.
   */
  const copiedStyle = useRef<StyleSnapshot | null>(null);
  /**
   * The last connector style used.
   *
   * A new line should look like the one before it, the way the source product
   * remembers: drawing five links in a row and re-picking the arrow five times is
   * busywork (ADR-031). The bar writes here whenever a connector property changes.
   */
  const lastConnector = useRef<ConnectorOptions>({
    shape: DEFAULT_SETTINGS.connectors.shape,
    arrow: DEFAULT_SETTINGS.connectors.arrow,
    strokeColor: DEFAULT_SETTINGS.connectors.colour,
    strokeStyle: DEFAULT_SETTINGS.connectors.dash,
    strokeWidth: DEFAULT_SETTINGS.connectors.width,
  });
  /**
   * Settings are a starting point, not a straitjacket: a new connector takes the
   * tuned defaults, then remembers whatever the person changes on it.
   */
  useEffect(() => {
    lastConnector.current = {
      shape: settings.connectors.shape,
      arrow: settings.connectors.arrow,
      strokeColor: settings.connectors.colour,
      strokeStyle: settings.connectors.dash,
      strokeWidth: settings.connectors.width,
    };
  }, [settings.connectors]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const {
    follow,
    dispatchFollow,
    followInvite,
    setFollowInvite,
    myFollowers,
    followerNames,
    otherPeers,
    toggleFollow,
    stopFollowers,
    bringEveryone,
  } = useFollowAttention({
    presence: visiblePresence,
    identity,
    connection,
    allowBringEveryone,
    setNotice: showNotice,
    setFollowOpen,
    t,
  });

  const {
    timerWidget,
    currentTimerPhase,
    timerLeft,
    timerSetBy,
    startSharedTimer,
    pause,
    resume,
    extend,
    reset,
  } = useSharedTimer({ board, widgets, identity, me, setSelectedIds, closePanel: () => setTimerOpen(false) });

  const header = useBoardHeader({
    access,
    me,
    setMe,
    orgs,
    boardOrgId: boardOrgId ?? null,
    vote,
    timerWidget,
    timerPhase: currentTimerPhase,
    timerLeft,
    refreshAccess,
    setAgentOpen,
    showNotice,
    t,
    lang,
    setLang,
  });

  const {
    presentOpen,
    setPresentOpen,
    commentsOpen,
    setCommentsOpen,
    setCommentsUnread,
    reactionRequest,
    react,
    restoreRequest,
    requestRestore,
    trashOpen,
    setTrashOpen,
    trashBoard,
    signOut,
    duplicateBoard,
  } = header;

  /** Signing out returns this browser to its guest name (ADR-149). */
  const signOutAndForgetName = useCallback(async () => {
    await signOut();
    forgetAccountName();
  }, [signOut, forgetAccountName]);

  /** Imported content is re-framed; remote edits never move the camera. */
  const applyImportedCamera = useCallback(() => setCameraEpoch((n) => n + 1), []);

  const {
    titleDraft,
    setTitleDraft,
    titleCancelled,
    renameBoard,
    copied,
    copyShareLink,
    shareFallback,
    closeShareFallback,
    inspectorOpen,
    toggleInspector, openInspector,
  } = useBoardChrome({ board, t });

  const { active, addTemplate, replaceBoard } = useBoardTemplates({
    board,
    widgets,
    access,
    boardTitle,
    synced, status,
    setSelectedIds,
    reframe: applyImportedCamera,
    langReady: sessionReady && (!me || !me.preferences?.lang || me.preferences.lang === lang),
  });

  // Keyboard handling lives below the commands it invokes (see `onKeyDown`).

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const widget of widgets) map.set(widget.type, (map.get(widget.type) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [widgets]);

  const onCursor = useCallback(
    (cursor: { x: number; y: number } | null) => connection?.setCursor(cursor),
    [connection],
  );

  const { undo, redo, forceRender } = useBoardHistory(board);
  const { info, openInfo, closeInfo } = useInfoCard(typeName, t);

  const gatherSelection = useGatherSelection({
    board,
    setSelectedIds, openInspector,
    notice: showNotice,
    title: t("board.frameTitle"),
    emptyMessage: t("selection.gather.none"),
    skippedMessage: (count) => t("selection.gather.skipped", { n: String(count) }),
  });

  const commands = useBoardCommands({
    board,
    widgets,
    selectedIds,
    kanbanStates,
    settings,
    clipboardFragment,
    lastConnector,
    styleClipboard: copiedStyle,
    setSelectedIds,
    setEditingId,
    openInfo,
    menuPoint,
    requestDelete,
    copyLink: copyObjectLink,
    actor: { id: me?.id ?? null, name: me?.name ?? identity.name },
    canManage,
    refuseUnlock: (authorName) =>
      showNotice(t("lock.refused", { name: authorName || t("lock.authorUnknown") })),
    onTidy: tidy.start, onGather: gatherSelection,
  });

  const {
    textOf,
    deltaOf,
    onSetText,
    moveMany, moveToCell,
    patchConnector,
    selectionLocked,
    resizeSelection,
    onMoveCard,
    onAddCard,
    onAddColumn,
    addSticky,
    addStickyStack,
    addText,
    addCardFromSelection,
    canJoinSelection,
    addShape,
    addFrame,
    connectSelection,
    onConnect,
    copyIds,
    pasteSelection,
    duplicateIds,
    commandContext,
    addConnectedNote,
    stickyActions,
    noteMarks,
    connectorActions,
    arrangeActions,
    applyTone,
    onAddWaypoint,
    onMoveWaypoint,
    onDeleteWaypoint,
    onReattachEnd,
  } = commands;

  const applyPlan = useApplyAgentPlan({
    board,
    author: me?.name ?? identity.name,
    setSelectedIds,
  });

  const { addStickyAndEdit, addTextAndEdit, addShapeAndEdit, finishEditing } = useNewObjectEditing({
    board,
    addSticky,
    addText,
    addShape,
    setEditingId,
  });

  const { rail, run: runTool } = useBoardTools({
    widgets,
    selectedIds,
    kanbanStates,
    writeBlocked,
    blockedHint,
    canComment: Boolean(access?.capabilities.includes("board.comment")),
    canUndo: board.canUndo,
    canRedo: board.canRedo,
    undo,
    redo,
    canConnect: canJoinSelection,
    connectSelection,
    createSticky: addStickyAndEdit,
    createStickyStack: addStickyStack,
    createText: addTextAndEdit,
    createShape: addShape,
    createFrame: () => addFrame(t("board.frameTitle")),
    createCard: addCardFromSelection,
    openComment: () => setCommentRequest((value) => value + 1),
    notify: showNotice,
    setSelectedIds,
  });

  /** A double-click opens; closing goes through the empty-sticky rule. */
  const editWidget = useCallback(
    (id: string | null) => {
      if (id) setEditingId(id);
      else finishEditing();
    },
    [finishEditing],
  );

  // An existing inline editor would keep writing past the offline limit; close it
  // when input becomes blocked so the visible state matches what the user may do.
  useEffect(() => {
    if (writeBlocked) finishEditing();
  }, [finishEditing, writeBlocked]);

  // Objects carry the name of whoever made them; the board does not sync names, it
  // only reads this one when stamping (ADR-046).
  useEffect(() => {
    board.author = identity.name;
  }, [board, identity.name]);

  // A focused point belongs to one selected line; anything else clears it.
  useEffect(() => {
    setFocusedWaypoint((previous) => {
      if (!previous) return null;
      const line = widgets.find((widget) => widget.id === previous.connectorId);
      if (!line || line.type !== "connector" || !selectedIds.includes(line.id)) return null;
      return rigidWaypoints(line).some((point) => point.id === previous.waypointId)
        ? previous
        : null;
    });
  }, [selectedIds, widgets]);

  useBoardKeyboard({
    board,
    writeBlocked,
    onTool: runTool,
    onTone: applyTone,
    onAgentUndo: roomAgent.undoAgentDraft,
    editingId,
    selectedIds,
    widgets,
    focusedWaypoint,
    setFocusedWaypoint,
    onDeleteWaypoint,
    onMoveWaypoint,
    commandContext,
    addConnectedNote,
    setEditingId: editWidget,
    setSelectedIds,
    onOpenHome: openHome,
    forceRender,
    pasteSelection,
  });

  /** Take an unprotected room: the first signed-in visitor becomes its owner. */
  const claimBoard = useCallback(async () => {
    try {
      await api.claim(currentRoom());
      await refreshAccess();
    } catch {
      // Already claimed by someone else, or the session expired: re-read the truth.
      await refreshAccess();
    }
  }, [refreshAccess]);

  const { menu, openMenu, closeMenu } = useBoardContextMenu({
    board,
    kanbanStates,
    commandContext,
    writeBlocked,
    copyIds,
    duplicateIds,
    pasteSelection,
    setSelectedIds,
    menuPoint,
    t,
    onNotice: showNotice,
  });

  /** The shared timer's deadline while it runs; a pinned voting session ends with it. */
  const voteTimerEndsAt =
    currentTimerPhase === "running" ? (timerWidget?.timer?.endsAt ?? null) : null;

  return {
    board,
    widgets,
    kanbanStates,
    title,
    groupNames,
    tags,
    allowBringEveryone,
    t,
    selectedIds,
    setSelectedIds,
    focusedWaypoint,
    pendingDelete,
    setPendingDelete,
    notice,
    showNotice,
    identity,
    cameraEpoch,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    templateRequest,
    setTemplateRequest,
    shareOpen,
    setShareOpen,
    exportOpen,
    setExportOpen,
    accountOpen,
    setAccountOpen,
    accountTab,
    openAccount,
    agentOpen,
    setAgentOpen,
    tidy,
    timerOpen,
    setTimerOpen,
    followOpen,
    setFollowOpen,
    appsOpen,
    setAppsOpen,
    commentRequest,
    me,
    setMe,
    refreshOrgs,
    access,
    refreshAccess,
    boardOrgId,
    boardTitle,
    authOpen,
    setAuthOpen,
    canShare,
    canExport,
    canBackup,
    canImport,
    canAskAgents,
    canFacilitate,
    canManage,
    canTransfer,
    denied,
    unclaimed,
    renameSelf,
    openBoard,
    revealWidget,
    openHome,
    readOnly,
    connection,
    status,
    synced,
    saveState,
    visiblePresence,
    saveLabel,
    saveTitle,
    writeBlocked,
    roomAgent,
    vote,
    voteOpen,
    setVoteOpen,
    cast,
    withdraw,
    hintAllowed,
    editingId,
    setEditingId,
    follow,
    dispatchFollow,
    followInvite,
    setFollowInvite,
    myFollowers,
    followerNames,
    otherPeers,
    toggleFollow,
    stopFollowers,
    bringEveryone,
    timerWidget,
    currentTimerPhase,
    timerLeft,
    timerSetBy,
    startSharedTimer,
    pause,
    resume,
    extend,
    reset,
    header,
    presentOpen,
    setPresentOpen,
    commentsOpen,
    setCommentsOpen,
    setCommentsUnread,
    reactionRequest,
    react,
    restoreRequest,
    requestRestore,
    trashOpen,
    setTrashOpen,
    trashBoard,
    duplicateBoard,
    signOutAndForgetName,
    applyImportedCamera,
    titleDraft,
    setTitleDraft,
    titleCancelled,
    renameBoard,
    copied,
    copyShareLink,
    shareFallback,
    closeShareFallback,
    inspectorOpen,
    toggleInspector,
    active,
    addTemplate,
    replaceBoard,
    counts,
    onCursor,
    info,
    closeInfo,
    applyPlan,
    addStickyAndEdit,
    addTextAndEdit,
    addShapeAndEdit,
    rail,
    editWidget,
    claimBoard,
    menu,
    openMenu,
    closeMenu,
    voteTimerEndsAt,
    textOf,
    deltaOf,
    onSetText,
    moveMany,
    moveToCell,
    patchConnector,
    selectionLocked,
    resizeSelection,
    onMoveCard,
    onAddCard,
    onAddColumn,
    canJoinSelection,
    connectSelection,
    onConnect,
    commandContext,
    addConnectedNote,
    stickyActions,
    noteMarks,
    connectorActions,
    arrangeActions,
    onAddWaypoint,
    onMoveWaypoint,
    onDeleteWaypoint,
    onReattachEnd,
  };
}
