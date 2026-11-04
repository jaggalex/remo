import { useState } from "react";
import type { Camera } from "@remo/canvas";
import type { AgentPlan, AppliedAgentPlan } from "@remo/doc";
import type { Widget } from "@remo/model";
import type { Access, SessionUser } from "./api";
import type { OrgSummary } from "./api";
import { AgentDialog } from "./AgentDialog";
import { TidyDialog } from "./TidyDialog";
import type { TidyCommand } from "./useTidyCommand";
import { BoardDeleteDialog } from "./BoardDeleteDialog";
import { BoardsPanel } from "./BoardsPanel";
import { OrganisationDialog } from "./OrganisationDialog";
import { SettingsPanel } from "./SettingsPanel";
import { loadActiveOrg, saveActiveOrg } from "./activeOrg";
import { useI18n } from "./i18n";
import type { BoardSettings } from "./settings";

/**
 * The screens that hang off the board, not the board itself.
 *
 * Organisation, AI, settings, the board list and the trash open from the header menus;
 * keeping them here means `App` composes and the file stays inside the Q4 size ratchet
 * (ADR-119 № 10 postponed this until the forms moved — S5a is that step).
 */
export function BoardPanels({
  accountOpen,
  me,
  onCloseAccount,
  onSignedOut,
  agentOpen,
  tidy,
  boardId,
  boardTitle,
  access,
  camera,
  selectedIds,
  widgets,
  onApplyPlan,
  onCloseAgent,
  onOpenOrg,
  settingsOpen,
  settings,
  onChangeSettings,
  onCloseSettings,
  boardsOpen,
  orgs,
  refreshOrgs,
  boardOrgId,
  onCloseBoards,
  onOpenBoard,
  trashOpen,
  onCloseTrash,
  onConfirmTrash,
}: {
  accountOpen: boolean;
  me: SessionUser | null;
  onCloseAccount: () => void;
  onSignedOut: () => void;
  agentOpen: boolean;
  tidy: TidyCommand;
  boardId: string;
  boardTitle: string;
  access: Access | null;
  camera: Camera;
  selectedIds: string[];
  widgets: Widget[];
  onApplyPlan: (
    plan: AgentPlan,
    provenance: Widget["agent"],
    options?: { allowedIds?: string[] },
  ) => AppliedAgentPlan;
  onCloseAgent: () => void;
  onOpenOrg: () => void;
  settingsOpen: boolean;
  settings: BoardSettings;
  onChangeSettings: (value: BoardSettings) => void;
  onCloseSettings: () => void;
  boardsOpen: boolean;
  orgs: OrgSummary[];
  refreshOrgs: () => void | Promise<void>;
  /** The organisation of the open board; null for a legacy room. */
  boardOrgId: string | null;
  onCloseBoards: () => void;
  onOpenBoard: (boardId: string, widgetId?: string, template?: string, name?: string) => void;
  trashOpen: boolean;
  onCloseTrash: () => void;
  onConfirmTrash: () => void;
}) {
  const { t } = useI18n();
  const [storedOrg, setStoredOrg] = useState<string | null>(() => loadActiveOrg());
  // A stored id can name an organisation this account has left; treat it as "all".
  const activeOrgId = storedOrg && orgs.some((org) => org.id === storedOrg) ? storedOrg : null;
  const chooseOrg = (orgId: string | null) => {
    setStoredOrg(orgId);
    saveActiveOrg(orgId);
  };
  return (
    <>
      {me && (
        <OrganisationDialog
          open={accountOpen}
          me={me}
          initialOrgId={activeOrgId ?? boardOrgId}
          onOrgsChanged={refreshOrgs}
          onClose={onCloseAccount}
          onSignedOut={onSignedOut}
        />
      )}
      {trashOpen && (
        <BoardDeleteDialog
          title={boardTitle || t("board.untitled")}
          objects={widgets.length}
          linkEnabled={false}
          onCancel={onCloseTrash}
          onConfirm={onConfirmTrash}
        />
      )}
      <AgentDialog
        open={agentOpen}
        boardId={boardId}
        boardTitle={boardTitle}
        canManage={Boolean(access?.capabilities.includes("board.manage"))}
        canEdit={Boolean(access?.capabilities.includes("board.edit"))}
        origin={{ x: camera.x, y: camera.y }}
        selectionIds={selectedIds}
        widgets={widgets}
        onApplyPlan={onApplyPlan}
        onClose={onCloseAgent}
        onOpenOrg={onOpenOrg}
      />
      <TidyDialog
        open={tidy.open}
        boardId={boardId}
        selectionIds={tidy.ids}
        widgets={widgets}
        canEdit={Boolean(access?.capabilities.includes("board.edit"))}
        origin={{ x: camera.x, y: camera.y }}
        onApplyPlan={onApplyPlan}
        onClose={tidy.close}
        onOpenAgents={tidy.openAgents}
      />
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={onChangeSettings}
        onClose={onCloseSettings}
      />
      <BoardsPanel
        open={boardsOpen}
        onClose={onCloseBoards}
        orgs={orgs}
        activeOrgId={activeOrgId}
        fallbackOrgId={boardOrgId}
        onActiveOrg={chooseOrg}
        onOpenBoard={onOpenBoard}
      />
    </>
  );
}
