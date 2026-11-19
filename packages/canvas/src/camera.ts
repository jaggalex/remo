import type { Rect, Vec2 } from "@remo/model";

/** Viewport camera. `x`/`y` is the world point shown at the viewport centre (ADR-015). */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

export function screenToWorld(camera: Camera, viewport: Rect, point: Vec2): Vec2 {
  return {
    x: camera.x + (point.x - viewport.width / 2) / camera.zoom,
    y: camera.y + (point.y - viewport.height / 2) / camera.zoom,
  };
}

export function worldToScreen(camera: Camera, viewport: Rect, point: Vec2): Vec2 {
  return {
    x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

/** Zoom while keeping the world point under the cursor stationary. */
export function zoomAt(
  camera: Camera,
  viewport: Rect,
  cursor: Vec2,
  factor: number,
): Camera {
  const zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const before = screenToWorld(camera, viewport, cursor);
  const after = screenToWorld({ ...camera, zoom }, viewport, cursor);
  return {
    zoom,
    x: camera.x + (before.x - after.x),
    y: camera.y + (before.y - after.y),
  };
}

export function fitToBounds(bounds: Rect, viewport: Rect, padding = 0.9): Camera {
  const zoom = clamp(
    Math.min(viewport.width / bounds.width, viewport.height / bounds.height) * padding,
    MIN_ZOOM,
    MAX_ZOOM,
  );
  return {
    zoom,
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
