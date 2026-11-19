import { kindOf, WIDGET_KINDS } from "./kinds";
import type { Widget, WidgetType } from "./types";

/**
 * Base painting layer per object type.
 *
 * This is only a *starting* order: frames below, lines above them, notes and text on
 * top. Once someone moves a layer (ADR-039) the widget carries its own `z`, which
 * wins over the base. Keeping the base here, in the model, is what lets the document
 * commands and the painter agree on one order without the canvas package being
 * imported by the doc package.
 */
export const PAINT_RANK: Record<string, number> = Object.fromEntries(
  (Object.keys(WIDGET_KINDS) as WidgetType[]).map((type) => [type, WIDGET_KINDS[type].rank]),
);

/** Rank of a widget's type; higher means painted later, hence on top. */
export function rankOf(widget: Widget): number {
  return kindOf(widget.type).rank;
}

/**
 * Where the widget sits in the stacking order.
 *
 * `z` is an explicit decision and wins; without one the type decides. Both live in
 * one numeric space (the base layers are thousands apart) so a moved object can be
 * placed between two others without rewriting every widget on the board.
 */
export function layerKey(widget: Widget): number {
  return widget.z ?? rankOf(widget) * 1000;
}

/**
 * How many frames each widget sits inside (ADR-242). A cycle in bad data stops the walk
 * instead of looping.
 */
export function nestingDepth(widgets: readonly Widget[]): Map<string, number> {
  const parentOf = new Map(widgets.map((widget) => [widget.id, widget.parentId ?? null]));
  const depth = new Map<string, number>();
  for (const widget of widgets) {
    let level = 0;
    let current = widget.parentId ?? null;
    const seen = new Set<string>([widget.id]);
    while (current && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      level += 1;
      current = parentOf.get(current) ?? null;
    }
    depth.set(widget.id, level);
  }
  return depth;
}

/**
 * Widgets in paint order: first is furthest back. Equal layer keys are broken by
 * nesting, so a section inside another is painted after its parent and is never hidden
 * under the parent's plate (ADR-242). Otherwise the document order stands.
 */
export function paintOrder(widgets: Widget[]): Widget[] {
  const depth = nestingDepth(widgets);
  return [...widgets].sort(
    (a, b) => layerKey(a) - layerKey(b) || (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0),
  );
}
