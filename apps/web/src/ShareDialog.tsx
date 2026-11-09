import { useCallback, useEffect, useState } from "react";
import { api, type Grant, type OrgMember } from "./api";
import { formatMoment } from "./format";
import { useI18n } from "./i18n";
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

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("share.title")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="share-head">
          <div>
            <h2>
              {t("share.title")} <HelpLink topicId="access.share" />
            </h2>
            <p className="muted">{boardTitle}</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label={t("share.close")}>
            ×
          </button>
        </header>

        <form
          className="share-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim()) return;
            void run(async () => {
              try {
                await api.addGrant(boardId, { email: email.trim(), role });
                setEmail("");
                setInviteUrl(null);
              } catch (failure) {
                // No account yet: an invitation link is the honest answer. The inviter
                // sends it themselves until the mail service exists.
                if ((failure as { code?: string }).code === "USER_NOT_FOUND") {
                  const invite = await api.inviteGuest(boardId, { email: email.trim(), role });
                  setInviteUrl(invite.url);
                  setEmail("");
                  return;
                }
                throw failure;
              }
            });
          }}
        >
          <input
            type="email"
            placeholder={t("share.emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label={t("share.role")}>
            <option value="viewer">{t("role.viewer")}</option>
            <option value="commenter">{t("role.commenter")}</option>
            <option value="editor">{t("role.editor")}</option>
            <option value="coowner">{t("role.coowner")}</option>
          </select>
          <button type="submit" className="primary-button" disabled={busy || !email.trim()}>
            {t("share.invite")}
          </button>
        </form>
        <p className="muted share-note">{t("share.acceptNote")}</p>
        {roleLine && <p className="muted share-effective">{roleLine}</p>}

        {error && <p className="auth-error">{error}</p>}

        {inviteUrl && (
          <div className="share-invite">
            <p className="muted">{t("share.inviteReady")}</p>
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
                {copied ? t("share.copied") : t("share.copy")}
              </button>
            </div>
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
                <span className="share-source">{sourceLabel(grant)}</span>
                {grant.subject_email && <span className="share-email muted">{grant.subject_email}</span>}
              </span>
              {grant.subject_type === "user" || canManage ? (
                <select
                  className="share-role-select"
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
                >
                  <option value="viewer">{t("role.viewer")}</option>
                  <option value="commenter">{t("role.commenter")}</option>
                  <option value="editor">{t("role.editor")}</option>
                  <option value="coowner">{t("role.coowner")}</option>
                </select>
              ) : (
                <span className="share-role">{t(`role.${grant.role}` as "role.viewer")}</span>
              )}
              {(grant.subject_type === "user" || canManage) && (
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.removeGrant(boardId, grant.subject_type, grant.subject_id))
                  }
                >
                  {t("share.remove")}
                </button>
              )}
            </li>
          ))}
          {!grants.length && <li className="muted">{t("share.onlyOwner")}</li>}
        </ul>

        {canTransfer && (
          <div className="share-transfer">
            <strong>{t("share.transferTitle")}</strong>
            <p className="muted">{t("share.transferBody")}</p>
            {confirmTransfer ? (
              <div className="share-transfer-confirm">
                <p>{t("share.transferConfirm", { name: transferName })}</p>
                <div>
                  <button
                    type="button"
                    className="primary-button danger"
                    disabled={busy}
                    onClick={() => void handOver()}
                  >
                    {t("share.transferAction")}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setConfirmTransfer(false)}
                  >
                    {t("share.cancel")}
                  </button>
                </div>
              </div>
            ) : transferCandidates.length ? (
              <div className="share-add">
                <select
                  value={transferTo}
                  aria-label={t("share.transferChoose")}
                  onChange={(event) => setTransferTo(event.target.value)}
                >
                  <option value="">{t("share.transferChoose")}</option>
                  {transferCandidates.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!transferTo || busy}
                  onClick={() => setConfirmTransfer(true)}
                >
                  {t("share.transferNext")}
                </button>
              </div>
            ) : (
              <p className="muted">{t("share.transferNoMembers")}</p>
            )}
          </div>
        )}

        {canManage && (
          <div className="share-link">
            <div className="share-link-head">
              <div>
                <strong>{t("share.linkTitle")}</strong>
                <p className="muted">{t("share.linkWarning")}</p>
                <p className="muted share-link-state">
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
              <button
                type="button"
                className={link?.enabled ? "primary-button" : "ghost-button"}
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
              </button>
            </div>

            {confirmDraftSharing && (
              <p className="muted share-link-warning">{t("share.linkDraftWarning")}</p>
            )}
            {!link?.enabled && (
              <p className="muted share-link-warning">{t("share.linkReenable")}</p>
            )}
            {linkError && <p className="auth-error share-link-error">{linkError}</p>}

            {link?.enabled && (
              <>
                <div className="share-link-url">
                  <input readOnly value={linkUrl} onFocus={(event) => event.target.select()} />
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(linkUrl);
                      setCopied(true);
                    }}
                  >
                    {copied ? t("share.copied") : t("share.copy")}
                  </button>
                </div>

                <div className="share-security">
                  <div className="share-security-row">
                    <span>
                      {link.hasPassword ? t("share.passwordSet") : t("share.passwordNone")}
                    </span>
                    {link.hasPassword ? (
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.setLink(boardId, { password: null }),
                            setPasswordError,
                          )
                        }
                      >
                        {t("share.passwordRemove")}
                      </button>
                    ) : (
                      <>
                        <input
                          type="password"
                          value={linkPassword}
                          autoComplete="new-password"
                          placeholder={t("share.passwordPlaceholder")}
                          aria-label={t("share.passwordPlaceholder")}
                          onChange={(event) => setLinkPassword(event.target.value)}
                        />
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={busy || linkPassword.length < 8}
                          onClick={() =>
                            void run(async () => {
                              await api.setLink(boardId, { password: linkPassword });
                              setLinkPassword("");
                            }, setPasswordError)
                          }
                        >
                          {t("share.passwordSetAction")}
                        </button>
                      </>
                    )}
                  </div>

                  {passwordError && (
                    <p className="auth-error share-security-error">{passwordError}</p>
                  )}

                  <div className="share-security-row">
                    <span>
                      {link.expiresAt
                        ? t("share.linkUntil", { date: formatMoment(link.expiresAt, lang) })
                        : t("share.expiryNone")}
                    </span>
                    <input
                      type="datetime-local"
                      value={linkExpiry}
                      aria-label={t("share.expiry")}
                      onChange={(event) => setLinkExpiry(event.target.value)}
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={busy || !linkExpiry}
                      onClick={() =>
                        void run(
                          () =>
                            api.setLink(boardId, {
                              expiresAt: new Date(linkExpiry).toISOString(),
                            }),
                          setExpiryError,
                        )
                      }
                    >
                      {t("share.expirySetAction")}
                    </button>
                    {link.expiresAt && (
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.setLink(boardId, { expiresAt: null }),
                            setExpiryError,
                          )
                        }
                      >
                        {t("share.expiryRemove")}
                      </button>
                    )}
                  </div>
                  {expiryError && (
                    <p className="auth-error share-security-error">{expiryError}</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
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
