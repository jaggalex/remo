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

/** Widgets in paint order: first is furthest back. */
export function paintOrder(widgets: Widget[]): Widget[] {
  return [...widgets].sort((a, b) => layerKey(a) - layerKey(b));
}
