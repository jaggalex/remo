import { useRef, type ReactNode } from "react";
import { useWindowClamp } from "./windowClamp";

/**
 * The wrapper every panel window gets (ADR-129).
 *
 * It is `display: contents`: it adds no box, so the window stays exactly where its CSS
 * put it (an absolute child of the bar's anchor) and the clamped offset is measured, not
 * computed twice. One wrapper for the colour window, the alignment popover, "More" and
 * every other window a floating bar opens.
 */
export function PanelWindow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useWindowClamp(ref);
  return (
    <span ref={ref} className="panel-window">
      {children}
    </span>
  );
}
