import type { Widget, WidgetStyle } from "./types";

/**
 * How far an object stands off the board (ADR-245).
 *
 * Absent means flat. There is no "none" value: clearing the level deletes the field, so a
 * flat object and an old one read the same.
 */
export type Elevation = NonNullable<WidgetStyle["elevation"]>;

export const ELEVATIONS: readonly Elevation[] = ["raised", "floating"];

/**
 * The types that have a ground of their own to lift. Notes and cards are left out on
 * purpose: they already cast their paper shadow (ADR-181, ADR-234), and a second shadow
 * would contradict it.
 */
export const ELEVATING_TYPES: ReadonlySet<Widget["type"]> = new Set(["kanban", "frame", "shape"]);

export function canElevate(widget: Pick<Widget, "type">): boolean {
  return ELEVATING_TYPES.has(widget.type);
}

/** The level an object is painted with; anything unreadable is flat. */
export function elevationOf(widget: Pick<Widget, "type" | "style">): Elevation | null {
  if (!canElevate(widget)) return null;
  const level = widget.style?.elevation;
  return level === "raised" || level === "floating" ? level : null;
}
