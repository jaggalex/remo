/**
 * Canvas objects — the VISUAL CONTRACT for the Canvas 2D painters in `packages/canvas`
 * (ADR-078): colours, sizes and states come from the same tokens, read through
 * `readCanvasTokens()`. These DOM versions exist for the catalogue and for overlays
 * that do live in the DOM (ports, handles, name plates, lock badges, pins).
 * Objects on the board are painted, not rendered as DOM: 120 connectors at ≥ 50 FPS.
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { useUiStrings, type UiKey } from "../i18n";
import { Button, Icon, IconButton } from "./basics";
import { initials, who, type PresenceColor } from "./display";
import { cx } from "./util";

export type StickerColor = "neutral" | "yellow" | "green" | "blue" | "pink" | "violet" | "orange";
export type StickerState = "default" | "hover" | "selected" | "editing" | "locked" | "readonly" | "remote";

export function Handles() {
  return <>{["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((k) => <span key={k} className={`rm-handle rm-handle-${k}`} aria-hidden="true" />)}</>;
}

export function LockBadge({ by }: { by?: string }) {
  const { t } = useUiStrings();
  return <span className="rm-lock" role="status"><Icon name="lock" size={12} />{by ? t("lockedBy", { name: by }) : t("lockedPlain")}</span>;
}

export interface StickerProps {
  color?: StickerColor;
  text?: string;
  author?: string;
  state?: StickerState;
  lockedBy?: string;
  remoteName?: string;
  remoteColor?: PresenceColor;
  votes?: number;
  reactions?: { emoji: string; count: number }[];
  /** Side in board units; the note grows downwards, the type size stays 14. */
  size?: number;
}

export function Sticker({ color = "yellow", text = "", author, state = "default", lockedBy, remoteName, remoteColor, votes, reactions, size = 160 }: StickerProps) {
  const { t, count } = useUiStrings();
  const long = text.split("\n").length > 12 || text.length > 360;
  const label = [t("sticker"), author ? t("stickerBy", { name: author }) : null, state === "locked" ? t("locked") : null].filter(Boolean).join(", ");
  const style = { "--sticker-fill": `var(--sticker-${color})`, width: size, minHeight: size, ...(remoteColor ? who(remoteColor) : {}) } as CSSProperties;
  return (
    <div className={cx("rm-sticker", `is-${state}`)} tabIndex={0} role="group" aria-label={label} style={style}>
      <div className="rm-sticker-text">{text}{state === "editing" && <span className="rm-caret" aria-hidden="true" />}</div>
      <div className="rm-sticker-foot">
        {author ? <span className="rm-sticker-author">{author}</span> : <span />}
        <span className="rm-sticker-badges">
          {reactions?.map((r, i) => <span key={i} className="rm-react">{r.emoji} {r.count}</span>)}
          {votes ? <span className="rm-votes" aria-label={count("vote", votes)}><Icon name="vote" size={12} />{votes}</span> : null}
        </span>
      </div>
      {long && <span className="rm-sticker-long">{t("longText")}</span>}
      {state === "locked" && <LockBadge by={lockedBy} />}
      {state === "remote" && <span className="rm-remote-tag">{t("isTyping", { name: remoteName ?? t("someone") })}</span>}
      {state === "selected" && <Handles />}
    </div>
  );
}

export function Selection({ width = 200, height = 120, count: n, marquee }: { width?: number; height?: number; count?: number; marquee?: boolean }) {
  const { t, count } = useUiStrings();
  return (
    <div className={cx("rm-selection", marquee && "is-marquee")} style={{ width, height }} role="status" aria-live="polite">
      {!marquee && <Handles />}
      {n ? <span className="rm-selection-count">{t("selectedCount", { objects: count("object", n) })}</span> : null}
    </div>
  );
}

const PORT_KEYS: UiKey[] = ["port.tl", "port.t", "port.tr", "port.r", "port.br", "port.b", "port.bl", "port.l"];

/** Eight anchors (4 sides + 4 corners). An anchor is an address: Tab cycles them, Enter starts a connector. */
export function Ports({ width = 160, height = 96, label, hot, connected = [], visible = true }: { width?: number; height?: number; label?: string; hot?: number; connected?: number[]; visible?: boolean }) {
  const { t } = useUiStrings();
  const pts = [[0, 0], [width / 2, 0], [width, 0], [width, height / 2], [width, height], [width / 2, height], [0, height], [0, height / 2]] as const;
  return (
    <div className="rm-shape" style={{ width, height }} tabIndex={0} aria-label={label ?? t("shape")}>
      <span className="rm-shape-label">{label ?? t("shape")}</span>
      {pts.map(([x, y], i) => {
        const st = connected.includes(i) ? "connected" : hot === i ? "hot" : visible ? "visible" : "hidden";
        return <span key={i} className={`rm-port is-${st}`} style={{ left: x, top: y }} role="button" tabIndex={-1} aria-label={`${t("port")}: ${t(PORT_KEYS[i]!)}`} />;
      })}
    </div>
  );
}

/** Path routing (ADR-077). */
export type ConnectorRouting = "straight" | "elbow" | "curved";
/** End decoration. ТЗ §5.1's four types are combinations: line = straight + none, arrow = straight + arrow, elbow = elbow + arrow, block = straight + block. */
export type ConnectorHead = "none" | "arrow" | "block";
/** No “detached” state: a connector is deleted with its endpoint object (ADR-077). */
export type ConnectorState = "default" | "hover" | "selected" | "editing-label" | "pending";
/** A user-placed point survives moving either end; automatic points are recomputed (ADR-077). */
export interface Waypoint { x: number; y: number; rigid?: boolean }

type Pt = readonly [number, number];

function route(routing: ConnectorRouting, pts: Pt[]): string {
  const [first, ...rest] = pts;
  if (!first) return "";
  if (routing === "straight") return `M${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L${x} ${y}`).join(" ");
  if (routing === "elbow") {
    let d = `M${first[0]} ${first[1]}`, [px] = first;
    rest.forEach(([x, y]) => { const mx = (px + x) / 2; d += ` H${mx} V${y} H${x}`; px = x; });
    return d;
  }
  // curved: waypoints are supports the arc bends around, not points it passes through.
  if (rest.length === 1) return `M${first[0]} ${first[1]} L${rest[0]![0]} ${rest[0]![1]}`;
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const c = rest[i]!, n = rest[i + 1]!;
    const end = i === rest.length - 2 ? n : ([(c[0] + n[0]) / 2, (c[1] + n[1]) / 2] as const);
    d += ` Q${c[0]} ${c[1]} ${end[0]} ${end[1]}`;
  }
  return d;
}

export interface ConnectorProps {
  routing?: ConnectorRouting;
  head?: ConnectorHead;
  state?: ConnectorState;
  from?: [number, number];
  to?: [number, number];
  waypoints?: Waypoint[];
  label?: string;
  width?: number;
  height?: number;
}

/**
 * Selected: hollow points at the ends and at rigid waypoints, a filled dot in the middle of
 * every segment (drag it to add a waypoint). Point sizes stay constant in screen pixels.
 */
export function Connector({ routing = "straight", head = "arrow", state = "default", from = [16, 60], to = [220, 20], waypoints = [], label, width = 240, height = 80 }: ConnectorProps) {
  const { t } = useUiStrings();
  const mk = useId().replace(/:/g, "");
  const pts: Pt[] = [from, ...waypoints.map((w) => [w.x, w.y] as const), to];
  const k = Math.floor((pts.length - 1) / 2), ma = pts[k]!, mb = pts[k + 1] ?? ma;
  const mid = [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2] as const;
  const arrow = head === "block" ? <path d="M0 0 L10 5 L0 10 z" className="rm-connector-head" /> : <path d="M1 1 L9 5 L1 9" className="rm-connector-head is-open" />;
  const editing = state === "selected" || state === "editing-label";
  return (
    <svg className={cx("rm-connector", `is-${state}`)} width={width} height={height} role="img" aria-label={t("connector")}>
      <defs>
        <marker id={mk} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={8} markerHeight={8} orient="auto-start-reverse" markerUnits="userSpaceOnUse">{arrow}</marker>
      </defs>
      <path d={route(routing, pts)} className="rm-connector-line" markerEnd={head === "none" ? undefined : `url(#${mk})`} />
      {editing && pts.slice(0, -1).map((p, i) => {
        const n = pts[i + 1]!;
        return <circle key={`m${i}`} cx={(p[0] + n[0]) / 2} cy={(p[1] + n[1]) / 2} r={3} className="rm-connector-mid" />;
      })}
      {(editing || state === "hover") && <>
        <circle cx={from[0]} cy={from[1]} r={4} className="rm-connector-end" />
        <circle cx={to[0]} cy={to[1]} r={4} className="rm-connector-end" />
      </>}
      {editing && waypoints.filter((w) => w.rigid).map((w, i) => <circle key={`w${i}`} cx={w.x} cy={w.y} r={4} className="rm-connector-end" />)}
      {label && <g>
        <rect x={mid[0] - 36} y={mid[1] - 10} width={72} height={20} rx={4} className="rm-connector-labelbg" />
        <text x={mid[0]} y={mid[1] + 4} textAnchor="middle" className="rm-connector-label">{label}</text>
      </g>}
    </svg>
  );
}

export type FrameState = "default" | "selected" | "drop-target" | "hidden" | "clipped";

/** Deleting a frame keeps its content (ADR-070): the confirm dialog says so. */
export function Frame({ title, order, state = "default", width = 320, height = 180, children }: { title: string; order?: number; state?: FrameState; width?: number; height?: number; children?: ReactNode }) {
  const { t } = useUiStrings();
  return (
    <section className={cx("rm-frame", `is-${state}`)} style={{ width, height }} aria-label={`${t("frame")} ${title}`}>
      <div className="rm-frame-title">{order != null && <span className="rm-frame-order">{order}</span>}<span className="rm-ellipsis">{title}</span></div>
      <div className="rm-frame-body">{children}</div>
      {state === "selected" && <Handles />}
      {state === "clipped" && <span className="rm-frame-note">{t("clipped")}</span>}
    </section>
  );
}

export type CursorState = "moving" | "idle" | "typing" | "following";

export function Cursor({ name, color = 1, state = "moving" }: { name: string; color?: PresenceColor; state?: CursorState }) {
  const { t } = useUiStrings();
  const suffix = state === "typing" ? ` · ${t("typing")}` : state === "following" ? ` · ${t("followsYou")}` : "";
  return (
    <div className={cx("rm-cursor", `is-${state}`)} style={who(color)} aria-hidden="true">
      <svg width={18} height={18} viewBox="0 0 18 18"><path d="M2 1.5 L15 8 L9 9.5 L6.5 15.5 Z" className="rm-cursor-arrow" /></svg>
      <span className="rm-cursor-name">{name}{suffix}</span>
    </div>
  );
}

export function FollowIndicator({ name, color = 3, onStop }: { name: string; color?: PresenceColor; onStop?: () => void }) {
  const { t } = useUiStrings();
  return (
    <div className="rm-follow" style={who(color)} role="status" aria-live="polite">
      <span className="rm-follow-label"><Icon name="eye" size={14} />{t("following", { name })}<button type="button" className="rm-follow-stop" onClick={onStop}>{t("stop")}</button></span>
    </div>
  );
}

export function CommentPin({ author, color = 3, count: n, resolved, selected }: { author?: string; color?: PresenceColor; count?: number; resolved?: boolean; selected?: boolean }) {
  const { t, count } = useUiStrings();
  const label = [resolved ? t("commentResolved") : t("comment"), author ? t("commentFrom", { name: author }) : null, n && n > 1 ? count("reply", n) : null].filter(Boolean).join(", ");
  return (
    <button type="button" className={cx("rm-pin", resolved && "is-resolved", selected && "is-selected")} style={who(color)} aria-label={label}>
      {resolved ? <Icon name="check" size={12} /> : n && n > 1 ? n : initials(author ?? "?")}
    </button>
  );
}

export interface MinimapRect { x: number; y: number; w: number; h: number }

/** Content bounds and the viewport only — no thumbnails, so 1 000+ objects cost nothing. */
export function Minimap({ width = 200, height = 128, content = { x: 0.08, y: 0.12, w: 0.84, h: 0.72 }, viewport = { x: 0.2, y: 0.25, w: 0.35, h: 0.4 } }: { width?: number; height?: number; content?: MinimapRect; viewport?: MinimapRect }) {
  const { t } = useUiStrings();
  const box = (r: MinimapRect, cls: string) => <span className={cls} style={{ left: r.x * width, top: r.y * height, width: r.w * width, height: r.h * height }} />;
  return (
    <div className="rm-minimap" style={{ width, height }} role="img" aria-label={`${t("minimap")}: ${t("viewport")} ${Math.round(viewport.w * 100)} %`}>
      {box(content, "rm-minimap-content")}
      {box(viewport, "rm-minimap-viewport")}
    </div>
  );
}

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

export type TimerState = "running" | "paused" | "done";

export function TimerWidget({ seconds = 300, total = 300, state = "running", controls = true, onStart, onPause, onAdd }: { seconds?: number; total?: number; state?: TimerState; controls?: boolean; onStart?: () => void; onPause?: () => void; onAdd?: () => void }) {
  const { t } = useUiStrings();
  const pct = Math.max(0, Math.min(1, seconds / total));
  const extra = state === "paused" ? `, ${t("timerPaused")}` : state === "done" ? `, ${t("timerDone")}` : "";
  return (
    <div className={cx("rm-timer", `is-${state}`)} role="timer" aria-label={`${t("timer")} ${clock(seconds)}${extra}`}>
      <Icon name={state === "done" ? "alert" : "timer"} />
      <span className="rm-timer-value rm-num">{state === "done" ? t("timerDone") : clock(seconds)}</span>
      {state === "paused" && <span className="rm-timer-note">{t("timerPaused")}</span>}
      {controls && <>
        <span className="rm-floatbar-sep" />
        {state === "running"
          ? <IconButton icon="pause" label={t("timerPause")} size="compact" onClick={onPause} />
          : <IconButton icon="play" label={t("timerStart")} size="compact" onClick={onStart} />}
        <Button variant="ghost" size="compact" onClick={onAdd}>{t("timerAdd")}</Button>
      </>}
      <span className="rm-timer-bar" aria-hidden="true"><span style={{ width: `${pct * 100}%` }} /></span>
    </div>
  );
}

export function VoteCard({ title, meta, left = 3, total = 5, timer, timerTotal, state = "active", canEnd, onEnd, empty, children }: { title?: string; meta?: string; left?: number; total?: number; timer?: number; timerTotal?: number; state?: "active" | "ended"; canEnd?: boolean; onEnd?: () => void; empty?: boolean; children?: ReactNode }) {
  const { t } = useUiStrings();
  const ended = state === "ended";
  return (
    <section className={cx("rm-vote", ended && "is-ended")} aria-label={t("vote")}>
      <div className="rm-vote-head">
        <span className="rm-vote-icon"><Icon name="vote" /></span>
        <div className="rm-vote-main">
          <div className="rm-vote-title">{title ?? t("vote")}</div>
          <div className="rm-vote-meta">{ended ? t("voteEnded") : meta}</div>
        </div>
      </div>
      {timer != null && !ended && <div><TimerWidget seconds={timer} total={timerTotal} controls={false} /></div>}
      {ended ? (empty ? <div className="rm-vote-empty">{t("voteNone")}</div> : children) : <>
        <div className="rm-vote-left">
          <span>{t("votesLeft")}</span>
          <span className="rm-vote-dots" aria-label={`${left} / ${total}`}>
            {Array.from({ length: total }, (_, i) => <span key={i} className={cx("rm-vote-dot", i < left && "is-on")} />)}
          </span>
          <strong className="rm-num">{left} / {total}</strong>
        </div>
        {canEnd && <div className="rm-vote-foot"><Button variant="secondary" size="compact" onClick={onEnd}>{t("voteEnd")}</Button></div>}
      </>}
    </section>
  );
}
