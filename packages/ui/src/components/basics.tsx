import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { ICONS, ICONS_16, ICON_FILLS, ICON_FILLS_16, type IconName } from "../icons";
import { useUiStrings } from "../i18n";
import { cx, forced, type Forced } from "./util";

export interface IconProps { name: IconName; size?: number; label?: string; className?: string }

// At 16 px and below the icon uses its own 16 grid (ADR-181): the 24 master scaled down
// lands its lines between pixels.
export function Icon({ name, size = 16, label, className }: IconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  const small = size <= 16;
  const line = small ? ICONS_16[name] : ICONS[name];
  const fill = small ? ICON_FILLS_16[name] : ICON_FILLS[name];
  return (
    <svg className={cx("rm-icon", className)} width={size} height={size} viewBox={small ? "0 0 16 16" : "0 0 24 24"} fill="none"
      stroke="currentColor" strokeWidth={small ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round" focusable="false" {...a11y}>
      {line && <path d={line} />}
      {fill && <path d={fill} fill="currentColor" stroke="none" fillRule="evenodd" />}
    </svg>
  );
}

export function Spinner({ size, label }: { size?: "sm"; label?: string }) {
  return <span className={cx("rm-spinner", size === "sm" && "rm-spinner-sm")} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export function Skeleton({ width = "100%", height = 12, round }: { width?: number | string; height?: number; round?: boolean }) {
  return <span className="rm-skeleton" aria-hidden="true" style={{ width, height, borderRadius: round ? 999 : undefined }} />;
}

export function Kbd({ keys }: { keys: string[] }) {
  return <span className="rm-kbd-group">{keys.map((k, i) => <kbd key={i} className="rm-kbd">{k}</kbd>)}</span>;
}

export function Separator({ vertical }: { vertical?: boolean }) {
  return <hr className={cx("rm-sep", vertical && "rm-sep-v")} aria-orientation={vertical ? "vertical" : undefined} />;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "compact" | "default";
  icon?: IconName;
  iconEnd?: IconName;
  loading?: boolean;
  /** Only for toggle buttons: becomes aria-pressed. */
  selected?: boolean;
  force?: Forced;
}

/** One action in its context. Never navigation (use Link), never more than one primary per dialog. */
export function Button({ variant = "secondary", size, icon, iconEnd, loading, selected, force, className, children, disabled, onClick, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest}
      className={cx("rm-btn", `rm-btn-${variant}`, size && `rm-${size}`, loading && "is-loading", forced(force), className)}
      aria-busy={loading || undefined}
      aria-pressed={typeof selected === "boolean" ? selected : undefined}
      disabled={disabled || loading}
      onClick={loading ? undefined : onClick}>
      {loading ? <Spinner size="sm" /> : icon ? <Icon name={icon} /> : null}
      {children != null && <span className="rm-btn-label">{children}</span>}
      {iconEnd && <Icon name={iconEnd} />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: becomes aria-label. */
  label: string;
  size?: "compact" | "default";
  variant?: "ghost" | "secondary" | "ghost-danger";
  selected?: boolean;
  iconSize?: number;
  force?: Forced;
  /** A counter on the corner, e.g. unread comments; the label still carries the number. */
  count?: number;
}

export function IconButton({ icon, label, size, variant = "ghost", selected, iconSize = 16, force, className, count, ...rest }: IconButtonProps) {
  const { locale } = useUiStrings();
  return (
    <button type="button" {...rest}
      className={cx("rm-btn", `rm-btn-${variant}`, "rm-iconbtn", size && `rm-${size}`, selected && "is-selected", forced(force), className)}
      aria-label={label}
      aria-pressed={typeof selected === "boolean" ? selected : undefined}>
      <Icon name={icon} size={iconSize} />
      {count != null && count > 0 && (
        <span className="rm-iconbtn-count" aria-hidden="true">{new Intl.NumberFormat(locale).format(count)}</span>
      )}
    </button>
  );
}

export function Link({ className, children, force, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; force?: Forced }) {
  return <a {...rest} className={cx("rm-link", forced(force), className)}>{children}</a>;
}
