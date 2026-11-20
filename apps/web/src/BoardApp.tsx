import { setAllowBringEveryone, setWidgetPositions } from "@remo/doc";
import { currentRoom } from "./identity";
import { saveSettings } from "./settings";
import { BoardCanvas } from "./BoardCanvas";
import { BoardDialogs } from "./BoardDialogs";
import { BoardPanels } from "./BoardPanels";
import { BoardTopbar } from "./BoardTopbar";
import { BoardInspector } from "./BoardInspector";
import { CanvasChrome } from "./BoardOverlays";
import { BoardStart } from "./BoardStart";
import { ContextMenu } from "./ContextMenu";
import { InfoCard } from "./InfoCard";
import { RoomAgentPanel } from "./RoomAgentPanel";
import { ToolRail } from "./ToolRail";
import { useBoardAppState } from "./useBoardAppState";

/**
 * The board screen: one tool rail, one canvas, and the overlays around it.
 *
 * State, effects and the commands they wire live in `useBoardAppState`; what is left
 * here is the layout, so a change to the screen does not have to be read past two
 * hundred lines of hooks (ADR-093).
 */
export function BoardApp() {
  const {
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
  } = useBoardAppState();

  return (
    <div className={inspectorOpen ? "app" : "app no-inspector"}>
      <BoardDialogs
        board={board}
        widgets={widgets}
        kanbanStates={kanbanStates}
        selectedIds={selectedIds}
        settings={settings}
        access={access}
        me={me}
        identity={identity}
        boardId={currentRoom()}
        boardTitle={title}
        boardOrgId={boardOrgId ?? null}
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
        accountTab={accountTab}
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
        selectedIds={selectedIds}
        widgets={widgets}
        onApplyPlan={applyPlan}
        onCloseAgent={() => setAgentOpen(false)}
        onOpenOrg={() => {
          setAgentOpen(false);
          openAccount("agents");
        }}
        settingsOpen={settingsOpen} settings={settings}
        onChangeSettings={(next) => {
          setSettings(next);
          saveSettings(next);
        }}
        onCloseSettings={() => setSettingsOpen(false)}
        refreshOrgs={refreshOrgs}
        boardOrgId={boardOrgId ?? null}
        trashOpen={trashOpen}
        onCloseTrash={() => setTrashOpen(false)}
        onConfirmTrash={() => void trashBoard()}
      />
      <RoomAgentPanel {...roomAgent.panelProps} />
      <BoardTopbar
        {...header}
        title={title || boardTitle || ""}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        titleCancelled={titleCancelled}
        renameBoard={renameBoard}
        writeBlocked={writeBlocked}
        readOnly={readOnly}
        onOpenHome={openHome}
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
        onReplace={replaceBoard}
        voteRunning={vote.running}
        timerRunning={currentTimerPhase === "running"}
        setVoteOpen={setVoteOpen}
        setTimerOpen={setTimerOpen}
        setFollowOpen={setFollowOpen}
        setAgentOpen={setAgentOpen}
        {...roomAgent.barProps}
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
        renameSelf={renameSelf} onAccountRenamed={setMe}
        setAccountOpen={(value) => (value ? openAccount("people") : setAccountOpen(false))}
        setAuthOpen={setAuthOpen}
        onSignOut={() => void signOutAndForgetName()}
        saveState={saveState} saveLabel={saveLabel} saveTitle={saveTitle}
        inspectorOpen={inspectorOpen} toggleInspector={toggleInspector}
        addTemplate={addTemplate}
        templateRequest={templateRequest}
      />
      <BoardStart
        state={{
          blocked: saveState.blocked,
          widgets,
          denied,
          unclaimed,
          reason: access?.reason,
          signedIn: Boolean(me),
          boardId: currentRoom(),
          readOnly: writeBlocked,
        }}
        onCreateNote={addStickyAndEdit} onCreateShape={() => addShapeAndEdit("rectangle")}
        onCreateText={addTextAndEdit}
        onExample={() => setTemplateRequest((value) => value + 1)}
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
          onNotice={showNotice}
          onMoveMany={moveMany} onMoveToCell={moveToCell}
          onResizeMany={resizeSelection}
          onMoveCard={onMoveCard}
          onAddCard={onAddCard}
          onAddColumn={onAddColumn}
          onConnect={onConnect}
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
          synced={synced} fitKey={`${active}#${cameraEpoch}`}
          grid={settings.grid.style}
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
        <InfoCard state={info} onClose={closeInfo} onOpenThread={roomAgent.openFromFrame} />
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
        status={status}
        visiblePresence={visiblePresence}
        onOpenObject={openBoard}
      />
      </div>
    </div>
  );
}
