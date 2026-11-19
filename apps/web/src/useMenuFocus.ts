import { useEffect, useRef } from "react";

/**
 * Keyboard entry and exit for a design-system menu opened from a bar button.
 *
 * `Menu` expects focus inside it: without this, a keyboard user opens "More" and reaches
 * nothing. Focus comes back to the trigger on close, so Escape does not drop the person
 * at the top of the page. One hook for every menu on the floating bars and in the top bar
 * (ADR-124).
 *
 * `item` names what to focus on open: a menu focuses its first item, a popover its first
 * control (there are no `menuitem`s in a form-like surface).
 */
export function useMenuFocus<T>(open: T | null, key: T, item = '[role^="menuitem"]') {
  const ref = useRef<HTMLSpanElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open === key) {
      wasOpen.current = true;
      ref.current?.querySelector<HTMLElement>(item)?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      ref.current?.querySelector<HTMLElement>("button")?.focus();
    }
    // `item` is a literal at every call site; re-running on it would only re-focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  return ref;
}
