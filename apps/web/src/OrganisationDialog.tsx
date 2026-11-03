import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  ORG_ROLES,
  type AuditEvent,
  type OrgInvitation,
  type OrgMember,
  type OrgRole,
  type OrgSummary,
  type SessionUser,
} from "./api";
import { formatMoment, initials } from "./format";
import { AgentsPanel } from "./AgentsPanel";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import { ABOUT } from "./about";

/**
 * The organisation screen: who is here, what they administer, and what happened.
 *
 * It is one dialog with two tabs rather than a settings area, because an organisation
 * in v1 has exactly two questions — "who is in it" and "what has been done" — and both
 * are read from the same place. What the caller may do is decided by the server on
 * every mutation; the screen only hides what would be refused (spec/IAM-v1.md §3).
 *
 * People with the `member` relation see the list. Guests see only that they are a
 * guest: the people directory of an organisation is not theirs to read (IAM-09).
 */
export function OrganisationDialog({
  open,
  me,
  onClose,
  onSignedOut,
}: {
  open: boolean;
  me: SessionUser;
  onClose: () => void;
  /** The session ended, so the app must drop its own copy of the user. */
  onSignedOut: () => void;
}) {
  const { t, lang } = useI18n();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [membership, setMembership] = useState<{ relation: string; state: string } | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<"people" | "audit" | "agents">("people");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Which person's role checkboxes are open. */
  const [editingRoles, setEditingRoles] = useState<string | null>(null);
  /** Which person is waiting for the second click that removes them. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** A removal refused because the person still owns boards (409). */
  const [blocked, setBlocked] = useState<{
    userId: string;
    boards: { id: string; title: string }[];
  } | null>(null);

  const isUserAdmin = roles.includes("org_admin") || roles.includes("user_admin");
  const isOrgAdmin = roles.includes("org_admin");
  const seesAudit = roles.includes("org_admin") || roles.includes("security_admin");
  const isGuest = membership?.relation === "guest";

  /** One place that turns a refusal code into a sentence a person can act on. */
  const describe = useCallback(
    (failure: unknown): string => {
      const code = failure instanceof ApiError ? failure.code : "";
      switch (code) {
        case "LAST_ADMIN":
          return t("org.lastAdmin");
        case "FORBIDDEN":
          return t("org.forbidden");
        case "ALREADY_MEMBER":
          return t("org.alreadyMember");
        case "BAD_EMAIL":
          return t("org.badEmail");
        case "TARGET_NOT_MEMBER":
          return t("org.targetNotMember");
        case "RESOURCE_NOT_AVAILABLE":
          return t("org.gone");
        default:
          return failure instanceof Error ? failure.message : t("org.failed");
      }
    },
    [t],
  );

  /** The organisation list is re-read every time the screen opens: invitations change it. */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    void api
      .orgs()
      .then(({ orgs: next }) => {
        if (!alive) return;
        setOrgs(next);
        setOrgId((current) => {
          if (current && next.some((candidate) => candidate.id === current)) return current;
          const first =
            next.find((candidate) => candidate.relation === "member" && candidate.state === "active") ??
            next[0];
          return first?.id ?? null;
        });
      })
      .catch((failure: unknown) => {
        if (alive) setError(describe(failure));
      });
    return () => {
      alive = false;
    };
  }, [open, lang, describe]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const detail = await api.org(id);
      setOrg(detail.org);
      setMembership(detail.membership);
      setRoles(detail.roles);

      if (detail.membership.relation !== "member" || detail.membership.state !== "active") {
        setMembers([]);
        setInvitations([]);
        setAudit([]);
        setTeams([]);
        return;
      }

      setTeams((await api.teams(id)).teams);
      const list = await api.members(id);
      setMembers(list.members);

      const manages = detail.roles.includes("org_admin") || detail.roles.includes("user_admin");
      setInvitations(manages ? (await api.invitations(id)).invitations : []);

      const reads = detail.roles.includes("org_admin") || detail.roles.includes("security_admin");
      setAudit(reads ? (await api.audit(id)).events : []);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setLoading(false);
    }
  }, [describe]);

  useEffect(() => {
    if (!open || !orgId) return;
    // A different organisation starts clean: a link or a refusal belongs to one of them.
    setInviteUrl(null);
    setCopied(false);
    setEditingRoles(null);
    setConfirmRemove(null);
    setBlocked(null);
    setError(null);
    setTab("people");
    void load(orgId);
  }, [open, orgId, load]);

  if (!open) return null;

  /** Run a mutation, then reload the screen so it shows the new truth, not a guess. */
  async function run(action: () => Promise<unknown>) {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load(orgId);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeMember(orgId, userId);
      setConfirmRemove(null);
      setBlocked(null);
      await load(orgId);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "OWNER_TRANSFER_REQUIRED") {
        const boards = Array.isArray(failure.details.boards)
          ? (failure.details.boards as { id: string; title: string }[])
          : [];
        setBlocked({ userId, boards });
        setConfirmRemove(null);
      } else {
        setError(describe(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await api.logout();
      onSignedOut();
      onClose();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }

  function personLabel(id: string): string {
    return members.find((member) => member.id === id)?.name ?? id.slice(0, 8);
  }

  function roleLabel(role: string): string {
    const labels = {
      org_admin: "org.role.org_admin",
      user_admin: "org.role.user_admin",
      security_admin: "org.role.security_admin",
    } as const;
    const key = labels[role as keyof typeof labels];
    return key ? t(key) : role;
  }

  function auditSubject(event: AuditEvent): string | null {
    if (!event.subject) return null;
    if (event.action === "admin.grant" || event.action === "admin.revoke") {
      const [userId = "", role = ""] = event.subject.split(":");
      return `${personLabel(userId)} · ${roleLabel(role)}`;
    }
    if (
      event.action === "member.suspend" ||
      event.action === "member.restore" ||
      event.action === "member.remove"
    ) {
      return personLabel(event.subject);
    }
    return event.subject;
  }

  const AUDIT_LABEL = {
    "auth.register": "audit.register",
    "auth.login": "audit.login",
    "auth.logout": "audit.logout",
    "auth.password_changed": "audit.password",
    "org.create": "audit.orgCreate",
    "team.create": "audit.teamCreate",
    "board.create": "audit.boardCreate",
    "board.claim": "audit.boardClaim",
    "board.transfer": "audit.boardTransfer",
    "grant.put": "audit.grantPut",
    "grant.delete": "audit.grantDelete",
    "invitation.create": "audit.inviteCreate",
    "invitation.revoke": "audit.inviteRevoke",
    "invitation.accept": "audit.inviteAccept",
    "guest.invite": "audit.guestInvite",
    "admin.grant": "audit.adminGrant",
    "admin.revoke": "audit.adminRevoke",
    "member.suspend": "audit.memberSuspend",
    "member.restore": "audit.memberRestore",
    "member.remove": "audit.memberRemove",
    "link.enable": "audit.linkEnable",
    "link.disable": "audit.linkDisable",
    "agent.create": "audit.agentCreate",
    "agent.update": "audit.agentUpdate",
    "agent.token.create": "audit.agentTokenCreate",
    "agent.token.revoke": "audit.agentTokenRevoke",
    "agent.policy.update": "audit.agentPolicy",
    "agent.task.create": "audit.agentTaskCreate",
    "agent.task.finish": "audit.agentTaskFinish",
    "agent.task.cancel": "audit.agentTaskCancel",
    "agent.write": "audit.agentWrite",
    "agent.denied": "audit.agentDenied",
    "agent.schedule.create": "audit.agentScheduleCreate",
    "agent.schedule.delete": "audit.agentScheduleDelete",
    "agent.plan.propose": "audit.agentPlanPropose",
    "agent.plan.approved": "audit.agentPlanApproved",
    "agent.plan.rejected": "audit.agentPlanRejected",
    "agent.plan.applied": "audit.agentPlanApplied",
    "board.agents.update": "audit.boardAgents",
    "skill.create": "audit.skillCreate",
    "skill.publish": "audit.skillPublish",
    "ai.credential.create": "audit.aiKeyCreate",
    "ai.credential.rotate": "audit.aiKeyRotate",
    "ai.credential.delete": "audit.aiKeyDelete",
    "ai.credential.default": "audit.aiKeyDefault",
    "ai.policy.update": "audit.aiPolicy",
    "agent.change_set.create": "audit.changeSetCreate",
    "agent.change_set.execute": "audit.changeSetExecute",
    "agent.change_set.cancel": "audit.changeSetCancel",
    "agent.change_set.resume": "audit.changeSetResume",
  } as const;

  function auditLabel(action: string): string {
    const key = AUDIT_LABEL[action as keyof typeof AUDIT_LABEL];
    return key ? t(key) : action;
  }

  const createOrg = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newOrgName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createOrg(newOrgName.trim());
      const next = await api.orgs();
      setOrgs(next.orgs);
      setOrgId(created.org.id);
      setCreatingOrg(false);
      setNewOrgName("");
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  const createTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId || !newTeamName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTeam(orgId, newTeamName.trim());
      setNewTeamName("");
      await load(orgId);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  const manageable = members.filter((member) => member.relation === "member" && member.state !== "suspended");

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="org-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("org.title")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="org-head">
          <div>
            <h2>{org?.name ?? t("org.title")}</h2>
            <p className="muted">
              {isGuest ? t("org.guestBody") : t("org.memberCount", { n: members.length })}
            </p>
          </div>
          <div className="org-head-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setCreatingOrg((value) => !value)}
            >
              + {t("org.newOrg")}
            </button>
            <button type="button" className="dialog-close" onClick={onClose} aria-label={t("org.close")}>
              ×
            </button>
          </div>
        </header>

        {creatingOrg && (
          <form className="org-create" onSubmit={createOrg}>
            <input
              autoFocus
              value={newOrgName}
              maxLength={120}
              placeholder={t("org.orgNamePlaceholder")}
              aria-label={t("org.orgNamePlaceholder")}
              onChange={(event) => setNewOrgName(event.target.value)}
            />
            <button type="submit" className="primary-button" disabled={busy || !newOrgName.trim()}>
              {t("org.createOrg")}
            </button>
          </form>
        )}

        {orgs.length > 1 && (
          <label className="org-switch">
            <span className="muted">{t("org.choose")}</span>
            <select value={orgId ?? ""} onChange={(event) => setOrgId(event.target.value)}>
              {orgs.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!isGuest && (
          <nav className="org-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "people"}
              className={tab === "people" ? "active" : undefined}
              onClick={() => setTab("people")}
            >
              {t("org.people")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agents"}
              className={tab === "agents" ? "active" : undefined}
              onClick={() => setTab("agents")}
            >
              {t("org.agents")}
            </button>
            {seesAudit && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "audit"}
                className={tab === "audit" ? "active" : undefined}
                onClick={() => setTab("audit")}
              >
                {t("org.audit")}
              </button>
            )}
          </nav>
        )}

        {error && <p className="auth-error">{error}</p>}
        {!orgId && !error && <p className="muted">{t("org.noOrg")}</p>}

        {!isGuest && tab === "people" && (
          <>
            <section className="org-teams">
              <h3>{t("org.teams")}</h3>
              {teams.length ? (
                <ul className="org-team-list">
                  {teams.map((team) => (
                    <li key={team.id}>{team.name}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t("org.noTeams")}</p>
              )}
              {isOrgAdmin && (
                <form className="org-create" onSubmit={createTeam}>
                  <input
                    value={newTeamName}
                    maxLength={120}
                    placeholder={t("org.teamNamePlaceholder")}
                    aria-label={t("org.teamNamePlaceholder")}
                    onChange={(event) => setNewTeamName(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="ghost-button"
                    disabled={busy || !newTeamName.trim()}
                  >
                    + {t("org.createTeam")}
                  </button>
                </form>
              )}
            </section>

            {isUserAdmin && (
              <form
                className="org-invite"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!orgId || !inviteEmail.trim()) return;
                  void run(async () => {
                    const created = await api.inviteMember(orgId, inviteEmail.trim());
                    setInviteUrl(created.url);
                    setInviteEmail("");
                    setCopied(false);
                  });
                }}
              >
                <input
                  type="email"
                  value={inviteEmail}
                  placeholder={t("org.invitePlaceholder")}
                  aria-label={t("org.invitePlaceholder")}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy || !inviteEmail.trim()}
                >
                  {t("org.invite")}
                </button>
              </form>
            )}

            {inviteUrl && (
              <div className="share-invite">
                <p className="muted">{t("org.inviteReady")}</p>
                <div className="share-link-url">
                  <input readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(inviteUrl);
                      setCopied(true);
                    }}
                  >
                    {copied ? t("org.copied") : t("org.copy")}
                  </button>
                </div>
              </div>
            )}

            {isUserAdmin && invitations.length > 0 && (
              <section className="org-pending">
                <h3>{t("org.pending")}</h3>
                <ul>
                  {invitations.map((invitation) => (
                    <li key={invitation.id}>
                      <span className="org-pending-email">{invitation.email}</span>
                      <span className="muted">
                        {t("org.expires", { date: formatMoment(invitation.expires_at, lang) })}
                      </span>
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() =>
                          orgId &&
                          void run(() => api.revokeInvitation(orgId, invitation.id))
                        }
                      >
                        {t("org.revoke")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <ul className="org-people">
              {members.map((member) => {
                const self = member.id === me.id;
                const ownsBlocked = blocked?.userId === member.id;
                return (
                  <li key={member.id} className="org-person">
                    <div className="org-person-main">
                      <span className="org-avatar" aria-hidden="true">
                        {initials(member.name) || "?"}
                      </span>
                      <div className="org-person-name">
                        <div>
                          <strong>{member.name}</strong>
                          {self && <span className="org-badge you">{t("org.you")}</span>}
                        </div>
                        <span className="muted">{member.email}</span>
                        <div className="org-badges">
                          {member.relation === "guest" && (
                            <span className="org-badge guest">{t("org.guest")}</span>
                          )}
                          {member.state === "suspended" && (
                            <span className="org-badge suspended">{t("org.suspended")}</span>
                          )}
                          {member.roles.map((role) => (
                            <span key={role} className="org-badge admin">
                              {roleLabel(role)}
                            </span>
                          ))}
                        </div>
                      </div>

                      {isUserAdmin && !self && member.relation === "member" && (
                        <div className="org-person-actions">
                          {isOrgAdmin && (
                            <button
                              type="button"
                              className="link-button"
                              aria-expanded={editingRoles === member.id}
                              onClick={() =>
                                setEditingRoles((current) =>
                                  current === member.id ? null : member.id,
                                )
                              }
                            >
                              {t("org.rolesAction")}
                            </button>
                          )}
                          {member.state === "suspended" ? (
                            <button
                              type="button"
                              className="link-button"
                              disabled={busy}
                              onClick={() => orgId && void run(() => api.restoreMember(orgId, member.id))}
                            >
                              {t("org.restore")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="link-button"
                              disabled={busy}
                              onClick={() => orgId && void run(() => api.suspendMember(orgId, member.id))}
                            >
                              {t("org.suspend")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="link-button danger"
                            disabled={busy}
                            onClick={() => setConfirmRemove(member.id)}
                          >
                            {t("org.remove")}
                          </button>
                        </div>
                      )}
                    </div>

                    {isOrgAdmin && editingRoles === member.id && (
                      <div className="org-role-editor">
                        {ORG_ROLES.map((role) => (
                          <label key={role}>
                            <input
                              type="checkbox"
                              checked={member.roles.includes(role)}
                              disabled={busy}
                              onChange={(event) => {
                                const next = event.target.checked;
                                void run(async () => {
                                  if (!orgId) return;
                                  if (next) {
                                    await api.setAdminRole(orgId, member.id, role);
                                  } else {
                                    await api.removeAdminRole(orgId, member.id, role);
                                  }
                                });
                              }}
                            />
                            {roleLabel(role)}
                          </label>
                        ))}
                      </div>
                    )}

                    {confirmRemove === member.id && (
                      <div className="org-confirm">
                        <p>{t("org.removeConfirm", { name: member.name })}</p>
                        <div>
                          <button
                            type="button"
                            className="primary-button danger"
                            disabled={busy}
                            onClick={() => void removeMember(member.id)}
                          >
                            {t("org.removeYes")}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => setConfirmRemove(null)}
                          >
                            {t("org.cancel")}
                          </button>
                        </div>
                      </div>
                    )}

                    {ownsBlocked && (
                      <div className="org-blocked">
                        <p>
                          {blocked.boards.length
                            ? t("org.ownsBoards")
                            : t("org.removeBlocked")}
                        </p>
                        {blocked.boards.length > 0 && (
                          <>
                            <ul>
                              {blocked.boards.map((board) => (
                                <li key={board.id}>{board.title}</li>
                              ))}
                            </ul>
                            <p className="muted">{t("org.transferHint")}</p>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {loading && !members.length && <li className="muted">{t("org.loading")}</li>}
            </ul>

            {isUserAdmin && (
              <p className="muted org-note">
                {manageable.length > 1 ? t("org.seatNote") : t("org.seatNoteOne")}
              </p>
            )}
          </>
        )}

        {!isGuest && tab === "agents" && orgId && (
          <AgentsPanel
            orgId={orgId}
            isOrgAdmin={isOrgAdmin}
            canReadJournal={seesAudit}
            meId={me.id}
          />
        )}

        {!isGuest && tab === "audit" && (
          <ul className="org-audit">
            {audit.map((event) => {
              const subject = auditSubject(event);
              return (
                <li key={event.id}>
                  <div className="org-audit-head">
                    <strong>{auditLabel(event.action)}</strong>
                    <span className="muted">{formatMoment(event.at, lang)}</span>
                  </div>
                  <div className="org-audit-meta muted">
                    {event.actor_name ?? t("org.unknownActor")}
                    {subject ? ` · ${subject}` : ""}
                    {event.board_title ? ` · ${event.board_title}` : ""}
                  </div>
                </li>
              );
            })}
            {!audit.length && <li className="muted">{t("org.auditEmpty")}</li>}
          </ul>
        )}

        <footer className="org-foot">
          <HelpLink topicId="about.remo">{`${ABOUT.name} ${ABOUT.version} · ${ABOUT.license}`}</HelpLink>
          <span className="muted">{me.email}</span>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => void signOut()}>
            {t("org.signOut")}
          </button>
        </footer>
      </section>
    </div>
  );
}
