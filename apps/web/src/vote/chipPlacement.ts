import {
  boxOf,
  connectorPath,
  labelPoint,
  type Camera,
  type StubOptions,
} from "@remo/canvas";
import type { Widget } from "@remo/model";

/**
 * Where the vote counter sits on its object (ADR-119.3, ADR-117).
 *
 * The chip belongs to the object, not to the camera: it is pinned inside the object's
 * bottom-right corner by the same 8 px for every object and every zoom level, and the
 * object itself is never moved to make room. Two things can still get in the way: a
 * connector's label, which the board paints above objects, and a neighbour's plate.
 * The chip slides left along the object's own bottom edge until it is clear, and stops
 * at the object's left side — a counter that leaves its object no longer reads as its
 * counter. Whatever happens, the result is clamped into the canvas so it can always be
 * clicked.
 *
 * Pure geometry on purpose: the layer measures DOM and camera state, this file only
 * decides numbers, so the rule can be tested without a browser.
 */

/** A rectangle in screen pixels, the way `getBoundingClientRect` reports it. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Top-left corner of the chip inside the canvas, in CSS pixels. */
export interface ChipPlacement {
  left: number;
  top: number;
}

/** Gap between the chip and the object's own corner. */
export const CHIP_INSET = 8;

/** Gap kept between the chip and the canvas edge, so a clamped chip stays clickable. */
export const CHIP_VIEWPORT_MARGIN = 8;

/** How far the chip moves per attempt when something covers its corner. */
const SLIDE_STEP = 8;

/** Longest label the painter draws before it truncates (`fitOneLine` in render.ts). */
const LABEL_MAX_WIDTH = 260;

export function chipPlacement({
  object,
  chip,
  viewport,
  obstacles,
  leftInset = CHIP_VIEWPORT_MARGIN,
}: {
  /** The object's box on screen. */
  object: Box;
  /** The chip's measured size. */
  chip: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Labels and neighbouring objects the chip must not cover. */
  obstacles: readonly Box[];
  /** Space kept free on the left: the floating rail lives there (S5b). */
  leftInset?: number;
}): ChipPlacement {
  const top = object.y + object.height - CHIP_INSET - chip.height;
  const corner = object.x + object.width - CHIP_INSET - chip.width;
  const leftmost = object.x + CHIP_INSET;

  let left = corner;
  for (let candidate = corner; candidate >= leftmost; candidate -= SLIDE_STEP) {
    const rect = { x: candidate, y: top, width: chip.width, height: chip.height };
    if (!obstacles.some((obstacle) => intersects(rect, obstacle))) {
      left = candidate;
      break;
    }
  }

  return {
    left: clamp(left, leftInset, viewport.width - chip.width - CHIP_VIEWPORT_MARGIN),
    top: clamp(top, CHIP_VIEWPORT_MARGIN, viewport.height - chip.height - CHIP_VIEWPORT_MARGIN),
  };
}

/** True when the two rectangles share any area; touching edges do not count. */
export function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** A world-space box, projected the way the painters do it. */
export function screenBox(
  box: Box,
  camera: Camera,
  viewport: { width: number; height: number },
): Box {
  return {
    x: (box.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (box.y - camera.y) * camera.zoom + viewport.height / 2,
    width: box.width * camera.zoom,
    height: box.height * camera.zoom,
  };
}

/**
 * Every object's plate on screen — the neighbours a chip must not cover.
 *
 * Connectors are left out: their stored box is a leftover of creation, not the line the
 * board draws, so it would block a corner that is actually free.
 */
export function objectBoxes(
  widgets: readonly Widget[],
  resolve: (id: string) => Widget | undefined,
  camera: Camera,
  viewport: { width: number; height: number },
): Array<{ id: string; box: Box }> {
  return widgets
    .filter((widget) => widget.type !== "connector")
    .map((widget) => ({
      id: widget.id,
      box: screenBox(boxOf(resolve(widget.id) ?? widget), camera, viewport),
    }));
}

/**
 * World boxes of connector labels, which the board paints above objects.
 *
 * Mirrors the painter (`render.ts`): the label is a chip centred on `labelAt`, its text
 * measured in the board's font and capped at 260 world px before truncation. World
 * units on purpose — the camera moves every frame, the text does not change until the
 * document or the font does. Over-estimating is safe here: the chip simply slides a
 * little further left.
 */
export function connectorLabelBoxes({
  widgets,
  resolve,
  stubs,
  fontFamily,
}: {
  widgets: readonly Widget[];
  resolve: (id: string) => Widget | undefined;
  stubs: StubOptions;
  fontFamily: string;
}): Box[] {
  const boxes: Box[] = [];
  for (const widget of widgets) {
    if (widget.type !== "connector") continue;
    const text = widget.content?.trim();
    if (!text) continue;
    const live = resolve(widget.id) ?? widget;
    const path = connectorPath(live, resolve, stubs);
    if (!path) continue;
    const at = labelPoint(path, live.labelAt);
    const fontPx = live.style?.fontSize ?? 13;
    const width = labelWidth(text, fontPx, fontFamily);
    const height = fontPx * 1.6;
    boxes.push({ x: at.x - width / 2, y: at.y - height / 2, width, height });
  }
  return boxes;
}

/** Width of the label chip in world units, as the painter draws it. */
export function labelWidth(text: string, fontPx: number, fontFamily: string): number {
  const measured = measure(text, `500 ${fontPx}px ${fontFamily}`);
  // `fitOneLine` truncates at 260, so the text can never be wider than that.
  const textWidth = Math.min(measured ?? estimate(text, fontPx), LABEL_MAX_WIDTH);
  // The painter adds 0.46 font px of padding on each side.
  return textWidth + fontPx * 0.92;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function measure(text: string, font: string): number | null {
  if (measureContext === undefined) {
    measureContext =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return null;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/** Inter is not loaded in Node; this keeps the rule deterministic there. */
function estimate(text: string, fontPx: number): number {
  return text.length * fontPx * 0.62;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
