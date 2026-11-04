import type { Camera } from "@remo/canvas";
import type { AgentPlan, AppliedAgentPlan } from "@remo/doc";
import type { Widget } from "@remo/model";
import type { Access, SessionUser } from "./api";
import { AgentDialog } from "./AgentDialog";
import { TidyDialog } from "./TidyDialog";
import type { TidyCommand } from "./useTidyCommand";
import { BoardDeleteDialog } from "./BoardDeleteDialog";
import { OrganisationDialog } from "./OrganisationDialog";
import { SettingsPanel } from "./SettingsPanel";
import { useI18n } from "./i18n";
import type { BoardSettings } from "./settings";

/**
 * The screens that hang off the board, not the board itself.
 *
 * Organisation, AI, settings and the trash open from the board chrome; the board list
 * itself is the organisation home (ADR-168), not an overlay. Keeping these here means
 * `BoardApp` composes and the file stays inside the Q4 size ratchet.
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
  refreshOrgs,
  boardOrgId,
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
  refreshOrgs: () => void | Promise<void>;
  /** The organisation of the open board; null for a legacy room. */
  boardOrgId: string | null;
  trashOpen: boolean;
  onCloseTrash: () => void;
  onConfirmTrash: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {me && (
        <OrganisationDialog
          open={accountOpen}
          me={me}
          initialOrgId={boardOrgId}
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
    </>
  );
}
