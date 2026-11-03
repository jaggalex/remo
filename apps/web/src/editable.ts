import { kindOf, type Widget } from "@remo/model";

/** Types of object whose text can be edited on the canvas. */
export function isEditable(widget: Widget): boolean {
  // Locking is a property of the instance; whether the kind takes text at all is a
  // property of the kind (ADR-040, ADR-049).
  return !widget.locked && kindOf(widget.type).editable;
}
