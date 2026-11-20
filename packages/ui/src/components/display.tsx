import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { IconName } from "../icons";
import { useUiStrings } from "../i18n";
import { Icon, Kbd } from "./basics";
import { cx } from "./util";

export type PresenceColor = 1 | 2 | 3 | 4 | 5 | 6;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** A stable presence colour for a name, when the session has not assigned one. */
export function colorFor(name: string): PresenceColor {
  let s = 0;
  for (const c of name) s += c.charCodeAt(0);
  return ((s % 6) + 1) as PresenceColor;
}

const who = (c: number) => ({ "--who": `var(--presence-${c})` }) as CSSProperties;

/**
 * A person's face. `color` picks one of the six presence tokens; `background` carries the
 * session colour instead — the board paints a cursor in that colour, so the face and the
 * pointer of the same person must match (ADR-119, Ш3).
 */
export function Avatar({ name, color, background, size, agent, ring }: { name: string; color?: PresenceColor; background?: string; size?: "sm"; agent?: boolean; ring?: boolean }) {
  return (
    <span className={cx("rm-avatar", size === "sm" && "rm-avatar-sm", agent && "rm-avatar-agent", ring && "rm-avatar-self")}
      style={{ "--av": background ?? `var(--presence-${color ?? colorFor(name)})` } as CSSProperties} title={name} role="img" aria-label={name}>
      {agent ? null : initials(name)}
    </span>
  );
}

/** Presence in the top bar: up to `max` faces and a “+N”. Colours follow join order. */
export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const { t, count } = useUiStrings();
  return (
    <span className="rm-avatar-stack" aria-label={t("onBoard", { members: count("member", names.length) })}>
      {names.slice(0, max).map((n, i) => <Avatar key={i} name={n} size="sm" color={((i % 6) + 1) as PresenceColor} />)}
      {names.length > max && <span className="rm-avatar rm-avatar-sm rm-avatar-more">+{names.length - max}</span>}
    </span>
  );
}

export interface BadgeProps {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  icon?: IconName;
  count?: number;
  onRemove?: () => void;
  children?: ReactNode;
}

/** Status, chip or counter. The tone always comes with a word; success/danger also with an icon. */
export function Badge({ tone = "neutral", icon, count, onRemove, children }: BadgeProps) {
  const { t, locale } = useUiStrings();
  return (
    <span className={cx("rm-badge", `rm-badge-${tone}`, count != null && "rm-badge-count")}>
      {icon && <Icon name={icon} size={12} />}
      {count != null ? new Intl.NumberFormat(locale).format(count) : children}
      {onRemove && (
        <button type="button" className="rm-badge-x" aria-label={t("remove", { name: typeof children === "string" ? children : "" })} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

/**
 * A progress ring, with the number in the middle (`spec/images.md` §9.3).
 *
 * A ring rather than a bar because it sits on a thumbnail of the picture being uploaded;
 * the percentage is text as well, so the state is readable without seeing the arc.
 * Values outside 0…1 are clamped instead of drawn wrong: a stalled upload may report 0,
 * a server that sends more than it announced may report 1.01.
 */
export function ProgressRing({
  value,
  label,
  size = 40,
}: {
  /** 0…1. */
  value: number;
  /** The accessible name; the ring is a `progressbar` only when it has one. */
  label?: string;
  size?: number;
}) {
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const percent = Math.round(fraction * 100);
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return (
    <span
      className="rm-ring"
      style={{ width: size, height: size }}
      role={label ? "progressbar" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? percent : undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="rm-ring-track" cx={centre} cy={centre} r={radius} />
        <circle
          className="rm-ring-value"
          cx={centre}
          cy={centre}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      </svg>
      <span className="rm-ring-label">{percent}%</span>
    </span>
  );
}

export interface TooltipProps {
  label: string;
  shortcut?: string[];
  side?: "bottom" | "top" | "right";
  /** `end` lines the tip up with the trigger's right edge, for controls at the window edge. */
  align?: "center" | "end";
  open?: boolean;
  children: ReactElement;
}

/** How long the pointer rests on a trigger before its tip appears (ADR-231). */
export const TOOLTIP_DELAY_MS = 500;
/** The tip sits 6–8 px from its trigger; the pointer may cross that gap without losing it. */
const TOOLTIP_BRIDGE_PX = 10;

function inside(rect: DOMRect, x: number, y: number, pad = 0) {
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

/**
 * WCAG 1.4.13 (ADR-231): the tip waits before appearing on hover, Escape dismisses it,
 * and it stays while the pointer is over the trigger, the tip or the gap between them.
 * The tip keeps `pointer-events: none`, so "over the tip" is geometry: an open tip never
 * takes a click from whatever lies under it.
 */
export function Tooltip({ label, shortcut, side = "bottom", align = "center", open, children }: TooltipProps) {
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = open || ((hover || focus) && !dismissed);

  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clearTimer, []);

  // While open, follow the pointer outside the trigger and listen for Escape.
  useEffect(() => {
    if (!shown || open) return;
    const onMove = (event: PointerEvent) => {
      const trigger = wrap.current?.getBoundingClientRect();
      const box = tip.current?.getBoundingClientRect();
      const over =
        (trigger && inside(trigger, event.clientX, event.clientY)) ||
        (box && inside(box, event.clientX, event.clientY, TOOLTIP_BRIDGE_PX));
      if (!over) setHover(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The pointer may be on the tip, outside the trigger, where no leave event will
      // reach it: end the hover here so the next entry starts fresh.
      setDismissed(true);
      setHover(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown, open]);

  const onPointerEnter = (event: ReactPointerEvent) => {
    if (event.pointerType === "touch" || hover) return;
    clearTimer();
    timer.current = window.setTimeout(() => {
      setDismissed(false);
      setHover(true);
    }, TOOLTIP_DELAY_MS);
  };
  const onPointerLeave = () => {
    // A pending or dismissed tip ends here; an open one is closed by the geometry check
    // above, so the pointer can cross to the tip.
    clearTimer();
    if (!shown) setHover(false);
  };
  useEffect(() => {
    if (!hover && !focus) setDismissed(false);
  }, [hover, focus]);

  return (
    <span
      ref={wrap}
      className={cx("rm-tooltip-wrap", shown && "is-open")}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={() => clearTimer()}
      onFocus={(event) => {
        // Keyboard focus shows the tip at once; a click's focus does not.
        if ((event.target as HTMLElement).matches?.(":focus-visible")) setFocus(true);
      }}
      onBlur={() => setFocus(false)}
    >
      {isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": id }) : children}
      <span ref={tip} role="tooltip" id={id} className={cx("rm-tooltip", `rm-tooltip-${side}`, align === "end" && "rm-tooltip-end")}>
        {label}
        {shortcut && <Kbd keys={shortcut} />}
      </span>
    </span>
  );
}

export { who };
