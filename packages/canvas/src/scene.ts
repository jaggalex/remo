import type { Rect, Widget } from "@remo/model";
import type { Camera } from "./camera";

/**
 * The world rectangle currently on screen, grown by a margin so partially visible
 * objects and their shadows are not clipped.
 */
export function visibleWorldRect(
  camera: Camera,
  viewport: { width: number; height: number },
  margin = 64,
): Rect {
  const width = viewport.width / camera.zoom;
  const height = viewport.height / camera.zoom;
  return {
    x: camera.x - width / 2 - margin,
    y: camera.y - height / 2 - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function widgetRect(widget: Widget): Rect {
  return {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
}

export function isVisible(widget: Widget, visible: Rect): boolean {
  return rectsOverlap(widgetRect(widget), visible);
}

/** Fraction of the given widgets that would be drawn at this camera. */
export function visibleFraction(widgets: Widget[], visible: Rect): number {
  if (!widgets.length) return 1;
  return widgets.filter((widget) => isVisible(widget, visible)).length / widgets.length;
}
