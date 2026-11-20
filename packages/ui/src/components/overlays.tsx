import { Children, isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { IconName } from "../icons";
import { useUiStrings } from "../i18n";
import { Button, Icon, IconButton, Kbd } from "./basics";
import { cx, forced, type Forced } from "./util";

// ---------- Menu ----------

export type MenuItem =
  | { separator: true }
  | { heading: string }
  | { label: string; icon?: IconName; shortcut?: string[]; hint?: string; checked?: boolean; disabled?: boolean; danger?: boolean; submenu?: boolean; force?: Forced; onSelect?: () => void };

/**
 * Menu and context menu are one component (right click and Shift+F10 open the same).
 *
 * `children` is a slot after the items, for a row of choices that does not read as a
 * list of labels — the reaction picker in the facilitation menu (ADR-119
 * §10, Home-Menus). Actions inside it must carry `role="menuitem"` so the arrow keys
 * and Escape keep working.
 */
export function Menu({ items, label, width, onClose, children }: { items: MenuItem[]; label?: string; width?: number; onClose?: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); (list[i + 1] ?? list[0])?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (list[i - 1] ?? list[list.length - 1])?.focus(); }
    if (e.key === "Escape") onClose?.();
  };
  return (
    <div className="rm-menu" role="menu" aria-label={label} ref={ref} onKeyDown={onKey} style={width ? { width } : undefined}>
      {items.map((it, i) => {
        if ("separator" in it) return <div key={i} className="rm-menu-sep" role="separator" />;
        if ("heading" in it) return <div key={i} className="rm-menu-heading">{it.heading}</div>;
        return (
          <button key={i} type="button" role={it.checked != null ? "menuitemcheckbox" : "menuitem"} tabIndex={-1}
            className={cx("rm-menu-item", it.danger && "is-danger", forced(it.force))}
            aria-checked={it.checked != null ? !!it.checked : undefined} aria-disabled={it.disabled || undefined}
            onClick={it.disabled ? undefined : it.onSelect}>
            <span className="rm-menu-icon">{it.checked ? <Icon name="check" /> : it.icon ? <Icon name={it.icon} /> : null}</span>
            <span className="rm-menu-label">{it.label}{it.hint && <span className="rm-menu-hint">{it.hint}</span>}</span>
            {it.shortcut ? <Kbd keys={it.shortcut} /> : it.submenu ? <Icon name="chevron-right" /> : null}
          </button>
        );
      })}
      {children}
    </div>
  );
}

// ---------- Dialog ----------

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Counts primary/danger buttons in a footer: П2 allows exactly one. */
export function countPrimary(node: ReactNode): number {
  let n = 0;
  Children.forEach(node, (c) => {
    if (!isValidElement<{ variant?: string; children?: ReactNode }>(c)) return;
    if (c.props.variant === "primary" || c.props.variant === "danger") n++;
    else if (typeof c.type === "string") n += countPrimary(c.props.children);
  });
  return n;
}

export interface DialogProps {
  title: string;
  description?: string;
  /** One help link for the whole dialog, beside the title (a `?` icon that opens help). */
  help?: ReactNode;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
  onClose?: () => void;
  dismissable?: boolean;
  /** Render in place without scrim and focus trap (catalogue, baselines). */
  inline?: boolean;
  alert?: boolean;
  children?: ReactNode;
}

export function Dialog({ title, description, help, size = "md", footer, onClose, dismissable = true, inline, alert, children }: DialogProps) {
  const { t } = useUiStrings();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV && footer && countPrimary(footer) > 1) console.warn(`[@remo/ui] Dialog “${title}”: more than one primary/danger button (П2).`);
  // Focus at first render, kept only for the case below.
  const [atRender] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    if (inline) return;
    const active = document.activeElement as HTMLElement | null;
    // The opener is what holds focus now (a menu has already handed focus back to its
    // trigger). If a field in the dialog took focus on mount (autoFocus), it keeps it, and
    // the opener is what held focus when the dialog first rendered.
    const tookFocus = Boolean(ref.current?.contains(active));
    const opener = tookFocus ? atRender : active;
    if (!tookFocus) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus?.();
  }, [inline, atRender]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && onClose && dismissable) { e.stopPropagation(); onClose(); }
    if (e.key === "Tab" && !inline && ref.current) {
      const list = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };
  const box = (
    <div ref={ref} className={cx("rm-dialog", `rm-dialog-${size}`)} role={alert ? "alertdialog" : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby={titleId} onKeyDown={onKey}>
      <div className="rm-dialog-head">
        <div className="rm-dialog-heading">
          <h2 id={titleId} className="rm-dialog-title">{title}</h2>
          {help && <span className="rm-dialog-help">{help}</span>}
        </div>
        {onClose && dismissable && <IconButton icon="close" label={t("close")} size="compact" onClick={onClose} />}
      </div>
      {description && <p className="rm-dialog-desc">{description}</p>}
      <div className="rm-dialog-body">{children}</div>
      {footer && <div className="rm-dialog-foot">{footer}</div>}
    </div>
  );
  if (inline) return box;
  return (
    <div className="rm-dialog-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose && dismissable) onClose(); }}>
      {box}
    </div>
  );
}

export interface ConfirmDialogProps {
  count?: number;
  title?: string;
  confirmLabel?: string;
  tone?: "danger" | "accent";
  loading?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  inline?: boolean;
  children?: ReactNode;
}

/** “Delete 12 objects?” — the verb and the number in the title and on the button. */
export function ConfirmDialog({ count: n, title, confirmLabel, tone = "danger", loading, onConfirm, onCancel, inline, children }: ConfirmDialogProps) {
  const { t, count } = useUiStrings();
  const label = n != null ? t("deleteCount", { objects: count("object", n) }) : t("delete");
  return (
    <Dialog title={title ?? `${label}?`} size="sm" inline={inline} alert onClose={onCancel}
      footer={<>
        <Button variant="secondary" size="default" onClick={onCancel}>{t("cancel")}</Button>
        <Button variant={tone === "accent" ? "primary" : "danger"} size="default" onClick={onConfirm} loading={loading}>{confirmLabel ?? label}</Button>
      </>}>
      {children}
    </Dialog>
  );
}

// ---------- Popover ----------

export function Popover({ title, label, side = "bottom", width, footer, onClose, children }: { title?: string; label?: string; side?: "bottom" | "top" | "right"; width?: number; footer?: ReactNode; onClose?: () => void; children?: ReactNode }) {
  const { t } = useUiStrings();
  const titleId = useId();
  return (
    <div className={cx("rm-popover", `rm-popover-${side}`)} role="dialog" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label}
      onKeyDown={(e) => { if (e.key === "Escape" && onClose) { e.stopPropagation(); onClose(); } }} style={width ? { width } : undefined}>
      <span className="rm-popover-arrow" aria-hidden="true" />
      {title && (
        <div className="rm-popover-head">
          <h3 id={titleId} className="rm-popover-title">{title}</h3>
          {onClose && <IconButton icon="close" label={t("close")} size="compact" onClick={onClose} />}
        </div>
      )}
      <div className="rm-popover-body">{children}</div>
      {footer && <div className="rm-popover-foot">{footer}</div>}
    </div>
  );
}

// ---------- Tabs ----------

/** `force` pins a visual state on the selected tab — catalogue only, like Button's `force`. */
export function Tabs({ tabs, value, defaultValue, onChange, label, force }: { tabs: { id: string; label: string; count?: number }[]; value?: string; defaultValue?: string; onChange?: (id: string) => void; label?: string; force?: Forced }) {
  const { locale } = useUiStrings();
  const [own, setOwn] = useState(defaultValue ?? tabs[0]?.id);
  const current = value ?? own;
  const set = (id: string) => { setOwn(id); onChange?.(id); };
  const onKey = (e: KeyboardEvent) => {
    const ids = tabs.map((x) => x.id), i = ids.indexOf(current ?? "");
    if (e.key === "ArrowRight") set(ids[(i + 1) % ids.length]!);
    if (e.key === "ArrowLeft") set(ids[(i - 1 + ids.length) % ids.length]!);
  };
  return (
    <div className="rm-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((x) => {
        const on = x.id === current;
        return (
          <button key={x.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} className={cx("rm-tab", on && "is-selected", on && forced(force))} onClick={() => set(x.id)}>
            {x.label}
            {x.count != null && <span className="rm-tab-count">{new Intl.NumberFormat(locale).format(x.count)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Toast / Banner / EmptyState ----------

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE_ICON: Record<Tone, IconName> = { neutral: "info", info: "info", success: "check", warning: "alert", danger: "alert" };
interface Action { label: string; onClick?: () => void }

/** Lives 5 s (danger: until closed). What happened + what to do; undo as the action. */
export function Toast({ tone = "neutral", title, icon, action, onClose, children }: { tone?: Tone; title?: string; icon?: IconName; action?: Action; onClose?: () => void; children?: ReactNode }) {
  const { t } = useUiStrings();
  return (
    <div className={cx("rm-toast", `rm-toast-${tone}`)} role={tone === "danger" ? "alert" : "status"} aria-live={tone === "danger" ? "assertive" : "polite"}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div className="rm-toast-text">{title && <strong>{title}</strong>}{children}</div>
      {action && <button type="button" className="rm-toast-action" onClick={action.onClick}>{action.label}</button>}
      {onClose && <button type="button" className="rm-toast-x" aria-label={t("closeToast")} onClick={onClose}><Icon name="close" /></button>}
    </div>
  );
}

export function Banner({ tone = "info", title, icon, action, onClose, children }: { tone?: Exclude<Tone, "neutral">; title?: string; icon?: IconName; action?: Action; onClose?: () => void; children?: ReactNode }) {
  const { t } = useUiStrings();
  return (
    <div className={cx("rm-banner", `rm-banner-${tone}`)} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div className="rm-banner-text">{title && <strong>{title}</strong>}{children && <span>{children}</span>}</div>
      {action && <Button variant="secondary" size="compact" onClick={action.onClick}>{action.label}</Button>}
      {onClose && <IconButton icon="close" label={t("hide")} size="compact" onClick={onClose} />}
    </div>
  );
}

/** What this is, why, one action, an example. */
export function EmptyState({ icon, title, action, example, children }: { icon?: IconName; title: string; action?: Action & { icon?: IconName }; example?: string; children?: ReactNode }) {
  return (
    <div className="rm-empty">
      {icon && <span className="rm-empty-icon"><Icon name={icon} size={20} /></span>}
      <h3 className="rm-empty-title">{title}</h3>
      {children && <p className="rm-empty-body">{children}</p>}
      {action && <Button variant="primary" size="default" icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
      {example && <p className="rm-empty-example">{example}</p>}
    </div>
  );
}

// ---------- Lightbox ----------

/**
 * A full-window viewer of one picture (`spec/images.md` §9.7).
 *
 * A modal layer of its own rather than a `Dialog`: a dialog is a form with a title bar
 * and a footer, while a lightbox is a surface for the picture. The shell owns the three
 * things every viewer needs and the caller cannot be trusted to repeat — the scrim, the
 * focus trap, and giving focus back to the object that opened it. What is inside (zoom,
 * pan, caption) belongs to the screen that knows the picture. The close button and
 * Escape act the same, and the header row carries the name, the size and any actions.
 */
export function Lightbox({
  title,
  subtitle,
  actions,
  caption,
  onClose,
  children,
}: {
  title: string;
  /** One quiet line beside the name: dimensions, file type. */
  subtitle?: string;
  /** Buttons at the end of the header, before Close: download, open, anything. */
  actions?: ReactNode;
  /** Shown under the picture; the picture's description, when it has one. */
  caption?: string;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const { t } = useUiStrings();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Focus goes back to the object that opened the viewer, exactly like a dialog: the
  // canvas is not a form, so a lost focus means a lost selection for a keyboard reader.
  const [atRender] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const tookFocus = Boolean(ref.current?.contains(active));
    const opener = tookFocus ? atRender : active;
    if (!tookFocus) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus?.();
  }, [atRender]);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && onClose) {
      event.stopPropagation();
      onClose();
    }
    if (event.key === "Tab" && ref.current) {
      const list = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  return (
    <div
      className="rm-lightbox-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        className="rm-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKey}
      >
        <div className="rm-lightbox-head">
          <div className="rm-lightbox-heading">
            <h2 id={titleId} className="rm-lightbox-title">{title}</h2>
            {subtitle && <span className="rm-lightbox-subtitle">{subtitle}</span>}
          </div>
          <div className="rm-lightbox-actions">
            {actions}
            {onClose && <IconButton icon="close" label={t("close")} size="compact" onClick={onClose} />}
          </div>
        </div>
        <div className="rm-lightbox-body">{children}</div>
        {caption && <p className="rm-lightbox-caption">{caption}</p>}
      </div>
    </div>
  );
}
