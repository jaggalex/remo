import type { Widget } from "@remo/model";

/**
 * A uniform grid over widget bounding boxes (ADR-176, review P6).
 *
 * Hit-testing used to walk every object: at 10 000 objects a pointer move did 10 000
 * rectangle checks, and a marquee did the same on release. The grid turns both into
 * "look at the cells the cursor or rectangle touches". It is built once per snapshot
 * and cached by array identity, because `BoardDocument.snapshot()` returns the same
 * array until the document changes.
 *
 * Connectors are not indexed: their stored box is the bounding box of two endpoints and
 * would cover the empty space between them. `pickConnector` tests the line itself.
 */

const CELL = 256;
/**
 * A frame can span the whole board. Indexing it into millions of cells costs more than
 * testing it once, so such a widget goes into a small list every query checks.
 */
const MAX_CELLS = 4096;

export interface SpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOf(widget: Widget): { left: number; top: number; right: number; bottom: number } {
  return {
    left: widget.x - widget.width / 2,
    top: widget.y - widget.height / 2,
    right: widget.x + widget.width / 2,
    bottom: widget.y + widget.height / 2,
  };
}

function key(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

export class SpatialIndex {
  private readonly cells = new Map<string, Widget[]>();
  private readonly oversized: Widget[] = [];
  private readonly order = new Map<string, number>();

  constructor(widgets: readonly Widget[]) {
    widgets.forEach((widget, index) => {
      this.order.set(widget.id, index);
      if (widget.type === "connector") return;
      const box = boxOf(widget);
      const left = Math.floor(box.left / CELL);
      const right = Math.floor(box.right / CELL);
      const top = Math.floor(box.top / CELL);
      const bottom = Math.floor(box.bottom / CELL);
      const cells = (right - left + 1) * (bottom - top + 1);
      if (cells > MAX_CELLS) {
        this.oversized.push(widget);
        return;
      }
      for (let cx = left; cx <= right; cx += 1) {
        for (let cy = top; cy <= bottom; cy += 1) {
          const cell = this.cells.get(key(cx, cy));
          if (cell) cell.push(widget);
          else this.cells.set(key(cx, cy), [widget]);
        }
      }
    });
  }

  /** Widgets whose box may touch `rect`, in document order and without duplicates. */
  query(rect: SpatialRect): Widget[] {
    const left = Math.floor(Math.min(rect.x, rect.x + rect.width) / CELL);
    const right = Math.floor(Math.max(rect.x, rect.x + rect.width) / CELL);
    const top = Math.floor(Math.min(rect.y, rect.y + rect.height) / CELL);
    const bottom = Math.floor(Math.max(rect.y, rect.y + rect.height) / CELL);
    const found = new Map<string, Widget>();
    for (const widget of this.oversized) found.set(widget.id, widget);
    for (let cx = left; cx <= right; cx += 1) {
      for (let cy = top; cy <= bottom; cy += 1) {
        for (const widget of this.cells.get(key(cx, cy)) ?? []) found.set(widget.id, widget);
      }
    }
    return [...found.values()].sort(
      (a, b) => (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0),
    );
  }

  queryPoint(point: { x: number; y: number }): Widget[] {
    return this.query({ x: point.x, y: point.y, width: 0, height: 0 });
  }
}

const cache = new WeakMap<readonly Widget[], SpatialIndex>();

/** The index for this snapshot; the array identity is the cache key. */
export function spatialIndex(widgets: readonly Widget[]): SpatialIndex {
  let index = cache.get(widgets);
  if (!index) {
    index = new SpatialIndex(widgets);
    cache.set(widgets, index);
  }
  return index;
}
