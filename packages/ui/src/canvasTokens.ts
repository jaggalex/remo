/**
 * Canvas 2D cannot read `var(--…)`. Painters in `packages/canvas` take their colours
 * from here, resolved against the element the board is mounted in, so the canvas and
 * the DOM overlays always agree — including after a theme switch (call again).
 */
export const CANVAS_TOKENS = [
  "bg-canvas", "bg-app", "bg-panel", "bg-raised", "bg-hover",
  "border-subtle", "border-strong", "text-primary", "text-secondary", "text-muted", "text-danger",
  "accent", "accent-soft", "danger", "state-success", "state-warning",
  "selection-fill", "selection-stroke", "canvas-mark-bg", "canvas-mark-line",
  "presence-1", "presence-2", "presence-3", "presence-4", "presence-5", "presence-6", "text-on-presence",
  "sticker-neutral", "sticker-yellow", "sticker-green", "sticker-blue", "sticker-pink", "sticker-violet", "sticker-orange",
  "sticker-ink", "sticker-cast", "agent-proposal", "sticker-sheen", "sticker-shade", "sticker-chip",
  "shadow-sticker", "shadow-sticker-hover",
  "handle", "handle-hit", "grid-step", "pin",
] as const;

export type CanvasToken = (typeof CANVAS_TOKENS)[number];
export type CanvasTokens = Record<CanvasToken, string>;

export function readCanvasTokens(el: Element = document.documentElement): CanvasTokens {
  const style = getComputedStyle(el);
  const out = {} as CanvasTokens;
  for (const name of CANVAS_TOKENS) out[name] = style.getPropertyValue(`--${name}`).trim();
  return out;
}
