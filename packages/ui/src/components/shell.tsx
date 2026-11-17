import { useState, type ReactNode } from "react";
import type { IconName } from "../icons";
import { useUiStrings, type UiKey } from "../i18n";
import { Button, Icon, IconButton } from "./basics";
import { AvatarStack, Tooltip } from "./display";
import { cx } from "./util";

export type SyncState = "saved" | "pending" | "offline" | "connecting";

const SYNC: Record<SyncState, { icon: IconName; text: UiKey; short?: UiKey; tone: string }> = {
  saved: { icon: "saved", text: "saved", tone: "success" },
  pending: { icon: "timer", text: "saving", tone: "muted" },
  offline: { icon: "offline", text: "offline", short: "offlineShort", tone: "warning" },
  connecting: { icon: "timer", text: "saving", tone: "muted" },
};

/**
 * One place in the top bar, three states in words, no spinner (паттерн 4).
 *
 * `label` and `hint` let the product speak with its own words when the state carries a
 * number ("offline (3)") or a consequence ("input paused") that @remo/ui cannot know.
 *
 * `quiet` (ADR-232): a calm state — saved, saving — is its icon, and its word moves to the
 * tooltip while staying in the live region. A state that asks for attention — offline, or
 * `alert` for input stopped — keeps its word on screen, because an icon alone is missed.
 */
export function SyncStatus({ state, short, label, hint, className, quiet, alert }: { state: SyncState; short?: boolean; label?: string; hint?: string; className?: string; quiet?: boolean; alert?: boolean }) {
  const { t } = useUiStrings();
  const s = SYNC[state];
  const word = label ?? t(short && s.short ? s.short : s.text);
  const hideWord = quiet && !alert && s.tone !== "warning";
  const status = (
    <span className={cx("rm-sync", `rm-sync-${s.tone}`, className)} role="status" aria-live="polite" title={hideWord ? undefined : hint ?? t(s.text)}>
      <Icon name={s.icon} /><span className={cx(hideWord && "rm-visually-hidden")}>{word}</span>
    </span>
  );
  return hideWord ? <Tooltip label={hint ?? word}>{status}</Tooltip> : status;
}

export function ReadOnlyBadge({ children }: { children?: ReactNode }) {
  const { t } = useUiStrings();
  return <span className="rm-readonly" role="status" aria-live="polite"><Icon name="eye" />{children ?? t("readOnly")}</span>;
}

export interface TopBarProps { boardName: string; sync?: SyncState; readOnly?: boolean; presence?: string[]; onShare?: (() => void) | null; children?: ReactNode }

/** Board header, 52 px. Share is the only primary on the board screen. */
export function TopBar({ boardName, sync = "saved", readOnly, presence, onShare, children }: TopBarProps) {
  const { t } = useUiStrings();
  return (
    <header className="rm-topbar">
      <div className="rm-topbar-group">
        <span className="rm-topbar-mark" aria-hidden="true">R</span>
        <span className="rm-topbar-name" title={boardName}>{boardName}</span>
        {readOnly && <ReadOnlyBadge />}
        <SyncStatus state={sync} short />
      </div>
      <div className="rm-topbar-group">{children}</div>
      <div className="rm-topbar-group">
        {presence && <AvatarStack names={presence} />}
        {onShare !== null && <Button variant="primary" size="compact" icon="share" onClick={onShare}>{t("share")}</Button>}
      </div>
    </header>
  );
}

export type Tool = { id: string; icon: IconName; label: string; shortcut?: string[]; disabled?: boolean } | { separator: true };

export function Toolbar({ tools, value, defaultValue, onChange, label, openTooltip }: { tools: Tool[]; value?: string; defaultValue?: string; onChange?: (id: string) => void; label?: string; openTooltip?: string }) {
  const { t } = useUiStrings();
  const first = tools.find((x): x is Exclude<Tool, { separator: true }> => !("separator" in x));
  const [own, setOwn] = useState(defaultValue ?? first?.id);
  const current = value ?? own;
  return (
    <nav className="rm-toolbar" aria-label={label ?? t("tools")}>
      {tools.map((x, i) => {
        if ("separator" in x) return <span key={i} className="rm-toolbar-sep" role="separator" />;
        return (
          <Tooltip key={x.id} label={x.label} shortcut={x.shortcut} side="right" open={openTooltip === x.id}>
            <IconButton icon={x.icon} label={x.label} iconSize={20} selected={x.id === current} disabled={x.disabled} className="rm-tool"
              onClick={() => { setOwn(x.id); onChange?.(x.id); }} />
          </Tooltip>
        );
      })}
    </nav>
  );
}

export type FloatingAction = { icon: IconName; label: string; onClick?: () => void; selected?: boolean; danger?: boolean } | { swatch: string; label: string; onClick?: () => void };

/** Selection actions: at most 6 + “⋯” (паттерн 3); the rest belongs in the “⋯” menu. */
export function FloatingBar({ count: n, actions, onMore, label }: { count?: number; actions: FloatingAction[]; onMore?: () => void; label?: string }) {
  const { t, count } = useUiStrings();
  if (actions.length > 6) console.warn("[@remo/ui] FloatingBar: more than 6 actions — move the rest into “⋯” (паттерн 3).");
  return (
    <div className="rm-floatbar" role="toolbar" aria-label={label ?? t("selectionActions")}>
      {n ? <><span className="rm-floatbar-count">{count("object", n)}</span><span className="rm-floatbar-sep" /></> : null}
      {actions.slice(0, 6).map((a, i) =>
        "swatch" in a ? (
          <button key={i} type="button" className="rm-btn rm-btn-ghost rm-iconbtn rm-compact" aria-label={a.label} onClick={a.onClick}>
            <span className="rm-swatch" style={{ background: `var(--${a.swatch})` }} />
          </button>
        ) : (
          <IconButton key={i} icon={a.icon} label={a.label} size="compact" selected={a.selected} onClick={a.onClick} variant={a.danger ? "ghost-danger" : "ghost"} />
        ),
      )}
      <IconButton icon="more" label={t("moreActions")} size="compact" onClick={onMore} />
    </div>
  );
}

/**
 * The zoom panel: −, percentage, +, fit (DESIGN.md §3). Every button names itself in a
 * tooltip (ADR-232). The percentage is a reset button only when a reset is given; without
 * one it is a readout, not a control that does nothing.
 */
export function ZoomControls({ zoom = 100, onIn, onOut, onReset, onFit, fitHint }: { zoom?: number; onIn?: () => void; onOut?: () => void; onReset?: () => void; onFit?: () => void; fitHint?: string }) {
  const { t } = useUiStrings();
  return (
    <div className="rm-zoom" role="group" aria-label={t("zoom")}>
      <Tooltip label={t("zoomOut")} side="top">
        <IconButton icon="minus" label={t("zoomOut")} size="compact" onClick={onOut} />
      </Tooltip>
      {onReset ? (
        <button type="button" className="rm-zoom-value rm-num" aria-label={t("zoomValue", { zoom })} onClick={onReset}>{zoom} %</button>
      ) : (
        <span className="rm-zoom-value rm-num">{zoom} %</span>
      )}
      <Tooltip label={t("zoomIn")} side="top">
        <IconButton icon="plus" label={t("zoomIn")} size="compact" onClick={onIn} />
      </Tooltip>
      <span className="rm-floatbar-sep" />
      <Tooltip label={fitHint ?? t("zoomFit")} side="top">
        <IconButton icon="fit" label={t("zoomFit")} size="compact" onClick={onFit} />
      </Tooltip>
    </div>
  );
}
