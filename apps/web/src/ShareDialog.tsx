import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Dialog, Input, Select } from "@remo/ui";
import { api, type Grant, type OrgMember } from "./api";
import { formatMoment } from "./format";
import { useI18n } from "./i18n";
import { EmailVerificationNeeded, InviteSent } from "./InviteFeedback";
import { HelpLink } from "./help/HelpLink";
import { roleSourceLine } from "./roleSource";

/**
 * Who can see this board, and with what rights.
 *
 * The dialog edits grants, not roles: a person is added at a role, and the server
 * decides what that role may do. The public link is a separate switch because it is a
 * separate kind of access — it cannot be revoked per person, and the copy says so
 * (ADR-063). Only an owner or co-owner sees the link controls.
 */
export function ShareDialog({
  open,
  boardId,
  boardTitle,
  orgId,
  meId,
  canTransfer,
  canManage,
  viewerRole,
  viewerSources,
  onClose,
  onChange,
}: {
  open: boolean;
  boardId: string;
  boardTitle: string;
  /** The board's organisation, used to offer ownership handover. */
  orgId?: string;
  /** The signed-in person, who cannot hand a board to themselves. */
  meId?: string;
  canTransfer: boolean;
  /** `board.manage`: team roles are a management decision (ADR-061). */
  canManage: boolean;
  /** The viewer's resulting role and the sources that produced it. */
  viewerRole: string | null;
  viewerSources: string[];
  /** Called after a change, so the app can refresh its own access view. */
  onChange: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [link, setLink] = useState<{
    enabled: boolean;
    role: string;
    hasPassword: boolean;
    expiresAt: string | null;
    expired: boolean;
    version: number;
  } | null>(null);
  const [confirmDraftSharing, setConfirmDraftSharing] = useState(false);
  const [linkPassword, setLinkPassword] = useState("");
  const [linkExpiry, setLinkExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Field-level refusals: a link error belongs next to the link control, not the header. */
  const [linkError, setLinkError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** An invitation link, when the person has no account yet. */
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  /** The address a letter was queued for, and the refusal that has a direct fix. */
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  /** Ownership handover: choose, then confirm. */
  const [transferTo, setTransferTo] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  const refresh = useCallback(async () => {
    if (!open) return;
    try {
      // Link state needs board.manage; an editor may share people without seeing it.
      // Calling it unconditionally made the whole dialog fail with a link error.
      const [grantList, linkState, people] = await Promise.all([
        api.grants(boardId),
        canManage ? api.link(boardId) : Promise.resolve(null),
        orgId
          ? api.members(orgId).catch(() => ({ members: [] as OrgMember[] }))
          : Promise.resolve({ members: [] as OrgMember[] }),
      ]);
      setGrants(grantList.grants);
      setMembers(people.members);
      if (linkState) {
        setLink(linkState.link);
        setLinkExpiry(localDateTime(linkState.link.expiresAt));
      }
      setError(null);
    } catch (failure) {
      // A viewer may open this dialog by mistake: say what is wrong instead of empty.
      setError(failure instanceof Error ? failure.message : t("share.failed"));
    }
  }, [boardId, canManage, open, orgId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    setTransferTo("");
    setConfirmTransfer(false);
    setConfirmDraftSharing(false);
    setInviteUrl(null);
    setInviteSentTo(null);
    setNeedsVerification(false);
    setLinkError(null);
    setPasswordError(null);
    setExpiryError(null);
  }, [open]);

  if (!open) return null;

  const failureText = (failure: unknown) => {
    const code = (failure as { code?: string }).code;
    if (code === "FORBIDDEN") return t("share.forbidden");
    if (code === "EXPIRY_IN_PAST") return t("share.expiryPast");
    if (code === "BAD_EXPIRY") return t("share.expiryInvalid");
    if (code === "WEAK_PASSWORD") return t("share.passwordWeak");
    if (code === "ROOM_AGENT_ASSIGNED") return t("share.roomAgentAssigned");
    if (code === "CONFIRM_DRAFT_SHARING") {
      setConfirmDraftSharing(true);
      return null;
    }
    if (failure instanceof Error) return failure.message;
    return t("share.failed");
  };

  const run = async (
    action: () => Promise<unknown>,
    onError: (message: string | null) => void = setError,
  ) => {
    setBusy(true);
    setError(null);
    setLinkError(null);
    setPasswordError(null);
    setExpiryError(null);
    try {
      await action();
      await refresh();
      onChange();
    } catch (failure) {
      onError(failureText(failure));
    } finally {
      setBusy(false);
    }
  };

  // One URL per board, the same one whether it was copied today or last month
  // (ADR-069). Copying never mints a new secret.
  const linkUrl = `${window.location.origin}/?room=${encodeURIComponent(boardId)}`;

  /** Members who can take the board; a guest is a collaborator, never an owner. */
  const transferCandidates = members.filter(
    (member) => member.id !== meId && member.relation === "member" && member.state === "active",
  );
  const transferName =
    transferCandidates.find((member) => member.id === transferTo)?.name ?? "";

  const handOver = async () => {
    if (!transferTo) return;
    setBusy(true);
    setError(null);
    try {
      await api.transferBoard(boardId, transferTo);
      setConfirmTransfer(false);
      onChange();
      // The caller is now an editor: the sharing controls are no longer theirs.
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("share.failed"));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = (grant: Grant) =>
    grant.source === "team"
      ? t("share.sourceTeam", { name: grant.subject_name ?? t("share.team") })
      : grant.source === "org"
        ? t("share.sourceOrg", { name: grant.subject_name ?? t("share.org") })
        : t("share.sourceDirect");

  // The account menu answers the same question; one sentence, one place (roleSource.ts).
  const roleLine = roleSourceLine(t, viewerRole, viewerSources);
  const roleOptions = (["viewer", "commenter", "editor", "coowner"] as const).map((value) => ({
    value,
    label: t(`role.${value}`),
  }));

  return (
    <Dialog
      title={t("share.title")}
      description={boardTitle}
      help={<HelpLink topicId="access.share" />}
      size="md"
      onClose={onClose}
    >
      <div className="share-body">
        {error && <Banner tone="danger">{error}</Banner>}

        <section className="share-group">
          <form
            className="share-invite-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!email.trim()) return;
              void run(async () => {
                setInviteSentTo(null);
                setNeedsVerification(false);
                try {
                  await api.addGrant(boardId, { email: email.trim(), role });
                  setEmail("");
                  setInviteUrl(null);
                } catch (failure) {
                  // No account yet: an invitation link is the honest answer, and with mail
                  // on the link is also sent to the person (ADR-246).
                  if ((failure as { code?: string }).code === "USER_NOT_FOUND") {
                    try {
                      const invite = (await api.inviteGuest(boardId, { email: email.trim(), role })) as {
                        url: string;
                        emailQueued?: boolean;
                      };
                      setInviteUrl(invite.url);
                      if (invite.emailQueued) setInviteSentTo(email.trim());
                      setEmail("");
                      return;
                    } catch (refusal) {
                      if ((refusal as { code?: string }).code === "EMAIL_NOT_VERIFIED") {
                        setNeedsVerification(true);
                        return;
                      }
                      throw refusal;
                    }
                  }
                  throw failure;
                }
              });
            }}
          >
            <Input
              type="email"
              label={t("share.person")}
              placeholder={t("share.emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Select
              label={t("share.role")}
              options={roleOptions}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              {t("share.invite")}
            </Button>
          </form>
          <p className="share-caption">{t("share.acceptNote")}</p>
          {roleLine && <p className="share-caption">{roleLine}</p>}

          {needsVerification && <EmailVerificationNeeded />}
          {inviteSentTo && <InviteSent email={inviteSentTo} />}

          {inviteUrl && (
            <div className="share-copy">
              <Input
                readOnly
                label={t("share.inviteReady")}
                value={inviteUrl}
                onFocus={(event) => event.target.select()}
              />
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteUrl);
                  setCopied(true);
                }}
              >
                {copied ? t("share.copied") : t("share.copy")}
              </Button>
            </div>
          )}

          <ul className="share-list">
            {grants.map((grant) => (
              <li key={`${grant.subject_type}:${grant.subject_id}`}>
                <span className="share-subject">
                  <span className="share-name">
                    {grant.subject_type === "user"
                      ? (grant.subject_name ?? t("share.person"))
                      : (grant.subject_name ??
                        t(`share.${grant.subject_type}` as "share.org"))}
                  </span>
                  <span className="share-caption">
                    {sourceLabel(grant)}
                    {grant.subject_email && ` · ${grant.subject_email}`}
                  </span>
                </span>
                {grant.subject_type === "user" || canManage ? (
                  <Select
                    size="compact"
                    options={roleOptions}
                    value={grant.role}
                    disabled={busy}
                    aria-label={t("share.roleFor", { name: grant.subject_name ?? grant.subject_id })}
                    onChange={(event) =>
                      void run(() =>
                        api.setGrant(boardId, {
                          subjectType: grant.subject_type,
                          subjectId: grant.subject_id,
                          role: event.target.value,
                        }),
                      )
                    }
                  />
                ) : (
                  <span className="share-role">{t(`role.${grant.role}` as "role.viewer")}</span>
                )}
                {(grant.subject_type === "user" || canManage) && (
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.removeGrant(boardId, grant.subject_type, grant.subject_id))
                    }
                  >
                    {t("share.remove")}
                  </Button>
                )}
              </li>
            ))}
            {!grants.length && <li className="share-caption">{t("share.onlyOwner")}</li>}
          </ul>
        </section>

        {canTransfer && (
          <section className="share-group" aria-labelledby="share-transfer-title">
            <h3 id="share-transfer-title" className="share-group-title">{t("share.transferTitle")}</h3>
            <p className="share-caption">{t("share.transferBody")}</p>
            {confirmTransfer ? (
              <div className="share-group">
                <p className="share-text">{t("share.transferConfirm", { name: transferName })}</p>
                <div className="share-actions">
                  <Button variant="secondary" onClick={() => setConfirmTransfer(false)}>
                    {t("share.cancel")}
                  </Button>
                  <Button variant="danger" loading={busy} onClick={() => void handOver()}>
                    {t("share.transferAction")}
                  </Button>
                </div>
              </div>
            ) : transferCandidates.length ? (
              <div className="share-row">
                <Select
                  aria-label={t("share.transferChoose")}
                  options={[
                    { value: "", label: t("share.transferChoose") },
                    ...transferCandidates.map((member) => ({ value: member.id, label: member.name })),
                  ]}
                  value={transferTo}
                  onChange={(event) => setTransferTo(event.target.value)}
                />
                <Button disabled={!transferTo || busy} onClick={() => setConfirmTransfer(true)}>
                  {t("share.transferNext")}
                </Button>
              </div>
            ) : (
              <p className="share-caption">{t("share.transferNoMembers")}</p>
            )}
          </section>
        )}

        {canManage && (
          <section className="share-group" aria-labelledby="share-link-title">
            <div className="share-row">
              <div className="share-subject">
                <h3 id="share-link-title" className="share-group-title">{t("share.linkTitle")}</h3>
                <p className="share-text">
                  {link?.enabled
                    ? link.expired
                      ? t("share.linkExpired")
                      : t("share.linkOnState", {
                          role: t(`role.${link.role}` as "role.viewer"),
                          password: link.hasPassword ? t("share.passwordSet") : t("share.passwordNone"),
                          expiry: link.expiresAt
                            ? t("share.linkUntil", { date: formatMoment(link.expiresAt, lang) })
                            : t("share.expiryNone"),
                        })
                    : t("share.linkOff")}
                </p>
              </div>
              {/* A button, not a Switch: turning the link on may need a second, explicit
                  confirmation that drafts become public (CONFIRM_DRAFT_SHARING). */}
              <Button
                disabled={busy || !link}
                onClick={() => {
                  const enabled = !link?.enabled;
                  setConfirmDraftSharing(false);
                  void run(() => api.setLink(boardId, { enabled, confirmDraftSharing }), setLinkError);
                }}
              >
                {link?.enabled
                  ? t("share.linkOffAction")
                  : confirmDraftSharing ? t("share.linkConfirmDrafts") : t("share.linkOn")}
              </Button>
            </div>
            <p className="share-caption">{t("share.linkWarning")}</p>
            {confirmDraftSharing && <Banner tone="warning">{t("share.linkDraftWarning")}</Banner>}
            {!link?.enabled && <p className="share-caption">{t("share.linkReenable")}</p>}
            {linkError && <Banner tone="danger">{linkError}</Banner>}

            {link?.enabled && (
              <>
                <div className="share-copy">
                  <Input readOnly aria-label={t("share.linkTitle")} value={linkUrl} onFocus={(event) => event.target.select()} />
                  <Button
                    onClick={() => {
                      void navigator.clipboard?.writeText(linkUrl);
                      setCopied(true);
                    }}
                  >
                    {copied ? t("share.copied") : t("share.copy")}
                  </Button>
                </div>

                <div className="share-row">
                  <span className="share-text">
                    {link.hasPassword ? t("share.passwordSet") : t("share.passwordNone")}
                  </span>
                  {link.hasPassword ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => api.setLink(boardId, { password: null }), setPasswordError)}
                    >
                      {t("share.passwordRemove")}
                    </Button>
                  ) : (
                    <>
                      <Input
                        type="password"
                        value={linkPassword}
                        autoComplete="new-password"
                        placeholder={t("share.passwordPlaceholder")}
                        aria-label={t("share.passwordPlaceholder")}
                        error={passwordError ?? undefined}
                        onChange={(event) => setLinkPassword(event.target.value)}
                      />
                      <Button
                        disabled={busy || linkPassword.length < 8}
                        onClick={() =>
                          void run(async () => {
                            await api.setLink(boardId, { password: linkPassword });
                            setLinkPassword("");
                          }, setPasswordError)
                        }
                      >
                        {t("share.passwordSetAction")}
                      </Button>
                    </>
                  )}
                </div>
                {link.hasPassword && passwordError && <Banner tone="danger">{passwordError}</Banner>}

                <div className="share-row">
                  <span className="share-text">
                    {link.expiresAt
                      ? t("share.linkUntil", { date: formatMoment(link.expiresAt, lang) })
                      : t("share.expiryNone")}
                  </span>
                  <Input
                    type="datetime-local"
                    value={linkExpiry}
                    aria-label={t("share.expiry")}
                    error={expiryError ?? undefined}
                    onChange={(event) => setLinkExpiry(event.target.value)}
                  />
                  <Button
                    disabled={busy || !linkExpiry}
                    onClick={() =>
                      void run(
                        () => api.setLink(boardId, { expiresAt: new Date(linkExpiry).toISOString() }),
                        setExpiryError,
                      )
                    }
                  >
                    {t("share.expirySetAction")}
                  </Button>
                  {link.expiresAt && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => api.setLink(boardId, { expiresAt: null }), setExpiryError)}
                    >
                      {t("share.expiryRemove")}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

function localDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
