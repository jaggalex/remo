import { useCallback, useEffect, useRef } from "react";
import { boxOf, fitToBounds, unionBox, zoomAt, type Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";

/**
 * The camera fit and the two HUD zoom buttons.
 *
 * `BoardCanvas` was at the 800-line limit when the edge "+" arrived (ADR-093). This is
 * one reason to change on its own: the viewport arithmetic and the once-per-load fit
 * do not need the gesture machine or the chrome around them.
 */
export function useBoardCameraFit({
  camera,
  setCamera,
  viewport,
  widgets,
  selectedIds,
  widgetById,
  fitKey,
  synced,
}: {
  camera: Camera;
  setCamera: (camera: Camera) => void;
  viewport: { width: number; height: number };
  widgets: Widget[];
  selectedIds: readonly string[];
  widgetById: (id: string) => Widget | undefined;
  fitKey: string;
  synced: boolean;
}) {
  const fit = useCallback(() => {
    if (!viewport.width || !viewport.height) return;
    // Fit what the person is looking at: a selection if there is one, the whole
    // board otherwise. `widgetById` resolves a card to its cell, so a kanban's cards
    // are not measured at the origin they do not occupy.
    const ids = selectedIds.length ? [...selectedIds] : widgets.map((widget) => widget.id);
    const boxes = ids
      .map((id) => widgetById(id))
      .filter((widget): widget is Widget => Boolean(widget))
      .map((widget) => boxOf(widget));
    const target = unionBox(boxes);
    if (target) setCamera(fitToBounds(target, { x: 0, y: 0, ...viewport }));
  }, [setCamera, selectedIds, viewport, widgetById, widgets]);

  /** Zoom around the middle of the canvas, for the two HUD buttons. */
  const zoomBy = useCallback(
    (factor: number) => {
      setCamera(
        zoomAt(
          camera,
          { x: 0, y: 0, width: viewport.width, height: viewport.height },
          { x: viewport.width / 2, y: viewport.height / 2 },
          factor,
        ),
      );
    },
    [camera, setCamera, viewport.height, viewport.width],
  );

  const fittedFor = useRef<string | null>(null);
  const emptyAfterSync = useRef<string | null>(null);

  useEffect(() => {
    if (viewport.width <= 1 || viewport.height <= 1) return;
    if (!widgets.length) {
      if (synced) emptyAfterSync.current = fitKey;
      return;
    }
    const key = `${fitKey}@${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    // A server draft arriving in an already open empty room must keep the view in place.
    if (
      emptyAfterSync.current === fitKey &&
      widgets.every((widget) => widget.agent?.skill === "room-draft")
    ) {
      return;
    }
    fit();
  }, [fit, fitKey, synced, viewport.height, viewport.width, widgets]);

  return { fit, zoomBy };
}
