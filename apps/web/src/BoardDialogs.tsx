import type { KanbanState, Widget } from "@remo/model";
import type { BoardDocument } from "@remo/doc";
import type { Access, SessionUser } from "./api";
import type { VoteController } from "./useVoteSessions";
import type { BoardSettings } from "./settings";
import type { Identity } from "./identity";
import { AuthDialog } from "./AuthDialog";
import { ExportDialog } from "./ExportDialog";
import { AppsPanel } from "./AppsPanel";
import { TimerPanel } from "./TimerPanel";
import { FollowDialog } from "./FollowDialog";
import { VoteSurface } from "./VoteSurface";
import { ShareLinkDialog } from "./ShareLinkDialog";
import { ShareDialog } from "./ShareDialog";
import { InviteDialog } from "./InviteDialog";
import { Contained } from "./ErrorBoundary";
import type { TimerPhase } from "@remo/model";

/**
 * The dialogs the board opens from its header and its invite link (spec §10).
 *
 * They are forms over the board, not parts of it: one file keeps the two surfaces of
 * `App` — the canvas and its forms — apart, and keeps `App` inside the Q4 size ratchet.
 */
export function BoardDialogs(props: Parameters<typeof DialogsBody>[0]) {
  // One failure boundary for the dialogs (ADR-171): a broken dialog never takes the room.
  return (
    <Contained scope="panel">
      <DialogsBody {...props} />
    </Contained>
  );
}

function DialogsBody({
  board,
  widgets,
  kanbanStates,
  selectedIds,
  settings,
  access,
  me,
  identity,
  boardId,
  boardTitle,
  boardOrgId,
  inviteToken,
  inviteDone,
  onInviteDone,
  onRefreshAccess,
  onSignedIn,
  authOpen,
  setAuthOpen,
  exportOpen,
  setExportOpen,
  restoreRequest,
  canExport,
  canBackup,
  canImport,
  onImported,
  appsOpen,
  setAppsOpen,
  timerOpen,
  setTimerOpen,
  timerWidget,
  timerPhase,
  timerLeft,
  timerSetBy,
  canFacilitate,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onExtendTimer,
  onResetTimer,
  followOpen,
  setFollowOpen,
  followerNames,
  otherPeers,
  allowBringEveryone,
  onStopFollowers,
  onBringEveryone,
  onToggleAuto,
  vote,
  voteOpen,
  setVoteOpen,
  voteTimerEndsAt,
  setSelectedIds,
  onReveal,
  shareFallback,
  onCloseShareFallback,
  shareOpen,
  setShareOpen,
  canTransfer,
  canManage,
}: {
  board: BoardDocument;
  widgets: Widget[];
  kanbanStates: Record<string, KanbanState>;
  selectedIds: string[];
  settings: BoardSettings;
  access: Access | null;
  me: SessionUser | null;
  identity: Identity;
  boardId: string;
  boardTitle: string;
  boardOrgId: string | null;
  inviteToken: string | null;
  inviteDone: boolean;
  onInviteDone: (boardId: string | null) => void;
  onRefreshAccess: () => Promise<void>;
  onSignedIn: (user: SessionUser) => void;
  authOpen: boolean;
  setAuthOpen: (value: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (value: boolean) => void;
  restoreRequest: number;
  canExport: boolean;
  canBackup: boolean;
  canImport: boolean;
  onImported: () => void;
  appsOpen: boolean;
  setAppsOpen: (value: boolean) => void;
  timerOpen: boolean;
  setTimerOpen: (value: boolean) => void;
  timerWidget: Widget | undefined;
  timerPhase: TimerPhase;
  timerLeft: number;
  timerSetBy: string;
  canFacilitate: boolean;
  onStartTimer: (minutes: number) => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onExtendTimer: () => void;
  onResetTimer: () => void;
  followOpen: boolean;
  setFollowOpen: (value: boolean) => void;
  followerNames: string[];
  otherPeers: number;
  allowBringEveryone: boolean;
  onStopFollowers: () => void;
  onBringEveryone: () => void;
  onToggleAuto: (enabled: boolean) => void;
  vote: VoteController;
  voteOpen: boolean;
  setVoteOpen: (value: boolean) => void;
  voteTimerEndsAt: string | null;
  setSelectedIds: (ids: string[]) => void;
  onReveal: (widgetId: string) => void;
  shareFallback: string | null;
  onCloseShareFallback: () => void;
  shareOpen: boolean;
  setShareOpen: (value: boolean) => void;
  canTransfer: boolean;
  canManage: boolean;
}) {
  return (
    <>
      {inviteToken && !inviteDone && (
        <InviteDialog
          token={inviteToken}
          signedIn={Boolean(me)}
          onSignIn={() => setAuthOpen(true)}
          onDone={onInviteDone}
        />
      )}
      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={onSignedIn}
      />
      <ExportDialog
        open={exportOpen}
        restoreRequest={restoreRequest}
        boardId={boardId}
        boardTitle={boardTitle}
        board={board}
        widgets={widgets}
        kanbanStates={kanbanStates}
        selectedIds={selectedIds}
        settings={settings}
        canExport={canExport}
        canBackup={canBackup}
        canImport={canImport}
        onClose={() => setExportOpen(false)}
        onImported={onImported}
      />
      <AppsPanel
        open={appsOpen}
        orgId={boardOrgId ?? undefined}
        boardId={boardId}
        viewerName={me?.name ?? identity.name}
        onClose={() => setAppsOpen(false)}
      />
      <TimerPanel
        open={timerOpen}
        phase={timerWidget ? timerPhase : "idle"}
        remainingMs={timerLeft}
        setBy={timerSetBy}
        canFacilitate={canFacilitate}
        onStart={onStartTimer}
        onPause={onPauseTimer}
        onResume={onResumeTimer}
        onExtend={onExtendTimer}
        onReset={onResetTimer}
        onClose={() => setTimerOpen(false)}
      />
      <FollowDialog
        open={followOpen}
        followers={followerNames}
        peers={otherPeers}
        allowBringEveryone={allowBringEveryone}
        canFacilitate={canFacilitate}
        onStopFollowers={onStopFollowers}
        onBringEveryone={onBringEveryone}
        onToggleAuto={onToggleAuto}
        onClose={() => setFollowOpen(false)}
      />
      <VoteSurface
        open={voteOpen}
        vote={vote}
        widgets={widgets}
        canFacilitate={canFacilitate}
        selectedIds={selectedIds}
        timerEndsAt={voteTimerEndsAt}
        timerLeft={timerPhase === "running" ? timerLeft : null}
        boardId={boardId}
        setSelectedIds={setSelectedIds}
        onReveal={onReveal}
        onClose={() => setVoteOpen(false)}
      />
      <ShareLinkDialog link={shareFallback} onClose={onCloseShareFallback} />
      <ShareDialog
        open={shareOpen}
        boardId={boardId}
        boardTitle={boardTitle}
        orgId={boardOrgId ?? undefined}
        meId={me?.id}
        canTransfer={canTransfer}
        canManage={canManage}
        viewerRole={access?.role ?? null}
        viewerSources={access?.sources ?? []}
        onClose={() => setShareOpen(false)}
        onChange={() => void onRefreshAccess()}
      />
    </>
  );
}
