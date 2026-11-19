import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardConnection, Presence } from "@remo/doc";
import { presentationSlides, presentationSteps } from "@remo/doc";
import type { BoardDocument } from "@remo/doc";
import type { PresentationStep } from "@remo/doc";
import {
  cellRect,
  columnHeaderRect,
  layoutTable,
  rowHeaderRect,
  type Camera,
} from "@remo/canvas";
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

/** A stable key for one presentation step, used to avoid re-fitting the same cell. */
function stepKey(step: Pick<PresentationStep, "frameId" | "cell">): string {
  return step.cell
    ? `${step.frameId}:${step.cell.rowId}:${step.cell.columnId}`
    : step.frameId;
}

/** The step described by an awareness payload; old payloads have no cell. */
function stepFromState(state: {
  frameId: string;
  cell?: { rowId: string; columnId: string };
}): PresentationStep {
  return state.cell
    ? {
        id: stepKey({ frameId: state.frameId, cell: state.cell }),
        slideId: state.frameId,
        frameId: state.frameId,
        cell: state.cell,
      }
    : { id: state.frameId, slideId: state.frameId, frameId: state.frameId };
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

  const steps = useMemo<PresentationStep[]>(() => presentationSteps(board), [board, widgets]);

  const fitStep = useCallback(
    (step: PresentationStep) => {
      const slide = widgets.find((widget) => widget.id === step.frameId);
      if (!slide) return;
      let box = slideBox(slide, widgetsById(widgets));
      if (step.cell) {
        const grid =
          slide.layout?.kind === "table" && slide.layout.active !== false
            ? layoutTable(slide, widgets)
            : null;
        const rect = grid ? cellRect(grid, step.cell.rowId, step.cell.columnId) : null;
        const column = grid ? columnHeaderRect(grid, step.cell.columnId) : null;
        const row = grid ? rowHeaderRect(grid, step.cell.rowId) : null;
        const frames = [rect, column, row].filter(
          (entry): entry is NonNullable<typeof entry> => Boolean(entry),
        );
        if (frames.length) {
          // The cell plus its own column and row headers: the audience sees which cell
          // is speaking without the whole table shrinking to a stamp. Padding keeps the
          // focus ring away from the present bar and the screen edge.
          const left = Math.min(...frames.map((entry) => entry.x));
          const top = Math.min(...frames.map((entry) => entry.y));
          const right = Math.max(...frames.map((entry) => entry.x + entry.width));
          const bottom = Math.max(...frames.map((entry) => entry.y + entry.height));
          box = {
            x: left + (right - left) / 2,
            y: top + (bottom - top) / 2,
            width: right - left + 120,
            height: bottom - top + 120,
          };
        }
      }
      const width = Math.max(320, window.innerWidth - 120);
      const height = Math.max(240, window.innerHeight - 180);
      const maxZoom = step.cell ? 1.6 : 2.5;
      const zoom = Math.max(
        0.1,
        Math.min(maxZoom, width / Math.max(box.width, 1), height / Math.max(box.height, 1)),
      );
      setCamera({ x: box.x, y: box.y, zoom });
      lastFit.current = stepKey(step);
    },
    [setCamera, widgets],
  );

  // A follower follows the step, not the presenter's every pan.
  useEffect(() => {
    if (!watching || !remote) return;
    const step = stepFromState(remote);
    if (stepKey(step) === lastFit.current) return;
    fitStep(step);
  }, [fitStep, remote?.cell?.rowId, remote?.cell?.columnId, remote?.frameId, watching]);

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
    const first = steps[0]!;
    connection?.awareness?.setLocalStateField("presenting", {
      frameId: first.frameId,
      index: 0,
      ...(first.cell ? { cell: first.cell } : {}),
      startedAt: Date.now(),
    });
    fitStep(first);
    setPanelOpen(false);
    setNotice(null);
  }, [camera, canFacilitate, connection, fitStep, presence, steps, t]);

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
      if (!local || !steps.length) return;
      const index = (local.index + direction + steps.length) % steps.length;
      const step = steps[index]!;
      connection?.awareness?.setLocalStateField("presenting", {
        frameId: step.frameId,
        index,
        ...(step.cell ? { cell: step.cell } : {}),
        startedAt: local.startedAt,
      });
      fitStep(step);
    },
    [connection, fitStep, local, steps],
  );

  const join = useCallback(() => {
    if (!remote) return;
    setWatching(true);
    const step = stepFromState(remote);
    if (stepKey(step) !== lastFit.current) fitStep(step);
  }, [fitStep, remote]);

  const leave = useCallback(() => setWatching(false), []);
  const returnToPresenter = useCallback(() => {
    if (remote) {
      setWatching(true);
      fitStep(stepFromState(remote));
    }
  }, [fitStep, remote]);

  return {
    panelOpen,
    setPanelOpen,
    watching,
    notice,
    setNotice,
    slides,
    steps,
    local,
    remote,
    localStep: local ? stepFromState(local) : null,
    remoteStep: remote ? stepFromState(remote) : null,
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
