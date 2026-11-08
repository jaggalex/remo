import { LinkPasswordGate } from "./LinkPasswordGate";
import type { BoardDocument } from "@remo/doc";
import { DeleteConfirmation } from "./DeleteDialog";
import { HelpLink } from "./help/HelpLink";
import type { FollowEvent, FollowState } from "./follow";
import { useI18n } from "./i18n";
import { useProposal } from "./proposalStore";

/**
 * The banners and pills that float over the canvas.
 *
 * They are presentational: App decides what is true (access, follow, a notice) and
 * these components only say it. Grouping them keeps App's JSX about the board itself.
 */

/** A viewer without access sees why, and the one action that can change it. */
export function BoardAccessGate({
  reason,
  signedIn,
  boardId,
  onSignIn,
  onRetry,
}: {
  reason: string | null | undefined;
  signedIn: boolean;
  boardId: string;
  onSignIn: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="access-gate" role="dialog" aria-modal="true">
      <h2>{t("iam.noAccess")}</h2>
      <p className="muted">
        {reason === "PASSWORD_REQUIRED"
          ? t("iam.passwordRequired")
          : reason === "LINK_INACTIVE"
            ? t("iam.linkInactive")
            : reason === "AUTH_REQUIRED"
              ? t("iam.signInToOpen")
              : reason === "UNCLAIMED"
                ? t("iam.unclaimed")
                : t("iam.noAccessHint")}
      </p>
      {reason === "PASSWORD_REQUIRED" ? (
        <LinkPasswordGate boardId={boardId} onUnlocked={() => window.location.reload()} />
      ) : (
        <div className="access-actions">
          {!signedIn && (
            <button type="button" className="primary-button" onClick={onSignIn}>
              {t("auth.login")}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onRetry}>
            {t("iam.retry")}
          </button>
        </div>
      )}
    </div>
  );
}

/** An unprotected room can be taken by the first signed-in visitor (ADR-064). */
export function BoardUnclaimedBanner({
  signedIn,
  onClaim,
  onSignIn,
}: {
  signedIn: boolean;
  onClaim: () => void;
  onSignIn: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="unclaimed-banner" role="status">
      <span>{t("iam.unclaimed")}</span>
      <button
        type="button"
        className="primary-button"
        onClick={() => (signedIn ? onClaim() : onSignIn())}
      >
        {signedIn ? t("iam.claim") : t("iam.claimLogin")}
      </button>
    </div>
  );
}

/** Following someone is attention, not board state: a pill, and either side can stop. */
export function FollowPill({
  follow,
  dispatch,
}: {
  follow: FollowState;
  dispatch: (event: FollowEvent) => void;
}) {
  const { t } = useI18n();
  if (!follow.target) return null;
  return (
    <div className={`follow-pill${follow.paused ? " paused" : ""}`} role="status">
      <span>
        {follow.paused
          ? t("follow.paused", { name: follow.targetLabel ?? follow.target })
          : t("follow.following", { name: follow.targetLabel ?? follow.target })}
      </span>
      <button
        type="button"
        className="ghost-button"
        onClick={() => dispatch(follow.paused ? { type: "resume" } : { type: "unfollow" })}
      >
        {follow.paused ? t("follow.resume") : t("follow.stop")}
      </button>
      {follow.paused && (
        <button type="button" className="ghost-button" onClick={() => dispatch({ type: "unfollow" })}>
          {t("follow.stop")}
        </button>
      )}
      <HelpLink topicId="facilitation.follow" />
    </div>
  );
}

/** "Bring everyone": the invitation stays until the person answers it. */
export function FollowInvite({
  from,
  name,
  onAccept,
  onDismiss,
}: {
  from: string;
  /** The session's label; `from` is its key. */
  name?: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="follow-invite" role="dialog" aria-label={t("follow.inviteTitle")}>
      <span>{t("follow.invite", { name: name ?? from })}</span>
      <div className="follow-invite-actions">
        <button type="button" className="share-button" onClick={onAccept}>
          {t("follow.accept")}
        </button>
        <button type="button" className="ghost-button" onClick={onDismiss}>
          {t("follow.stay")}
        </button>
      </div>
    </div>
  );
}

/** A short-lived message about what just happened (or why it did not). */
export function CanvasNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="canvas-notice" role="status">
      {message}
    </div>
  );
}

/** The offline queue is full: writes stop until the connection returns (ADR-084). */
export function OfflineBlocked() {
  const { t } = useI18n();
  return (
    <div className="offline-blocked" role="alert">
      {t("sync.blocked")}
    </div>
  );
}

/** The empty board's first line: the room name, so a link can be pasted to a teammate. */
export function EmptyBoard({ room }: { room: string }) {
  const { t } = useI18n();
  // A plan under review is drawn where the room is empty; the card would cover it.
  if (useProposal()) return null;
  return (
    <div className="empty-board">
      <b>{t("empty.title")}</b>
      <span>{t("empty.body", { room })}</span>
    </div>
  );
}

/**
 * Why the board cannot be used right now, in one place: a blocked queue, an empty
 * board, a denied board or an unclaimed room. App decides the facts; the layer only
 * orders them so a workspace can be denied and empty at once without a stack of ifs.
 */
export function BoardStateLayer({
  blocked,
  emptyRoom,
  denied,
  unclaimed,
  reason,
  signedIn,
  boardId,
  onSignIn,
  onRetry,
  onClaim,
}: {
  blocked: boolean;
  emptyRoom: string | null;
  denied: boolean;
  unclaimed: boolean;
  reason: string | null | undefined;
  signedIn: boolean;
  boardId: string;
  onSignIn: () => void;
  onRetry: () => void;
  onClaim: () => void;
}) {
  return (
    <>
      {blocked && <OfflineBlocked />}
      {emptyRoom && <EmptyBoard room={emptyRoom} />}
      {denied && (
        <BoardAccessGate
          reason={reason}
          signedIn={signedIn}
          boardId={boardId}
          onSignIn={onSignIn}
          onRetry={onRetry}
        />
      )}
      {unclaimed && (
        <BoardUnclaimedBanner signedIn={signedIn} onClaim={onClaim} onSignIn={onSignIn} />
      )}
    </>
  );
}

/**
 * What floats over the canvas: the follow pill, its invitation, a notice and the
 * delete confirmation. One component so the workspace JSX stays about the board.
 */
export function CanvasChrome({
  follow,
  dispatchFollow,
  followInvite,
  onAcceptFollow,
  onDismissFollow,
  notice,
  pendingDelete,
  board,
  onCancelDelete,
  onDeleted,
}: {
  follow: FollowState;
  dispatchFollow: (event: FollowEvent) => void;
  followInvite: { from: string; name?: string } | null;
  onAcceptFollow: (invite: { from: string; name?: string }) => void;
  onDismissFollow: () => void;
  notice: string | null;
  pendingDelete: string[] | null;
  board: BoardDocument;
  onCancelDelete: () => void;
  onDeleted: () => void;
}) {
  return (
    <>
      <FollowPill follow={follow} dispatch={dispatchFollow} />
      {followInvite && (
        <FollowInvite
          from={followInvite.from}
          name={followInvite.name}
          onAccept={() => onAcceptFollow(followInvite)}
          onDismiss={onDismissFollow}
        />
      )}
      <CanvasNotice message={notice} />
      {pendingDelete && (
        <DeleteConfirmation
          board={board}
          ids={pendingDelete}
          onCancel={onCancelDelete}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
