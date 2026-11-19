import { useEffect, useRef, type RefObject } from "react";
import { zoomAt, type Camera } from "@remo/canvas";

/**
 * Wheel and pinch are handled by a native listener, not by React's `onWheel`.
 *
 * React registers `wheel` as passive, so `preventDefault()` inside an `onWheel`
 * handler is ignored and the browser is free to zoom the page instead. That is the
 * instability the owner saw: after the page itself is zoomed, the canvas no longer
 * matches pointer coordinates and the board seems to stop responding. Only a
 * `passive: false` listener can claim the gesture.
 *
 *  - two-finger scroll pans the board (a plain wheel), as in the source product;
 *  - a pinch (reported as `ctrlKey` + wheel) or ⌘/Ctrl + scroll zooms around the
 *    pointer.
 */
export function useCanvasWheel(
  overlayRef: RefObject<HTMLCanvasElement | null>,
  camera: Camera,
  setCamera: (camera: Camera) => void,
): void {
  // Latest camera, so the native listeners stay registered for the life of the canvas
  // instead of being torn down on every pan. `setCamera` is the store's stable setter.
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const current = cameraRef.current;
      // Firefox reports line-based deltas; normalise everything to pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;

      // Advance the ref before React re-renders: trackpad momentum sends events
      // faster than a commit, and reading the stale camera would drop deltas.
      if (!(event.ctrlKey || event.metaKey)) {
        const next = {
          ...current,
          x: current.x + dx / current.zoom,
          y: current.y + dy / current.zoom,
        };
        cameraRef.current = next;
        setCamera(next);
        return;
      }

      // A pinch arrives as many small deltas, Ctrl+wheel as one large one. Clamping
      // the factor keeps both usable without a visible jump.
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-dy * 0.005)));
      const next = zoomAt(
        current,
        { x: 0, y: 0, width: rect.width, height: rect.height },
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        factor,
      );
      cameraRef.current = next;
      setCamera(next);
    };

    // Safari also reports a trackpad pinch as gesture events; cancelling them stops
    // the page from zooming even when no wheel reaches us.
    const blockGesture = (event: Event) => event.preventDefault();

    // A pinch that starts over something lying on the canvas (a vote counter, a pin, a
    // bar, the zoom panel) or over the header never reaches the canvas, and the browser
    // magnified the whole page: the panels left the screen and only a reload brought
    // them back. Over the canvas area it zooms the board; anywhere else it is refused.
    // A plain scroll still scrolls the panel under the pointer.
    const onPinchElsewhere = (event: WheelEvent) => {
      if (!event.ctrlKey || event.target === canvas) return;
      const rect = canvas.getBoundingClientRect();
      const over =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (over) onWheelNative(event);
      else event.preventDefault();
    };

    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    document.addEventListener("wheel", onPinchElsewhere, { passive: false });
    document.addEventListener("gesturestart", blockGesture);
    document.addEventListener("gesturechange", blockGesture);
    return () => {
      canvas.removeEventListener("wheel", onWheelNative);
      document.removeEventListener("wheel", onPinchElsewhere);
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("gesturechange", blockGesture);
    };
    // Both are stable (a ref and the store setter), so the listeners register once.
  }, [overlayRef, setCamera]);
}
