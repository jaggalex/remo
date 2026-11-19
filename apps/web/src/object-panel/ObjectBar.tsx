import { forwardRef, type ReactNode } from "react";

export interface ObjectBarProps {
  /** Where the bar goes, already clamped to the canvas by `useFloatingBars`. */
  placement: { left: number; top: number };
  /** What this toolbar is, in words; the caller resolves the i18n key. */
  label: string;
  /** Extra surface class, so one bar can widen the shared frame (`connector-bar`). */
  className?: string;
  children: ReactNode;
}

/**
 * The frame every floating object bar is drawn in.
 *
 * A bar sits on the overlay, not in the sidebar, because it holds properties of the
 * thing you are looking at (ADR-027). What it shows differs per object and lives in the
 * panel next to this file; what does not differ is the frame, the placement already
 * clamped to the canvas, and the one rule that keeps the caret in the note while a
 * property button is pressed (ADR-120, ADR-124).
 *
 * No domain logic here on purpose: this file must not learn about notes, shapes or lines.
 */
export const ObjectBar = forwardRef<HTMLDivElement, ObjectBarProps>(function ObjectBar(
  { placement, label, className, children },
  ref,
) {
  return (
    <div
      ref={ref}
      className={className ? `sticky-bar ${className}` : "sticky-bar"}
      role="toolbar"
      aria-label={label}
      style={placement}
      // The caret must not leave the note when a property button is pressed.
      onPointerDown={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
});
