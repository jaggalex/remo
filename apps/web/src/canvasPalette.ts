import { readCanvasTokens } from "@remo/ui";
import type { CanvasPalette } from "@remo/canvas";

/**
 * Bridge from design-system tokens to the Canvas 2D palette (ADR-078).
 *
 * Canvas cannot read CSS variables, so the tokens are resolved once here and the
 * result is passed to the painters. Read it from `document.documentElement`: the
 * theme is set there, and the product will switch themes without remounting the
 * board.
 */
export function canvasPaletteFromTokens(root: Element = document.documentElement): CanvasPalette {
  const t = readCanvasTokens(root);
  return {
    canvas: t["bg-canvas"],
    panel: t["bg-panel"],
    raised: t["bg-raised"],
    hover: t["bg-hover"],
    borderSubtle: t["border-subtle"],
    borderStrong: t["border-strong"],
    textPrimary: t["text-primary"],
    textSecondary: t["text-secondary"],
    textMuted: t["text-muted"],
    accent: t["accent"],
    accentSoft: t["accent-soft"],
    selectionStroke: t["selection-stroke"],
    selectionFill: t["selection-fill"],
    danger: t["danger"],
    warning: t["state-warning"],
    success: t["state-success"],
    textOnPresence: t["text-on-presence"],
  };
}
