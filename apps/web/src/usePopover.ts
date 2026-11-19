import { useEffect, useRef, useState } from "react";

/**
 * A popover that closes the way people expect.
 *
 * Three toolbars had grown their own copy of this: a boolean or union state, a ref for
 * the panel, a window listener for the click outside and another for Escape, plus a
 * "reset when the target changes" effect. The copies were the same twelve lines with
 * different variable names — and one of them had already lost the Escape handler.
 *
 * `resetKey` closes the popover when the thing it belongs to changes (a different note,
 * a different line), which is what all three wanted.
 */
export function usePopover<T = boolean>(resetKey?: unknown) {
  const [open, setOpen] = useState<T | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(null);
  }, [resetKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture and stop: Escape belongs to the open surface. Without this the board's own
      // listener also ran and dropped the selection the popover was editing (a colour
      // window closed, and the object it belonged to was no longer selected).
      event.stopPropagation();
      setOpen(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return { open, setOpen, ref };
}
