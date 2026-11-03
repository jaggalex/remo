/**
 * The colours Canvas 2D paints with.
 *
 * Canvas cannot read `var(--…)`, so the app resolves the design-system tokens once
 * (`readCanvasTokens()`) and passes the result down here. Keeping the palette a plain
 * object makes the painters pure and testable, and one palette covers the board and
 * the overlay — no second, drifting set of greys (ADR-078).
 *
 * The defaults are the pre-design-system values: they keep unit tests and any caller
 * that paints without the app (exports, thumbnails) working, but the app always passes
 * tokens.
 */
export interface CanvasPalette {
  /** Board background (`bg-canvas`). */
  canvas: string;
  /** Panels and surfaces (`bg-panel`). */
  panel: string;
  /** Raised surfaces (`bg-raised`). */
  raised: string;
  /** Hover fill (`bg-hover`). */
  hover: string;
  borderSubtle: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  selectionStroke: string;
  selectionFill: string;
  danger: string;
  warning: string;
  success: string;
  /** Ink on a presence-coloured name plate (`text-on-presence`). */
  textOnPresence: string;
}

export const DEFAULT_PALETTE: CanvasPalette = {
  canvas: "#f7f7f8",
  panel: "#ffffff",
  raised: "#ffffff",
  hover: "#f4f5f7",
  borderSubtle: "#e7e8ec",
  borderStrong: "#d7d9df",
  textPrimary: "#1a1a1a",
  textSecondary: "#4b5563",
  textMuted: "#8a8f98",
  accent: "#4262ff",
  accentSoft: "#eef1ff",
  selectionStroke: "#4262ff",
  selectionFill: "rgba(66,98,255,0.10)",
  danger: "#d92d20",
  warning: "#f59e0b",
  success: "#12b76a",
  textOnPresence: "#ffffff",
};

/** Apply an alpha channel to a hex colour, leaving other formats alone. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  const hex = match?.[1];
  if (!hex) return color;
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
