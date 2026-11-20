import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  ORG_ROLES,
  type AuditEvent,
  type OrgInvitation,
  type OrgMember,
  type OrgRole,
  type SessionUser,
} from "./api";
import { formatMoment, initials } from "./format";
import { AgentsPanel } from "./AgentsPanel";
import { OrganisationTeams } from "./OrganisationTeams";
import { Button, Checkbox, Dialog, Input, Tabs } from "@remo/ui";
import { useI18n } from "./i18n";
import { EmailVerificationNeeded, InviteSent } from "./InviteFeedback";
import { HelpLink } from "./help/HelpLink";
import { ABOUT, ABOUT_LABEL } from "./about";

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
  initialOrgId = null,
  initialTab = "people",
  onOrgsChanged,
  onClose,
  onSignedOut,
}: {
  open: boolean;
  me: SessionUser;
  /** The organisation chosen in the directory (ADR-166); null means "pick one". */
  initialOrgId?: string | null;
  /** Which tab the caller wants first; the room agent settings open "agents". */
  initialTab?: "people" | "audit" | "agents";
  /** The directory list changed: a new organisation or a new name. */
  onOrgsChanged?: () => void | Promise<void>;
  onClose: () => void;
  /** The session ended, so the app must drop its own copy of the user. */
  onSignedOut: () => void;
}) {
  const { t, lang } = useI18n();
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [renamingOrg, setRenamingOrg] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<{
    id: string;
    name: string;
    slug: string;
    kind: "personal" | "shared";
  } | null>(null);
  const [membership, setMembership] = useState<{ relation: string; state: string } | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<"people" | "audit" | "agents">(initialTab);
  const openedTab = useRef<"people" | "audit" | "agents">(initialTab);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  const [inviteNeedsVerification, setInviteNeedsVerification] = useState(false);
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
        case "EMAIL_NOT_VERIFIED":
          return t("mail.inviteNeedsVerified");
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
    openedTab.current = initialTab;
    let alive = true;
    setError(null);
    void api
      .orgs()
      .then(({ orgs: next }) => {
        if (!alive) return;
        setOrgId(() => {
          if (initialOrgId && next.some((candidate) => candidate.id === initialOrgId)) {
            return initialOrgId;
          }
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
  }, [open, lang, initialOrgId, describe]);

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
    setInviteSentTo(null);
    setInviteNeedsVerification(false);
    setCopied(false);
    setEditingRoles(null);
    setConfirmRemove(null);
    setBlocked(null);
    setRenamingOrg(false);
    setOrgNameDraft("");
    setError(null);
    setTab("people");
    void load(orgId);
  }, [open, orgId, load]);

  useEffect(() => {
    if (!open || !orgId) return;
    setTab(openedTab.current);
    openedTab.current = "people";
  }, [open, orgId]);

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

  async function renameOrg(event: React.FormEvent) {
    event.preventDefault();
    if (!orgId || !orgNameDraft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.renameOrg(orgId, orgNameDraft.trim());
      setOrg(result.org);
      await onOrgsChanged?.();
      setRenamingOrg(false);
    } catch (failure) {
      setError(describe(failure));
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
    "auth.profile_changed": "audit.profileName",
    "org.create": "audit.orgCreate",
    "org.rename": "audit.orgRename",
    "team.create": "audit.teamCreate",
    "team.rename": "audit.teamRename",
    "team.delete": "audit.teamDelete",
    "team.member.add": "audit.teamMemberAdd",
    "team.member.remove": "audit.teamMemberRemove",
    "board.create": "audit.boardCreate",
    "board.claim": "audit.boardClaim",
    "board.icon": "audit.boardIcon",
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
      await onOrgsChanged?.();
      setOrgId(created.org.id);
      setCreatingOrg(false);
      setNewOrgName("");
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  };

  const manageable = members.filter((member) => member.relation === "member" && member.state !== "suspended");

  return (
    <Dialog
      title={org?.name ?? t("org.title")}
      description={isGuest ? t("org.guestBody") : t("org.memberCount", { n: members.length })}
      size="lg"
      onClose={onClose}
    >
      <section className="org-dialog">
        <div className="org-head">
          {renamingOrg && org ? (
            <form className="org-rename" onSubmit={renameOrg}>
              <Input
                size="compact"
                value={orgNameDraft}
                maxLength={120}
                aria-label={t("org.renameOrg")}
                onChange={(event) => setOrgNameDraft(event.target.value)}
              />
              <Button
                type="submit"
                size="compact"
                variant="primary"
                loading={busy}
                disabled={!orgNameDraft.trim()}
              >
                {t("org.save")}
              </Button>
              <Button size="compact" variant="ghost" onClick={() => setRenamingOrg(false)}>
                {t("org.cancel")}
              </Button>
            </form>
          ) : (
            <div className="org-title">
              {org?.kind === "personal" && (
                <span className="org-badge personal">{t("org.personal")}</span>
              )}
              {isOrgAdmin && org && (
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    setRenamingOrg(true);
                    setOrgNameDraft(org.name);
                  }}
                >
                  {t("org.rename")}
                </Button>
              )}
            </div>
          )}
          <Button
            onClick={() => setCreatingOrg((value) => !value)}>
            + {t("org.newOrg")}
          </Button>
        </div>

        {creatingOrg && (
          <form className="org-create" onSubmit={createOrg}>
            <Input
              autoFocus
              value={newOrgName}
              maxLength={120}
              placeholder={t("org.orgNamePlaceholder")}
              aria-label={t("org.orgNamePlaceholder")}
              onChange={(event) => setNewOrgName(event.target.value)}
            />
            <Button variant="primary" type="submit" disabled={busy || !newOrgName.trim()}>
              {t("org.createOrg")}
            </Button>
          </form>
        )}

        {!isGuest && (
          <Tabs
            label={t("org.title")}
            tabs={[
              { id: "people", label: t("org.people") },
              { id: "agents", label: t("org.agents") },
              ...(seesAudit ? [{ id: "audit", label: t("org.audit") }] : []),
            ]}
            value={tab}
            onChange={(id) => setTab(id as typeof tab)}
          />
        )}

        {error && <p className="auth-error">{error}</p>}
        {!orgId && !error && <p className="muted">{t("org.noOrg")}</p>}

        {!isGuest && tab === "people" && (
          <>
            {orgId && (
              <OrganisationTeams
                orgId={orgId}
                teams={teams}
                members={members}
                canManage={isOrgAdmin}
                onChanged={() => load(orgId)}
                onError={setError}
              />
            )}

            {isUserAdmin && (
              <form
                className="org-invite"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!orgId || !inviteEmail.trim()) return;
                  void run(async () => {
                    setInviteSentTo(null);
                    setInviteNeedsVerification(false);
                    try {
                      const created = (await api.inviteMember(orgId, inviteEmail.trim())) as {
                        url: string;
                        emailQueued?: boolean;
                      };
                      setInviteUrl(created.url);
                      if (created.emailQueued) setInviteSentTo(inviteEmail.trim());
                      setInviteEmail("");
                      setCopied(false);
                    } catch (failure) {
                      if ((failure as { code?: string }).code === "EMAIL_NOT_VERIFIED") {
                        setInviteNeedsVerification(true);
                        return;
                      }
                      throw failure;
                    }
                  });
                }}
              >
                <Input
                  type="email"
                  value={inviteEmail}
                  placeholder={t("org.invitePlaceholder")}
                  aria-label={t("org.invitePlaceholder")}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <Button variant="primary"
                  type="submit"
                  disabled={busy || !inviteEmail.trim()}>
                  {t("org.invite")}
                </Button>
              </form>
            )}

            {inviteNeedsVerification && <EmailVerificationNeeded />}
            {inviteSentTo && <InviteSent email={inviteSentTo} />}

            {inviteUrl && (
              <div className="share-invite">
                <p className="muted">{t("org.inviteReady")}</p>
                <div className="share-link-url">
                  <Input readOnly aria-label={t("org.inviteReady")} value={inviteUrl} onFocus={(event) => event.target.select()} />
                  <Button
                    onClick={() => {
                      void navigator.clipboard?.writeText(inviteUrl);
                      setCopied(true);
                    }}>
                    {copied ? t("org.copied") : t("org.copy")}
                  </Button>
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
                      <Button variant="ghost" size="compact"
                        disabled={busy}
                        onClick={() =>
                          orgId &&
                          void run(() => api.revokeInvitation(orgId, invitation.id))
                        }>
                        {t("org.revoke")}
                      </Button>
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
                            <Button variant="ghost" size="compact"
                              aria-expanded={editingRoles === member.id}
                              onClick={() =>
                                setEditingRoles((current) =>
                                  current === member.id ? null : member.id,
                                )
                              }>
                              {t("org.rolesAction")}
                            </Button>
                          )}
                          {member.state === "suspended" ? (
                            <Button variant="ghost" size="compact"
                              disabled={busy}
                              onClick={() => orgId && void run(() => api.restoreMember(orgId, member.id))}>
                              {t("org.restore")}
                            </Button>
                          ) : (
                            <Button variant="ghost" size="compact"
                              disabled={busy}
                              onClick={() => orgId && void run(() => api.suspendMember(orgId, member.id))}>
                              {t("org.suspend")}
                            </Button>
                          )}
                          <Button variant="ghost" size="compact"
                            disabled={busy}
                            onClick={() => setConfirmRemove(member.id)}>
                            {t("org.remove")}
                          </Button>
                        </div>
                      )}
                    </div>

                    {isOrgAdmin && editingRoles === member.id && (
                      <div className="org-role-editor">
                        {ORG_ROLES.map((role) => (
                          <Checkbox key={role} label={roleLabel(role)}
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
                        ))}
                      </div>
                    )}

                    {confirmRemove === member.id && (
                      <div className="org-confirm">
                        <p>{t("org.removeConfirm", { name: member.name })}</p>
                        <div>
                          <Button variant="danger"
                            disabled={busy}
                            onClick={() => void removeMember(member.id)}>
                            {t("org.removeYes")}
                          </Button>
                          <Button
                            onClick={() => setConfirmRemove(null)}>
                            {t("org.cancel")}
                          </Button>
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
          <HelpLink topicId="about.remo">{`${ABOUT_LABEL} · ${ABOUT.license}`}</HelpLink>
          <span className="muted">{me.email}</span>
          <Button disabled={busy} onClick={() => void signOut()}>
            {t("org.signOut")}
          </Button>
        </footer>
      </section>
    </Dialog>
  );
}
