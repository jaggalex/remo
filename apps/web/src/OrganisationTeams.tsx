import { useState } from "react";
import { Button, ConfirmDialog, Input, Select } from "@remo/ui";
import { api, ApiError, type OrgMember } from "./api";
import { useI18n } from "./i18n";

/** One team's membership as the server returns it. */
interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
}

/**
 * Team editing inside the organisation screen: rename, delete and membership.
 *
 * The team is an access subject: a board grant can name it, and membership decides who
 * inherits that grant. The server enforces every mutation; this panel only offers what
 * the caller may do.
 */
export function OrganisationTeams({
  orgId,
  teams,
  members,
  canManage,
  onChanged,
  onError,
}: {
  orgId: string;
  teams: Array<{ id: string; name: string }>;
  members: OrgMember[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMember[]>>({});
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "member">("member");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [usage, setUsage] = useState<{ boards: number; grants: number } | null>(null);

  const describe = (failure: unknown): string => {
    const code = failure instanceof ApiError ? failure.code : "";
    if (code === "TEAM_NAME_TAKEN") return t("org.teamNameTaken");
    if (code === "TEAM_IN_USE") {
      const details = failure instanceof ApiError ? failure.details : {};
      const boards = Number(details.boards ?? 0);
      const grants = Number(details.grants ?? 0);
      setUsage({ boards, grants });
      return t("org.teamInUse", { boards, grants });
    }
    if (code === "FORBIDDEN") return t("org.forbidden");
    return failure instanceof Error ? failure.message : t("org.failed");
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setUsage(null);
    try {
      await action();
      await onChanged();
    } catch (failure) {
      onError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  const loadMembers = async (teamId: string) => {
    try {
      const result = await api.teamMembers(orgId, teamId);
      setTeamMembers((current) => ({ ...current, [teamId]: result.members }));
    } catch (failure) {
      onError(describe(failure));
    }
  };

  const toggleMembers = async (teamId: string) => {
    if (expanded === teamId) {
      setExpanded(null);
      return;
    }
    setExpanded(teamId);
    setSelectedUser("");
    setSelectedRole("member");
    await loadMembers(teamId);
  };

  const available = (teamId: string) => {
    const taken = new Set((teamMembers[teamId] ?? []).map((member) => member.id));
    return members
      .filter(
        (member) =>
          member.relation === "member" && member.state === "active" && !taken.has(member.id),
      )
      .map((member) => ({ value: member.id, label: `${member.name} · ${member.email}` }));
  };

  return (
    <section className="org-teams">
      <h3>{t("org.teams")}</h3>
      {teams.length ? (
        <ul className="org-team-list">
          {teams.map((team) => (
            <li key={team.id}>
              <div className="org-team-row">
                {editing === team.id ? (
                  <>
                    <Input
                      size="compact"
                      value={draft}
                      maxLength={120}
                      aria-label={t("org.teamRename")}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <Button
                      size="compact"
                      variant="primary"
                      loading={busy}
                      disabled={!draft.trim()}
                      onClick={() =>
                        void run(async () => {
                          await api.renameTeam(orgId, team.id, draft.trim());
                          setEditing(null);
                        })
                      }
                    >
                      {t("org.save")}
                    </Button>
                    <Button size="compact" variant="ghost" onClick={() => setEditing(null)}>
                      {t("org.cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="org-team-name">{team.name}</span>
                    {canManage && (
                      <>
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() => {
                            setEditing(team.id);
                            setDraft(team.name);
                          }}
                        >
                          {t("org.rename")}
                        </Button>
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() => void toggleMembers(team.id)}
                        >
                          {t("org.teamMembers")}
                        </Button>
                        <Button
                          size="compact"
                          variant="danger"
                          onClick={() => setPendingDelete(team)}
                        >
                          {t("org.teamDelete")}
                        </Button>
                      </>
                    )}
                  </>
                )}
              </div>

              {expanded === team.id && (
                <div className="org-team-members">
                  <h4>{t("org.teamMembers")}</h4>
                  {(teamMembers[team.id] ?? []).length ? (
                    <ul className="org-team-member-list">
                      {(teamMembers[team.id] ?? []).map((member) => (
                        <li key={member.id} className="org-team-member">
                          <span>
                            {member.name} · {member.email}
                          </span>
                          <span className="muted">
                            {member.role === "admin"
                              ? t("org.teamRoleAdmin")
                              : t("org.teamRoleMember")}
                          </span>
                          {canManage && (
                            <Button
                              size="compact"
                              variant="ghost"
                              onClick={() =>
                                void run(async () => {
                                  await api.removeTeamMember(orgId, team.id, member.id);
                                  await loadMembers(team.id);
                                })
                              }
                            >
                              {t("org.teamMemberRemove")}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">{t("org.teamNoMembers")}</p>
                  )}

                  {canManage && available(team.id).length > 0 && (
                    <div className="org-team-add">
                      <Select
                        size="compact"
                        aria-label={t("org.teamMemberPlaceholder")}
                        value={selectedUser}
                        onChange={(event) => setSelectedUser(event.target.value)}
                        options={[
                          { value: "", label: t("org.teamMemberPlaceholder") },
                          ...available(team.id),
                        ]}
                      />
                      <Select
                        size="compact"
                        aria-label={t("org.teamMemberRole")}
                        value={selectedRole}
                        onChange={(event) =>
                          setSelectedRole(event.target.value === "admin" ? "admin" : "member")
                        }
                        options={[
                          { value: "member", label: t("org.teamRoleMember") },
                          { value: "admin", label: t("org.teamRoleAdmin") },
                        ]}
                      />
                      <Button
                        size="compact"
                        variant="primary"
                        loading={busy}
                        disabled={!selectedUser}
                        onClick={() =>
                          void run(async () => {
                            await api.addTeamMember(orgId, team.id, selectedUser, selectedRole);
                            setSelectedUser("");
                            await loadMembers(team.id);
                          })
                        }
                      >
                        {t("org.teamMemberAdd")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("org.noTeams")}</p>
      )}

      {canManage && (
        <form
          className="org-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim()) return;
            void run(async () => {
              await api.createTeam(orgId, newName.trim());
              setNewName("");
            });
          }}
        >
          <Input
            size="compact"
            value={newName}
            maxLength={120}
            placeholder={t("org.teamNamePlaceholder")}
            aria-label={t("org.teamNamePlaceholder")}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            type="submit"
            size="compact"
            variant="primary"
            loading={busy}
            disabled={!newName.trim()}
          >
            + {t("org.createTeam")}
          </Button>
        </form>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t("org.teamDeleteTitle", { name: pendingDelete.name })}
          confirmLabel={t("org.teamDelete")}
          loading={busy}
          onCancel={() => {
            setPendingDelete(null);
            setUsage(null);
          }}
          onConfirm={() =>
            void run(async () => {
              await api.deleteTeam(orgId, pendingDelete.id);
              setPendingDelete(null);
            })
          }
        >
          <p>{t("org.teamDeleteBody")}</p>
          {usage && <p className="auth-error">{t("org.teamInUse", usage)}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
