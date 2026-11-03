import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardConnection, Presence } from "@remo/doc";
import { presentationFrames } from "@remo/doc";
import type { BoardDocument } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import type { TranslationKey } from "./i18n";

/**
 * Presentation is frame order in the document and live state in awareness (ADR-108).
 *
 * The presenter writes `presenting = {frameId, index, startedAt}` to awareness; followers
 * fit the same frame locally instead of mirroring a pixel viewport. Nothing about "who is
 * presenting" is written to the board.
 */
export function usePresentation({
  board,
  widgets,
  camera,
  setCamera,
  connection,
  presence,
  canFacilitate,
  panelOpen,
  setPanelOpen,
  t,
}: {
  board: BoardDocument;
  widgets: Widget[];
  camera: Camera;
  setCamera: (camera: Camera) => void;
  connection: BoardConnection | null;
  presence: Presence[];
  canFacilitate: boolean;
  /** The slide-order panel: its trigger is in the header (spec §10, П1). */
  panelOpen: boolean;
  setPanelOpen: (value: boolean) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [watching, setWatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const savedCamera = useRef<Camera | null>(null);
  const lastFit = useRef("");

  const self = presence.find((peer) => peer.self);
  const local = self?.presenting ?? null;
  const remotePeer = presence.find((peer) => !peer.self && peer.presenting);
  const remote = remotePeer?.presenting ?? null;
  const frames = presentationFrames(board);

  const fitFrame = useCallback(
    (frameId: string) => {
      const frame = widgets.find((widget) => widget.id === frameId && widget.type === "frame");
      if (!frame) return;
      const width = Math.max(320, window.innerWidth - 120);
      const height = Math.max(240, window.innerHeight - 180);
      const zoom = Math.max(
        0.1,
        Math.min(2.5, width / Math.max(frame.width, 1), height / Math.max(frame.height, 1)),
      );
      setCamera({ x: frame.x, y: frame.y, zoom });
      lastFit.current = frameId;
    },
    [setCamera, widgets],
  );

  // A follower follows the slide, not the presenter's every pan.
  useEffect(() => {
    if (!watching || !remote || remote.frameId === lastFit.current) return;
    fitFrame(remote.frameId);
  }, [fitFrame, remote?.frameId, watching]);

  // The presenter stopped: the follower stays where the last slide was.
  useEffect(() => {
    if (!watching || remote) return;
    setWatching(false);
    setNotice(t("presentation.ended"));
  }, [remote, t, watching]);

  const start = useCallback(() => {
    if (!canFacilitate) {
      setNotice(t("presentation.forbidden"));
      return;
    }
    if (!frames.length) {
      setNotice(t("presentation.noFrames"));
      return;
    }
    // One presentation per board (ADR-152): the audience has one "now showing" state,
    // so a second session must not silently create a competing one.
    const other = presence.find((peer) => !peer.self && peer.presenting);
    if (other) {
      setNotice(
        t("presentation.busy", { name: other.label ?? t("presentation.someone") }),
      );
      return;
    }
    savedCamera.current = camera;
    connection?.awareness?.setLocalStateField("presenting", {
      frameId: frames[0],
      index: 0,
      startedAt: Date.now(),
    });
    fitFrame(frames[0]!);
    setPanelOpen(false);
    setNotice(null);
  }, [camera, canFacilitate, connection, fitFrame, frames, presence, t]);

  const stop = useCallback(() => {
    if (!local) return;
    connection?.awareness?.setLocalStateField("presenting", null);
    if (savedCamera.current) setCamera(savedCamera.current);
    savedCamera.current = null;
    setWatching(false);
    setNotice(null);
  }, [connection, local, setCamera]);

  const go = useCallback(
    (direction: 1 | -1) => {
      if (!local || !frames.length) return;
      const index = (local.index + direction + frames.length) % frames.length;
      const frameId = frames[index]!;
      connection?.awareness?.setLocalStateField("presenting", {
        frameId,
        index,
        startedAt: local.startedAt,
      });
      fitFrame(frameId);
    },
    [connection, fitFrame, frames, local],
  );

  const join = useCallback(() => {
    if (!remote) return;
    setWatching(true);
    if (remote.frameId !== lastFit.current) fitFrame(remote.frameId);
  }, [fitFrame, remote]);

  const leave = useCallback(() => setWatching(false), []);
  const returnToPresenter = useCallback(() => {
    if (remote) {
      setWatching(true);
      fitFrame(remote.frameId);
    }
  }, [fitFrame, remote]);

  return {
    panelOpen,
    setPanelOpen,
    watching,
    notice,
    setNotice,
    frames,
    local,
    remote,
    presenterName: local ? self?.label : remotePeer?.label,
    start,
    stop,
    next: () => go(1),
    previous: () => go(-1),
    join,
    leave,
    returnToPresenter,
  };
}
