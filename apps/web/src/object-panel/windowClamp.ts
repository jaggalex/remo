import { useLayoutEffect, type RefObject } from "react";

/**
 * Where a panel window may sit, and where it ends up (ADR-129).
 *
 * A bar's popover is absolutely positioned inside the bar, so its place is a function of
 * the object's box, the camera and the anchor — none of which know about the rail, the
 * inspector or the viewport edges. This module answers one question for every window:
 * given its measured rectangle and the strip it may occupy, how far must it move and how
 * tall may it be? The numbers are pure, so the rule is tested without a browser.
 */

/** A measured rectangle, in viewport coordinates. */
export interface WindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The strip a window may occupy, in viewport coordinates. */
export interface WindowBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WindowPlacement {
  /** Horizontal shift, in pixels; 0 when the window already fits. */
  dx: number;
  /** Vertical shift; up when the window would run past the bottom edge. */
  dy: number;
  /** Set only when the window is taller than the strip: the rest scrolls. */
  maxHeight: number | null;
}

/** Air between a window and every edge it is pushed away from. */
export const WINDOW_EDGE = 8;
/** The rail's own offset from the left edge (ADR-119, Р3). */
export const RAIL_GAP = 12;

/**
 * Move a window into the strip.
 *
 * Horizontally the window is pushed right off the rail and left off the inspector; it is
 * never widened, because a window narrower than its content is unreadable. Vertically it
 * follows the bar: down when there is room, up when there is not, and when neither fits
 * it is pinned to the top of the strip and scrolls inside itself.
 */
export function placeWindow(rect: WindowRect, bounds: WindowBounds): WindowPlacement {
  const width = Math.min(rect.width, Math.max(0, bounds.right - bounds.left));
  let dx = 0;
  if (rect.left < bounds.left) dx = bounds.left - rect.left;
  else if (rect.left + width > bounds.right) dx = bounds.right - (rect.left + width);

  const available = Math.max(0, bounds.bottom - bounds.top);
  const height = Math.min(rect.height, available);
  let dy = 0;
  if (rect.top + height > bounds.bottom) dy = bounds.bottom - (rect.top + height);
  if (rect.top + dy < bounds.top) dy = bounds.top - rect.top;

  return {
    dx: Math.round(dx),
    dy: Math.round(dy),
    maxHeight: rect.height > available ? Math.round(available) : null,
  };
}

function token(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return Number.parseFloat(raw) || fallback;
}

/**
 * The strip a panel window may occupy right now.
 *
 * The left reserve is the rail: its token width plus the offset it floats at. The right
 * reserve is the inspector, measured from the element and only while it is painted — a
 * closed inspector must not keep its width as a margin, and the number is never guessed
 * (the panel was 264 px when ADR-127 was written and the store is not the place for it).
 * The top reserve is the header, so a window pushed up never hides under it.
 */
export function panelWindowBounds(viewport: { width: number; height: number }): WindowBounds {
  const rail = token("--toolbar-width", 48) + RAIL_GAP;
  const top = token("--topbar-height", 52) + WINDOW_EDGE;

  let right = viewport.width - WINDOW_EDGE;
  if (typeof document !== "undefined") {
    const inspector = document.querySelector<HTMLElement>(".inspector");
    // `display: none` (the folded inspector) has no client rects, so it reserves nothing.
    if (inspector && inspector.getClientRects().length > 0) {
      right = Math.min(right, inspector.getBoundingClientRect().left - WINDOW_EDGE);
    }
  }

  return {
    left: rail,
    top,
    right: Math.max(rail + 1, right),
    bottom: viewport.height - WINDOW_EDGE,
  };
}

/**
 * Keep one window inside the strip.
 *
 * Attach the returned host to a `display: contents` wrapper around the design-system
 * `Popover` or `Menu`: the wrapper keeps the window where CSS put it, and this hook moves
 * the window itself with `translate` (never `transform`, which the centred alignment
 * popover already uses) and caps its height. Applied after every render and on resize or
 * content change, because a window grows when a label appears in it.
 */
export function useWindowClamp(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const windowOf = () => (host.firstElementChild as HTMLElement | null) ?? host;

    const apply = () => {
      const element = windowOf();
      if (!element) return;
      // Measure the window as CSS placed it, not as a previous pass moved it.
      element.style.translate = "";
      element.style.maxHeight = "";
      element.style.overflowY = "";
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const placement = placeWindow(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        panelWindowBounds({ width: window.innerWidth, height: window.innerHeight }),
      );
      if (placement.dx || placement.dy) {
        element.style.translate = `${placement.dx}px ${placement.dy}px`;
      }
      if (placement.maxHeight != null) {
        element.style.maxHeight = `${placement.maxHeight}px`;
        element.style.overflowY = "auto";
      }
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(windowOf());
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  });
}
