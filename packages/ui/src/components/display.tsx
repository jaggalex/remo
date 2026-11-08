import { cloneElement, isValidElement, useId, type CSSProperties, type ReactElement, type ReactNode } from "react";
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

export interface TooltipProps { label: string; shortcut?: string[]; side?: "bottom" | "top" | "right"; open?: boolean; children: ReactElement }

export function Tooltip({ label, shortcut, side = "bottom", open, children }: TooltipProps) {
  const id = useId();
  return (
    <span className={cx("rm-tooltip-wrap", open && "is-open")}>
      {isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": id }) : children}
      <span role="tooltip" id={id} className={cx("rm-tooltip", `rm-tooltip-${side}`)}>
        {label}
        {shortcut && <Kbd keys={shortcut} />}
      </span>
    </span>
  );
}

export { who };
