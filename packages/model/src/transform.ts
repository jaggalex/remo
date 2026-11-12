import { kindOf } from "./kinds";
import { sizedByTable } from "./tableGeometry";
import type { Widget } from "./types";

/**
 * Whether a block transform may change this object's size (ADR-211).
 *
 * The rule is one place because two layers ask it: the painter decides whether the
 * selection gets handles at all, and the command decides whether to write a size or
 * only a position. A locked object, an imported placeholder and a table section keep
 * their size and only travel.
 */
export function scalesInBlock(widget: Widget): boolean {
  return kindOf(widget.type).resizable && !widget.locked && !sizedByTable(widget);
}
