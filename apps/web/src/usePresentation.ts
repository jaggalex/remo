import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardConnection, Presence } from "@remo/doc";
import { presentationSlides } from "@remo/doc";
import type { BoardDocument } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import type { TranslationKey } from "./i18n";

/**
 * The camera box of a slide (ADR-165).
 *
 * A connector has no meaningful rectangle of its own: its box is derived from the two
 * objects it joins, so presenting a line shows both ends. Every other object uses its
 * own rectangle.
 */
function slideBox(
  slide: Widget,
  byId: Map<string, Widget>,
): { x: number; y: number; width: number; height: number } {
  const own = {
    x: slide.x,
    y: slide.y,
    width: Math.max(slide.width, 1),
    height: Math.max(slide.height, 1),
  };
  if (slide.type !== "connector") return own;
  const ends = [slide.start?.item, slide.end?.item]
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((widget): widget is Widget => Boolean(widget));
  if (!ends.length) return own;
  const boxes = [own, ...ends.map((widget) => ({
    x: widget.x,
    y: widget.y,
    width: Math.max(widget.width, 1),
    height: Math.max(widget.height, 1),
  }))];
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function widgetsById(widgets: Widget[]): Map<string, Widget> {
  return new Map(widgets.map((widget) => [widget.id, widget]));
}

/**
 * Presentation is slide order in the document and live state in awareness (ADR-108).
 *
 * The presenter writes `presenting = {frameId, index, startedAt}` to awareness; followers
 * fit the same slide locally instead of mirroring a pixel viewport. Nothing about "who is
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
  const slides = presentationSlides(board);

  const fitSlide = useCallback(
    (slideId: string) => {
      const slide = widgets.find((widget) => widget.id === slideId);
      if (!slide) return;
      const box = slideBox(slide, widgetsById(widgets));
      const width = Math.max(320, window.innerWidth - 120);
      const height = Math.max(240, window.innerHeight - 180);
      const zoom = Math.max(
        0.1,
        Math.min(2.5, width / Math.max(box.width, 1), height / Math.max(box.height, 1)),
      );
      setCamera({ x: box.x, y: box.y, zoom });
      lastFit.current = slideId;
    },
    [setCamera, widgets],
  );

  // A follower follows the slide, not the presenter's every pan.
  useEffect(() => {
    if (!watching || !remote || remote.frameId === lastFit.current) return;
    fitSlide(remote.frameId);
  }, [fitSlide, remote?.frameId, watching]);

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
    if (!slides.length) {
      setNotice(t("presentation.noSlides"));
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
      frameId: slides[0],
      index: 0,
      startedAt: Date.now(),
    });
    fitSlide(slides[0]!);
    setPanelOpen(false);
    setNotice(null);
  }, [camera, canFacilitate, connection, fitSlide, presence, slides, t]);

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
      if (!local || !slides.length) return;
      const index = (local.index + direction + slides.length) % slides.length;
      const frameId = slides[index]!;
      connection?.awareness?.setLocalStateField("presenting", {
        frameId,
        index,
        startedAt: local.startedAt,
      });
      fitSlide(frameId);
    },
    [connection, fitSlide, local, slides],
  );

  const join = useCallback(() => {
    if (!remote) return;
    setWatching(true);
    if (remote.frameId !== lastFit.current) fitSlide(remote.frameId);
  }, [fitSlide, remote]);

  const leave = useCallback(() => setWatching(false), []);
  const returnToPresenter = useCallback(() => {
    if (remote) {
      setWatching(true);
      fitSlide(remote.frameId);
    }
  }, [fitSlide, remote]);

  return {
    panelOpen,
    setPanelOpen,
    watching,
    notice,
    setNotice,
    slides,
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
