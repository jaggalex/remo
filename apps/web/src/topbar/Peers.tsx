import { Avatar, Button } from "@remo/ui";
import type { Presence } from "@remo/doc";
import { useI18n } from "../i18n";

/**
 * Who else is here, and who is following me (ADR-076).
 *
 * Faces, not names: a face is the person's cursor colour, so the pointer on the canvas
 * and the face in the header are visibly the same person. Following is one click on a
 * face; the counter opens the followers dialog.
 */
export function Peers({
  peers,
  followTarget,
  onToggleFollow,
  myFollowers,
  canFacilitate,
  otherPeers,
  followOpen,
  onFollow,
}: {
  peers: Presence[];
  /** Session key of the person being followed. */
  followTarget: string | null;
  onToggleFollow: (target: string, label: string) => void;
  myFollowers: number;
  canFacilitate: boolean;
  otherPeers: number;
  followOpen: boolean;
  onFollow: () => void;
}) {
  const { t } = useI18n();
  const showCounter = myFollowers > 0 || (canFacilitate && otherPeers > 0);

  return (
    <div className="presence" role="group" aria-label={t("follow.title")}>
      {peers.map((peer) => (
        <button
          key={peer.clientId}
          type="button"
          className={
            followTarget === peer.sessionKey ? "peer following" : "peer"
          }
          title={
            followTarget === peer.sessionKey
              ? t("follow.stop")
              : peer.handle
                ? `${t("follow.follow", { name: peer.label })} @${peer.handle}`
                : t("follow.follow", { name: peer.label })
          }
          onClick={() => onToggleFollow(peer.sessionKey, peer.label)}
        >
          <Avatar name={peer.label} background={peer.color} />
        </button>
      ))}
      {showCounter && (
        <Button
          variant="ghost"
          icon="eye"
          className="follow-counter"
          aria-label={t("follow.counter", { n: myFollowers })}
          selected={followOpen}
          onClick={onFollow}
        >
          {myFollowers}
        </Button>
      )}
    </div>
  );
}
