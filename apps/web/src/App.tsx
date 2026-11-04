import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BoardDocument,
  setAllowBringEveryone,
  setWidgetPositions,
  useBoard,
  type BoardFragment,
  type ConnectorOptions,
  type StyleSnapshot,
} from "@remo/doc";
import { rigidWaypoints } from "@remo/model";
import { BoardCanvas } from "./BoardCanvas";
import { BoardDialogs } from "./BoardDialogs";
import { BoardPanels } from "./BoardPanels";
import { BoardTopbar } from "./BoardTopbar";
import { BoardInspector } from "./BoardInspector";
import { BoardStateLayer, CanvasChrome } from "./BoardOverlays";
import { ContextMenu } from "./ContextMenu";
import { useBoardContextMenu } from "./useBoardContextMenu";
import { useBoardHeader } from "./useBoardHeader";
import { currentRoom, loadIdentity, type Identity } from "./identity";
import { useCursorIdentity } from "./useCursorIdentity";
import { useI18n } from "./i18n";
import { InfoCard } from "./InfoCard";
import { useInfoCard } from "./useInfoCard";
import { useApplyAgentPlan } from "./useApplyAgentPlan";
import { useTidyCommand } from "./useTidyCommand";
import { useBoardCommands } from "./useBoardCommands";
import { useBoardVote } from "./useBoardVote";
import { useFollowAttention } from "./useFollowAttention";
import { useBoardAccess } from "./useBoardAccess";
import { useBoardKeyboard } from "./useBoardKeyboard";
import { useBoardSession } from "./useBoardSession";
import { useBoardTemplates } from "./useBoardTemplates";
import { useBoardNavigation } from "./useBoardNavigation";
import { useNewObjectEditing } from "./useNewObjectEditing";
import { useBoardHistory } from "./useBoardHistory";
import { ToolRail } from "./ToolRail";
import { useBoardTools } from "./useBoardTools";
import { useBoardChrome } from "./useBoardChrome";
import { useSharedTimer } from "./useSharedTimer";
import { useNotice } from "./useNotice";
import { api } from "./api";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type BoardSettings } from "./settings";
import type { Camera } from "@remo/canvas";
export function App() {
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
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 0.4 });
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const [cameraEpoch, setCameraEpoch] = useState(0);
  /** Where the last context menu was opened, so a command that needs a point can use it. */
  const menuPoint = useRef<{ x: number; y: number } | null>(null);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [settings, setSettings] = useState<BoardSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const tidy = useTidyCommand({ openAgents: () => setAgentOpen(true) });
  const [timerOpen, setTimerOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  /** A counter, not a boolean: the rail asks the comments panel to start placement. */
  const [commentRequest, setCommentRequest] = useState(0);
  const {
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
    setCamera,
    notify: showNotice,
    t,
  });
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
  /** One voting session, shared by the panel and the chips on the board (ADR-115). */
  const { vote, open: voteOpen, setOpen: setVoteOpen, cast, withdraw } = useBoardVote({
    boardId: currentRoom(),
    connection,
    t,
  });
  // Two different reasons stop writes: access, and the offline queue limit.
  const writeBlocked = readOnly || saveState.blocked;
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
    handleCamera,
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
    camera,
    setCamera,
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
  } = useSharedTimer({ board, widgets, camera, identity, me, setSelectedIds, closePanel: () => setTimerOpen(false) });

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
    theme,
    setTheme,
    presentOpen,
    setPresentOpen,
    commentsOpen,
    setCommentsOpen,
    commentsUnread,
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
    orgName,
    roleLine,
    voteHint,
    timerHint,
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
    toggleInspector,
  } = useBoardChrome({ board, t });

  const { active, addTemplate, replaceBoard } = useBoardTemplates({
    board,
    widgets,
    access,
    boardTitle,
    synced,
    status,
    setSelectedIds,
    reframe: applyImportedCamera,
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

  const commands = useBoardCommands({
    board,
    widgets,
    selectedIds,
    kanbanStates,
    camera,
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
    onTidy: tidy.start,
  });

  const {
    textOf,
    deltaOf,
    onSetText,
    moveMany,
    patchConnector,
    selectionLocked,
    resizeNote,
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

  const { addStickyAndEdit, addTextAndEdit, finishEditing } = useNewObjectEditing({
    board,
    addSticky,
    addText,
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
    setBoardsOpen,
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
  });

  /** The shared timer's deadline while it runs; a pinned voting session ends with it. */
  const voteTimerEndsAt =
    currentTimerPhase === "running" ? (timerWidget?.timer?.endsAt ?? null) : null;

  return (
    <div className={inspectorOpen ? "app" : "app no-inspector"}>
      <BoardDialogs
        board={board}
        widgets={widgets}
        kanbanStates={kanbanStates}
        selectedIds={selectedIds}
        settings={settings}
        camera={camera}
        access={access}
        me={me}
        identity={identity}
        boardId={currentRoom()}
        boardTitle={title}
        boardOrgId={boardOrgId ?? null}
        inviteToken={inviteToken}
        inviteDone={inviteDone}
        onInviteDone={(boardId) => {
          setInviteDone(true);
          if (boardId) window.location.href = `/?room=${encodeURIComponent(boardId)}`;
          else void refreshAccess();
        }}
        onRefreshAccess={refreshAccess}
        onSignedIn={(user) => {
          setMe(user);
          void refreshAccess();
        }}
        authOpen={authOpen}
        setAuthOpen={setAuthOpen}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        restoreRequest={restoreRequest}
        canExport={canExport}
        canBackup={canBackup}
        canImport={canImport}
        onImported={() => {
          setExportOpen(false);
          setSelectedIds([]);
          applyImportedCamera();
          showNotice(t("export.importDone"));
        }}
        appsOpen={appsOpen}
        setAppsOpen={setAppsOpen}
        timerOpen={timerOpen}
        setTimerOpen={setTimerOpen}
        timerWidget={timerWidget}
        timerPhase={currentTimerPhase}
        timerLeft={timerLeft}
        timerSetBy={timerSetBy}
        canFacilitate={canFacilitate}
        onStartTimer={startSharedTimer}
        onPauseTimer={pause}
        onResumeTimer={resume}
        onExtendTimer={extend}
        onResetTimer={reset}
        followOpen={followOpen}
        setFollowOpen={setFollowOpen}
        followerNames={followerNames}
        otherPeers={otherPeers}
        allowBringEveryone={allowBringEveryone}
        onStopFollowers={stopFollowers}
        onBringEveryone={bringEveryone}
        onToggleAuto={(enabled) => setAllowBringEveryone(board, enabled)}
        vote={vote}
        voteOpen={voteOpen}
        setVoteOpen={setVoteOpen}
        voteTimerEndsAt={voteTimerEndsAt}
        setSelectedIds={setSelectedIds}
        onReveal={revealWidget}
        shareFallback={shareFallback}
        onCloseShareFallback={closeShareFallback}
        shareOpen={shareOpen}
        setShareOpen={setShareOpen}
        canTransfer={canTransfer}
        canManage={canManage}
      />
      <BoardPanels
        accountOpen={accountOpen}
        me={me}
        onCloseAccount={() => setAccountOpen(false)}
        onSignedOut={() => {
          setMe(null);
          setAgentOpen(false);
          void refreshAccess();
        }}
        agentOpen={agentOpen}
        tidy={tidy}
        boardId={currentRoom()}
        boardTitle={title}
        access={access}
        camera={camera}
        selectedIds={selectedIds}
        widgets={widgets}
        onApplyPlan={applyPlan}
        onCloseAgent={() => setAgentOpen(false)}
        onOpenOrg={() => {
          setAgentOpen(false);
          setAccountOpen(true);
        }}
        settingsOpen={settingsOpen}
        settings={settings}
        onChangeSettings={(next) => {
          setSettings(next);
          saveSettings(next);
        }}
        onCloseSettings={() => setSettingsOpen(false)}
        boardsOpen={boardsOpen}
        orgs={orgs}
        onCloseBoards={() => setBoardsOpen(false)}
        onOpenBoard={openBoard}
        trashOpen={trashOpen}
        onCloseTrash={() => setTrashOpen(false)}
        onConfirmTrash={() => void trashBoard()}
      />
      <BoardTopbar
        title={title || boardTitle || ""}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        titleCancelled={titleCancelled}
        renameBoard={renameBoard}
        orgName={orgName}
        writeBlocked={writeBlocked}
        readOnly={readOnly}
        boardsOpen={boardsOpen}
        setBoardsOpen={setBoardsOpen}
        canShare={canShare}
        copied={copied}
        copyShareLink={copyShareLink}
        setShareOpen={setShareOpen}
        canExport={canExport}
        canBackup={canBackup}
        canImport={canImport}
        canDuplicate={canManage}
        canDelete={Boolean(access?.capabilities.includes("board.delete"))}
        canFacilitate={canFacilitate}
        canAskAgents={canAskAgents}
        canUseApps={Boolean(boardOrgId)}
        setSettingsOpen={setSettingsOpen}
        setExportOpen={setExportOpen}
        onRestore={() => {
          requestRestore();
          setExportOpen(true);
        }}
        onDuplicate={() => void duplicateBoard()}
        onTrash={() => setTrashOpen(true)}
        voteRunning={vote.running}
        voteHint={voteHint}
        timerRunning={currentTimerPhase === "running"}
        timerHint={timerHint}
        setVoteOpen={setVoteOpen}
        setTimerOpen={setTimerOpen}
        setFollowOpen={setFollowOpen}
        setAgentOpen={setAgentOpen}
        setAppsOpen={setAppsOpen}
        onReact={react}
        follow={follow}
        toggleFollow={toggleFollow}
        myFollowers={myFollowers}
        otherPeers={otherPeers}
        followOpen={followOpen}
        visiblePresence={visiblePresence}
        me={me}
        identity={identity}
        roleLine={roleLine}
        renameSelf={renameSelf} onAccountRenamed={setMe}
        theme={theme}
        setTheme={setTheme}
        lang={lang}
        setLang={setLang}
        setAccountOpen={setAccountOpen}
        setAuthOpen={setAuthOpen}
        onSignOut={() => void signOutAndForgetName()}
        saveState={saveState}
        saveLabel={saveLabel}
        saveTitle={saveTitle}
        inspectorOpen={inspectorOpen}
        toggleInspector={toggleInspector}
        presentOpen={presentOpen}
        setPresentOpen={setPresentOpen}
        commentsOpen={commentsOpen}
        setCommentsOpen={setCommentsOpen}
        commentsUnread={commentsUnread}
        addTemplate={addTemplate}
      />
      <BoardStateLayer
        blocked={saveState.blocked}
        emptyRoom={!denied && widgets.length === 0 ? currentRoom() : null}
        denied={denied}
        unclaimed={unclaimed}
        reason={access?.reason}
        signedIn={Boolean(me)}
        boardId={currentRoom()}
        onSignIn={() => setAuthOpen(true)}
        onRetry={() => void refreshAccess()}
        onClaim={() => void claimBoard()}
      />

      <div className="workspace">
        <ToolRail {...rail} />
        <BoardCanvas
          boardTitle={title}
          board={board}
          connection={connection}
          canFacilitate={canFacilitate}
          meId={me?.id ?? null}
          canComment={Boolean(access?.capabilities.includes("board.comment"))}
          canManage={Boolean(access?.capabilities.includes("board.manage"))}
          commentRequest={commentRequest}
          widgets={widgets}
          voteSession={vote.active}
          voteBusy={vote.busy}
          voteOffset={vote.offset}
          voteTimerEndsAt={voteTimerEndsAt}
          timerLeft={timerLeft}
          onVote={cast}
          onWithdrawVote={withdraw}
          onOpenVote={() => setVoteOpen(true)}
          presentationOpen={presentOpen}
          onPresentationOpen={setPresentOpen}
          commentsOpen={commentsOpen}
          onCommentsOpen={setCommentsOpen}
          onCommentsUnread={setCommentsUnread}
          reactionRequest={reactionRequest}
          groupNames={groupNames}
          tags={tags}
          kanbanStates={kanbanStates}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          onMoveMany={moveMany}
          onResize={resizeNote}
          onMoveCard={onMoveCard}
          onAddCard={onAddCard}
          onAddColumn={onAddColumn}
          onConnect={onConnect}
          camera={camera}
          onCamera={handleCamera}
          presence={visiblePresence}
          onCursor={onCursor}
          onContextMenu={(target, point) => openMenu(target, point)}
          textOf={textOf}
          deltaOf={deltaOf}
          onSetText={onSetText}
          stickyActions={stickyActions}
          noteMarks={noteMarks}
          onCreateConnected={addConnectedNote}
          connectorActions={connectorActions}
          arrangeActions={arrangeActions}
          onConnectorPatch={patchConnector}
          onAddWaypoint={onAddWaypoint}
          onMoveWaypoint={onMoveWaypoint}
          onDeleteWaypoint={onDeleteWaypoint}
          onLimit={() => showNotice(t("line.limit"))}
          onReattachEnd={onReattachEnd}
          focusedWaypoint={focusedWaypoint}
          editingId={editingId}
          onEdit={editWidget}
          fitKey={`${active}#${cameraEpoch}`}
          grid={settings.grid.style ?? "lines"}
          hintAllowed={hintAllowed}
          settings={settings}
          readOnly={writeBlocked}
        />
        <CanvasChrome
          follow={follow}
          dispatchFollow={dispatchFollow}
          followInvite={followInvite}
          onAcceptFollow={(invite) => {
            dispatchFollow({ type: "follow", target: invite.from,
              label: invite.name ?? invite.from });
            setFollowInvite(null);
          }}
          onDismissFollow={() => setFollowInvite(null)}
          notice={notice}
          pendingDelete={pendingDelete}
          board={board}
          onCancelDelete={() => setPendingDelete(null)}
          onDeleted={() => {
            setSelectedIds([]);
            setPendingDelete(null);
          }}
        />
        <ContextMenu state={menu} onClose={closeMenu} />
        <InfoCard state={info} onClose={closeInfo} />
      <BoardInspector
        toggleInspector={toggleInspector}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        writeBlocked={writeBlocked}
        commandContext={commandContext}
        widgets={widgets}
        board={board}
        setWidgetPositions={setWidgetPositions}
        canJoinSelection={canJoinSelection}
        connectSelection={connectSelection}
        setEditingId={setEditingId}
        selectionLocked={selectionLocked}
        counts={counts}
        kanbanStates={kanbanStates}
        replaceBoard={replaceBoard}
        status={status}
        visiblePresence={visiblePresence}
        onOpenObject={openBoard}
      />
      </div>
    </div>
  );
}
