import { useSyncExternalStore } from "react";
import type { Camera } from "@remo/canvas";

/**
 * The camera lives outside React (review P6).
 *
 * Panning used to call `setCamera` in `BoardApp`, so every pointer move re-rendered the
 * whole board tree — forty-four hooks and every panel — to move a canvas transform. The
 * store is the source of truth now: the canvas subscribes and repaints, the rest of the
 * app reads `cameraStore.get()` when an action actually needs the viewport (a new note,
 * a timer, a vote chip). `useCamera()` is for components that must follow every frame;
 * do not call it in `BoardApp`, or the render is back.
 */
const INITIAL: Camera = { x: 0, y: 0, zoom: 0.4 };

/**
 * Who moved the camera. `follow` must not pause the mirror; `fit` (a full-screen fit or
 * an imported board) is a local move from the follower's point of view.
 */
export type CameraSource = "local" | "follow" | "fit";

class CameraStore {
  private value: Camera = INITIAL;
  private listeners = new Set<(source: CameraSource) => void>();

  get = (): Camera => this.value;

  set = (next: Camera, source: CameraSource = "local"): void => {
    if (
      next.x === this.value.x &&
      next.y === this.value.y &&
      next.zoom === this.value.zoom
    ) {
      return;
    }
    this.value = next;
    for (const listener of this.listeners) listener(source);
  };

  update = (change: (camera: Camera) => Camera, source: CameraSource = "local"): void => {
    this.set(change(this.value), source);
  };

  subscribe = (listener: (source: CameraSource) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const cameraStore = new CameraStore();

/** Subscribe to every camera change. Canvas-only: it re-renders its caller. */
export function useCamera(): Camera {
  return useSyncExternalStore(
    (listener) => cameraStore.subscribe(() => listener()),
    cameraStore.get,
    cameraStore.get,
  );
}
