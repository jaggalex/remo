import type { AgentPlan, PlanBounds } from "@remo/doc";

/**
 * The miniature of a plan: geometry only, no wording (ADR-142, M3).
 *
 * The preview is a read, not a render of the board: objects are centre-anchored
 * boxes, connectors join two planned objects, and an endpoint that lives on the
 * board already has no place in the map. A broken or empty plan must not throw in
 * the dialog, so every number is checked before it reaches a viewBox.
 */

export interface PlanMapRect {
  key: string;
  type: string;
  /** Top-left corner in board coordinates, not the centre the plan stores. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanMapLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlanMapLayout {
  rects: PlanMapRect[];
  lines: PlanMapLine[];
  bounds: PlanBounds;
  viewBox: string;
  /** No planned object can be drawn: the dialog shows a placeholder instead. */
  empty: boolean;
}

const EMPTY_BOUNDS: PlanBounds = { x: 0, y: 0, width: 0, height: 0 };

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

interface MapObject {
  tempId: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function readObject(value: unknown): MapObject | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const x = finite(item.x);
  const y = finite(item.y);
  const width = finite(item.width);
  const height = finite(item.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    tempId: String(item.tempId ?? ""),
    type: String(item.type ?? "unsupported"),
    x,
    y,
    width,
    height,
  };
}

function boundsOf(objects: MapObject[]): PlanBounds | null {
  if (!objects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    minX = Math.min(minX, object.x - object.width / 2);
    minY = Math.min(minY, object.y - object.height / 2);
    maxX = Math.max(maxX, object.x + object.width / 2);
    maxY = Math.max(maxY, object.y + object.height / 2);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function readBounds(value: PlanBounds | null | undefined): PlanBounds | null {
  if (!value) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const width = finite(value.width);
  const height = finite(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

/** A number in a viewBox, short enough to read and exact enough to place a line. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Lay the plan out for an SVG viewBox. The estimate's bounds are the plan's own
 * measurement; when they are missing or broken the boxes are measured here, and a
 * plan with no readable box returns `empty`.
 */
export function planMapLayout(
  plan: Partial<Pick<AgentPlan, "objects" | "connectors">> | null | undefined,
  fallbackBounds?: PlanBounds | null,
): PlanMapLayout {
  const rawObjects = Array.isArray(plan?.objects) ? plan.objects : [];
  const objects: MapObject[] = [];
  rawObjects.forEach((value, index) => {
    const object = readObject(value);
    if (object) objects.push({ ...object, tempId: object.tempId || `object_${index + 1}` });
  });

  const rects: PlanMapRect[] = objects.map((object) => ({
    key: object.tempId,
    type: object.type,
    x: object.x - object.width / 2,
    y: object.y - object.height / 2,
    width: object.width,
    height: object.height,
  }));
  // Frames are containers: paint them under the leaves so a lane never hides a story.
  rects.sort((first, second) => {
    const rank = (type: string) => (type === "frame" ? 0 : 1);
    return rank(first.type) - rank(second.type);
  });

  const byId = new Map(objects.map((object) => [object.tempId, object]));
  const rawConnectors = Array.isArray(plan?.connectors) ? plan.connectors : [];
  const lines: PlanMapLine[] = [];
  rawConnectors.forEach((connector, index) => {
    if (!connector || typeof connector !== "object") return;
    const from = byId.get(String((connector as { from?: unknown }).from ?? ""));
    const to = byId.get(String((connector as { to?: unknown }).to ?? ""));
    // An endpoint already on the board has no coordinates in the plan; drawing it
    // to the origin would lie about where the line goes.
    if (!from || !to) return;
    lines.push({
      key: String((connector as { tempId?: unknown }).tempId ?? `connector_${index + 1}`),
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
    });
  });

  const measured = boundsOf(objects);
  const bounds = measured ?? readBounds(fallbackBounds) ?? EMPTY_BOUNDS;
  const empty = rects.length === 0;

  // A margin keeps the edge of a frame off the crop and leaves room for a connector
  // that starts at a box's centre. Five percent works for one note and for 300.
  const span = Math.max(bounds.width, bounds.height, 1);
  const pad = Math.max(span * 0.05, 8);
  const viewBox = [
    round(bounds.x - pad),
    round(bounds.y - pad),
    round(Math.max(bounds.width, 1) + pad * 2),
    round(Math.max(bounds.height, 1) + pad * 2),
  ].join(" ");

  return { rects, lines, bounds, viewBox, empty };
}
