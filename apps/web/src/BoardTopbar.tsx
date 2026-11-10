import { useState } from "react";
import type { MutableRefObject } from "react";
import type { Presence, SaveState } from "@remo/doc";
import { Button, IconButton, Separator, Tooltip } from "@remo/ui";
import type { SessionUser } from "./api";
import type { FollowState } from "./follow";
import { useI18n } from "./i18n";
import type { Identity } from "./identity";
import type { Theme } from "./useTheme";
import { TEMPLATE_KEYS, type TemplateKey } from "@remo/model";
import { TEMPLATE_LABEL_KEY } from "./templateLabels";
import { BoardTitleMenu, boardMenuItems } from "./topbar/BoardTitleMenu";
import { FacilitationMenu } from "./topbar/FacilitationMenu";
import { MoreMenu } from "./topbar/MoreMenu";
import { AccountMenu } from "./topbar/AccountMenu";
import { InterfaceToggles } from "./topbar/InterfaceToggles";
import { Peers } from "./topbar/Peers";
import { SyncLine } from "./topbar/SyncLine";
import { SessionsDialog } from "./SessionsDialog";

/** Which top-bar surface is open. One at a time: they share the same screen edge. */
type MenuView = "board" | "facilitation" | "more" | "templates" | "account" | null;

/**
 * The board's header (ADR-119, ADR-119).
 *
 * Left: the remo mark, "All rooms", the path and the room's name with its menu. Centre:
 * empty. Right, in the order the mockup fixes: facilitation, more, saving, presence,
 * properties, presentation, discussion, share. The header describes the board; creation
 * lives on the rail, and every dialog is opened from one of the four menus.
 */
export interface BoardTopbarProps {
  title: string;
  titleDraft: string | null;
  setTitleDraft: (value: string | null) => void;
  titleCancelled: MutableRefObject<boolean>;
  renameBoard: (value: string) => void;
  /** "Organisation /" before the title; a personal board has no path. */
  orgName: string | null;
  writeBlocked: boolean;
  readOnly: boolean;
  onOpenHome: () => void;
  canShare: boolean;
  copied: boolean;
  copyShareLink: () => void;
  setShareOpen: (value: boolean) => void;
  canExport: boolean;
  canBackup: boolean;
  canImport: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canFacilitate: boolean;
  canAskAgents: boolean;
  canUseApps: boolean;
  setSettingsOpen: (value: boolean) => void;
  setExportOpen: (value: boolean) => void;
  onRestore: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
  voteRunning: boolean;
  voteHint: string;
  timerRunning: boolean;
  timerHint: string;
  setVoteOpen: (value: boolean) => void;
  setTimerOpen: (value: boolean) => void;
  setFollowOpen: (value: boolean) => void;
  setAgentOpen: (value: boolean) => void;
  /** The room agent assigned to this room (ADR-189), if any. */
  roomAgent: { name: string; enabled: boolean; status: string | null } | null;
  canAssignAgent: boolean;
  hasRoomAgentHistory: boolean;
  onOpenRoomAgent: () => void;
  setAppsOpen: (value: boolean) => void;
  onReact: (emoji: string) => void;
  follow: FollowState;
  toggleFollow: (target: string, label: string) => void;
  myFollowers: number;
  otherPeers: number;
  followOpen: boolean;
  visiblePresence: Presence[];
  me: SessionUser | null;
  identity: Identity;
  roleLine: string | null;
  renameSelf: (value: string) => void;
  onAccountRenamed: (user: SessionUser) => void;
  theme: Theme;
  setTheme: (value: Theme) => void;
  setAccountOpen: (value: boolean) => void;
  setAuthOpen: (value: boolean) => void;
  onSignOut: () => void;
  saveState: SaveState;
  saveLabel: string;
  saveTitle: string;
  inspectorOpen: boolean;
  toggleInspector: () => void;
  presentOpen: boolean;
  setPresentOpen: (value: boolean) => void;
  commentsOpen: boolean;
  setCommentsOpen: (value: boolean) => void;
  commentsUnread: number;
  addTemplate: (key: TemplateKey) => void;
}

export function BoardTopbar(props: BoardTopbarProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuView>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const {
    title, titleDraft, setTitleDraft, titleCancelled, renameBoard, orgName, writeBlocked,
    readOnly, onOpenHome, canShare, copied, copyShareLink, setShareOpen,
    canExport, canBackup, canImport, canDuplicate, canDelete, canFacilitate, canAskAgents, canUseApps,
    setSettingsOpen, setExportOpen, onRestore, onDuplicate, onTrash, voteRunning, voteHint,
    timerRunning, timerHint, setVoteOpen, setTimerOpen, setFollowOpen, setAgentOpen,
    setAppsOpen, onReact, follow, toggleFollow, myFollowers, otherPeers, followOpen,
    roomAgent, canAssignAgent, hasRoomAgentHistory, onOpenRoomAgent,
    visiblePresence, me, identity, roleLine, renameSelf, onAccountRenamed, theme, setTheme,
    setAccountOpen, setAuthOpen, onSignOut, saveState, saveLabel, saveTitle, inspectorOpen,
    toggleInspector, presentOpen, setPresentOpen, commentsOpen, setCommentsOpen,
    commentsUnread, addTemplate,
  } = props;

  const self = visiblePresence.find((peer) => peer.self);
  const peers = visiblePresence.filter((peer) => !peer.self);
  const name = me?.name ?? self?.name ?? identity.name;

  const commitTitle = (value: string) => {
    if (titleCancelled.current) {
      titleCancelled.current = false;
      setTitleDraft(null);
    } else {
      renameBoard(value);
    }
    setRenaming(false);
  };

  const templates = TEMPLATE_KEYS.map((key) => ({ key, label: t(TEMPLATE_LABEL_KEY[key]) }));

  return (
    <>
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-mark" aria-hidden="true">
          <img src="/remo-logo.svg" alt="" />
        </span>
        <Tooltip label={t("board.allBoards")} shortcut={["⌘", "K"]}>
          <IconButton icon="boards" label={t("board.allBoards")} onClick={onOpenHome} />
        </Tooltip>
        {orgName && (
          <button
            type="button"
            className="topbar-path topbar-path-button"
            title={t("board.allBoards")}
            onClick={onOpenHome}
          >
            {orgName} <span aria-hidden="true">/</span>
          </button>
        )}
        <BoardTitleMenu
          title={title}
          renaming={renaming}
          onRenaming={setRenaming}
          draft={titleDraft ?? title}
          onDraft={setTitleDraft}
          onCommit={commitTitle}
          onCancel={() => {
            titleCancelled.current = true;
            setTitleDraft(null);
            setRenaming(false);
          }}
          open={menu === "board"}
          onOpen={(open) => setMenu(open ? "board" : null)}
          readOnly={writeBlocked}
          items={boardMenuItems({
            canDuplicate,
            canDelete,
            canExport,
            canBackup,
            canImport,
            writeBlocked,
            t,
            onRename: () => {
              setMenu(null);
              setRenaming(true);
            },
            onSettings: () => {
              setMenu(null);
              setSettingsOpen(true);
            },
            onExport: () => {
              setMenu(null);
              setExportOpen(true);
            },
            onRestore: () => {
              setMenu(null);
              onRestore();
            },
            onDuplicate: () => {
              setMenu(null);
              onDuplicate();
            },
            onTrash: () => {
              setMenu(null);
              onTrash();
            },
          })}
        />
      </div>

      {/* The centre of the header stays empty (Ш2): identity left, session right. */}
      <div className="topbar-spacer" />

      <div className="topbar-right">
        {(roomAgent || canAssignAgent || hasRoomAgentHistory) && (
          <button
            type="button"
            className={`agent-avatar${roomAgent ? "" : " empty"}`}
            onClick={onOpenRoomAgent}
            aria-label={
              roomAgent
                ? t("roomAgent.assigned", { name: roomAgent.name })
                : t(canAssignAgent && !hasRoomAgentHistory ? "roomAgent.assign" : "roomAgent.title")
            }
            title={
              roomAgent
                ? t("roomAgent.assigned", { name: roomAgent.name })
                : t(canAssignAgent && !hasRoomAgentHistory ? "roomAgent.assign" : "roomAgent.title")
            }
          >
            <span className="agent-avatar-letter">
              {roomAgent ? roomAgent.name.trim().slice(0, 1).toUpperCase() : canAssignAgent && !hasRoomAgentHistory ? "+" : t("roomAgent.ai")}
            </span>
            <span className="agent-avatar-ai" aria-hidden="true">
              AI
            </span>
            {roomAgent?.status && (
              <span className={`agent-avatar-dot ${roomAgent.status}`} aria-hidden="true" />
            )}
          </button>
        )}
        <FacilitationMenu
          open={menu === "facilitation"}
          onOpen={(open) => setMenu(open ? "facilitation" : null)}
          canFacilitate={canFacilitate}
          voteRunning={voteRunning}
          voteHint={voteHint}
          timerRunning={timerRunning}
          timerHint={timerHint}
          followers={myFollowers}
          onTimer={() => {
            setMenu(null);
            setTimerOpen(true);
          }}
          onVote={() => {
            setMenu(null);
            setVoteOpen(true);
          }}
          onFollow={() => {
            setMenu(null);
            setFollowOpen(true);
          }}
          onReact={onReact}
        />
        <MoreMenu
          view={menu === "more" || menu === "templates" ? menu : null}
          onView={setMenu}
          templates={templates}
          canAskAgents={canAskAgents}
          canUseApps={canUseApps}
          writeBlocked={writeBlocked}
          onTemplate={(key) => {
            setMenu(null);
            addTemplate(key);
          }}
          onAi={() => {
            setMenu(null);
            setAgentOpen(true);
          }}
          onApps={() => {
            setMenu(null);
            setAppsOpen(true);
          }}
        />

        <Separator vertical />

        <SyncLine
          saveState={saveState}
          label={saveLabel}
          title={saveTitle}
          readOnly={readOnly}
        />

        <Separator vertical />

        <div className="topbar-presence">
          <AccountMenu
            open={menu === "account"}
            onOpen={(open) => setMenu(open ? "account" : null)}
            name={name}
            self={self}
            color={identity.color}
            signedIn={Boolean(me)}
            handle={me?.handle ?? ""}
            roleLine={roleLine}
            identityName={identity.name}
            onRenameSelf={renameSelf}
            onAccountRenamed={onAccountRenamed}
            orgName={orgName}
            onOrg={() => setAccountOpen(true)}
            onSessions={() => setSessionsOpen(true)}
            onSignIn={() => setAuthOpen(true)}
            onSignOut={onSignOut}
          />
          <Peers
            peers={peers}
            followTarget={follow.target}
            onToggleFollow={toggleFollow}
            myFollowers={myFollowers}
            canFacilitate={canFacilitate}
            otherPeers={otherPeers}
            followOpen={followOpen}
            onFollow={() => setFollowOpen(true)}
          />
        </div>

        <Tooltip label={t("board.properties")}>
          <IconButton
            icon="panel"
            label={t("board.properties")}
            selected={inspectorOpen}
            onClick={toggleInspector}
          />
        </Tooltip>
        <Tooltip label={t("presentation.start")}>
          <IconButton
            icon="play"
            label={t("presentation.start")}
            selected={presentOpen}
            onClick={() => setPresentOpen(true)}
          />
        </Tooltip>
        <Tooltip
          label={
            commentsUnread
              ? t("board.unreadComments", { n: commentsUnread })
              : t("board.discussion")
          }
        >
          <IconButton
            icon="comment"
            label={
              commentsUnread
                ? t("board.unreadComments", { n: commentsUnread })
                : t("board.discussion")
            }
            count={commentsUnread || undefined}
            selected={commentsOpen}
            onClick={() => setCommentsOpen(!commentsOpen)}
          />
        </Tooltip>

        <Button
          variant="primary"
          className="share-button"
          onClick={() => (canShare ? setShareOpen(true) : void copyShareLink())}
          title={canShare ? t("share.title") : t("board.copyLinkTitle")}
        >
          {copied ? t("board.copied") : t("board.share")}
        </Button>
        <InterfaceToggles theme={theme} onTheme={setTheme} />
      </div>
    </header>
    <SessionsDialog
      open={sessionsOpen}
      onClose={() => setSessionsOpen(false)}
      onCurrentRevoked={() => {
        setSessionsOpen(false);
        onSignOut();
      }}
    />
    </>
  );
}

export type { MenuView };
