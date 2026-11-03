import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a text field instead of acting immediately. */
  rename?: { value: string; commit: (value: string) => void };
}

export interface MenuState {
  /** Client coordinates of the click that opened the menu. */
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
}

/**
 * Canvas context menu.
 *
 * The source product puts column and swimlane actions behind a click on the header
 * (rename) and a right-click (add / delete / move), so the same affordance is used
 * here instead of a hidden toolbar button.
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: MenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /**
   * Where the menu actually lands.
   *
   * A menu opened near the bottom or the right edge used to be cut off by the
   * viewport, taking its last items — Delete, usually — with it. The position is
   * measured after layout and clamped, so every item stays clickable (ADR-045).
   */
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state) {
      setPlacement(null);
      return;
    }
    const node = ref.current;
    if (!node) return;
    const margin = 8;
    const { width, height } = node.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const left = Math.min(Math.max(margin, state.x), maxLeft);
    // Prefer opening downwards from the click; flip above it when there is no room,
    // which is what keeps the first items visible instead of just the last ones.
    const top =
      state.y + height + margin > window.innerHeight
        ? Math.min(Math.max(margin, state.y - height), maxTop)
        : Math.min(Math.max(margin, state.y), maxTop);
    setPlacement({ left, top });
  }, [state]);

  const renaming = state?.items.find((item) => item.rename)?.rename ?? null;

  useEffect(() => {
    setRenameValue(renaming?.value ?? "");
  }, [renaming]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, state]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{
        left: (placement ?? { left: state.x, top: state.y }).left,
        top: (placement ?? { left: state.x, top: state.y }).top,
        // Hidden for the one frame before the measurement lands, so the menu never
        // flashes at a position it is about to leave.
        visibility: placement ? undefined : "hidden",
      }}
      role="menu"
      aria-label={state.title}
    >
      <div className="context-menu-title">{state.title}</div>
      {state.items.map((item) =>
        item.rename ? (
          <form
            key={item.label}
            className="context-menu-rename"
            onSubmit={(event) => {
              event.preventDefault();
              item.rename?.commit(renameValue.trim());
              onClose();
            }}
          >
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              aria-label={item.label}
            />
            <button type="submit">OK</button>
          </form>
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
