import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { BoardConnection, Presence } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Identity } from "./identity";
import type { TranslationKey } from "./i18n";
import {
  autoFollow,
  followerCount,
  followReducer,
  NO_FOLLOW,
  pendingInvite,
  remoteCamera,
} from "./follow";

/**
 * Follow as attention, not board state (ADR-076).
 *
 * Everyone broadcasts a viewport in awareness; a follower mirrors the target's camera, a
 * local pan pauses the mirror, and either side can stop. The hook owns only ephemeral
 * state: nothing here touches the document.
 */
export function useFollowAttention({
  presence,
  identity,
  connection,
  camera,
  setCamera,
  allowBringEveryone,
  setNotice,
  setFollowOpen,
  t,
}: {
  presence: Presence[];
  identity: Identity;
  connection: BoardConnection | null;
  camera: Camera;
  setCamera: (camera: Camera) => void;
  allowBringEveryone: boolean;
  setNotice: (message: string) => void;
  setFollowOpen: (open: boolean) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [follow, dispatchFollow] = useReducer(followReducer, NO_FOLLOW);
  const [followInvite, setFollowInvite] = useState<{
    from: string;
    name?: string;
    at: number;
  } | null>(null);
  const seenStop = useRef(0);
  const seenInvite = useRef(0);
  const appliedCamera = useRef("");

  useEffect(() => {
    const awareness = connection?.awareness;
    if (!awareness) return;
    // One broadcast per gesture, not per animation frame.
    const timer = window.setTimeout(() => {
      awareness.setLocalStateField("camera", camera);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [camera, connection]);

  useEffect(() => {
    connection?.awareness?.setLocalStateField("followTo", follow.target);
  }, [follow.target, connection]);

  const targetCamera = remoteCamera(presence, follow);
  useEffect(() => {
    if (!targetCamera) {
      // A pause or a stop must not make the next frame look "already applied": the
      // target may not have moved while the follower was away.
      appliedCamera.current = "";
      return;
    }
    const key = `${targetCamera.x}/${targetCamera.y}/${targetCamera.zoom}`;
    if (key === appliedCamera.current) return;
    appliedCamera.current = key;
    setCamera(targetCamera);
  }, [targetCamera?.x, targetCamera?.y, targetCamera?.zoom]);

  const targetPeer = follow.target
    ? presence.find((peer) => !peer.self && peer.sessionKey === follow.target)
    : undefined;

  // The followed person can stop the people following them.
  useEffect(() => {
    const stopAt = targetPeer?.stopFollowersAt ?? 0;
    if (!stopAt || stopAt === seenStop.current) return;
    seenStop.current = stopAt;
    if (follow.target) {
      dispatchFollow({ type: "stoppedByTarget" });
      setNotice(t("follow.stoppedByThem", { name: follow.targetLabel ?? follow.target }));
    }
  }, [targetPeer?.stopFollowersAt, follow.target, follow.targetLabel, t]);

  // A follow cannot outlive the person it mirrors: their awareness entry is gone.
  useEffect(() => {
    if (!follow.target || targetPeer) return;
    const name = follow.targetLabel ?? follow.target;
    const timer = window.setTimeout(() => {
      dispatchFollow({ type: "targetLeft" });
      setNotice(t("follow.targetLeft", { name }));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [follow.target, follow.targetLabel, targetPeer, t]);

  const invite = pendingInvite(presence, seenInvite.current);
  useEffect(() => {
    if (!invite) return;
    seenInvite.current = invite.at;
    const label = invite.name ?? invite.from;
    if (autoFollow(allowBringEveryone)) {
      dispatchFollow({ type: "follow", target: invite.from, label });
      setNotice(t("follow.autoFollowed", { name: label }));
    } else {
      setFollowInvite(invite);
    }
  }, [invite?.at, invite?.from, allowBringEveryone, t]);

  const selfKey = presence.find((peer) => peer.self)?.sessionKey ?? "";
  const myFollowers = followerCount(presence, selfKey);
  const followerNames = presence
    .filter((peer) => !peer.self && peer.followTo === selfKey)
    .map((peer) => peer.label);
  const otherPeers = presence.filter((peer) => !peer.self).length;

  /** A local pan or zoom pauses the mirror; it never silently snaps back. */
  const handleCamera = useCallback(
    (next: Camera) => {
      if (follow.target) dispatchFollow({ type: "localMove" });
      setCamera(next);
    },
    [follow.target],
  );

  const toggleFollow = useCallback(
    (target: string, label: string) => {
      dispatchFollow(
        follow.target === target
          ? { type: "unfollow" }
          : { type: "follow", target, label },
      );
    },
    [follow.target],
  );

  const stopFollowers = useCallback(() => {
    connection?.awareness?.setLocalStateField("stopFollowersAt", Date.now());
  }, [connection]);

  const bringEveryone = useCallback(() => {
    if (!selfKey) return;
    connection?.awareness?.setLocalStateField("invite", {
      from: selfKey,
      name: identity.name,
      at: Date.now(),
    });
    setFollowOpen(false);
  }, [connection, identity.name, selfKey]);

  return {
    follow,
    dispatchFollow,
    followInvite,
    setFollowInvite,
    handleCamera,
    myFollowers,
    followerNames,
    otherPeers,
    toggleFollow,
    stopFollowers,
    bringEveryone,
  };
}
