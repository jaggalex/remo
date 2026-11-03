import { BOARD_COLORS } from "./palette";

/**
 * The tonal colour palette of the colour window (ADR-127, ADR-119 № 34).
 *
 * Seven hues in fixed columns × three levels: 100 and 300 paint fills, 600 paints lines,
 * borders and text. The document stores a hex, so the model carries values rather than
 * token names: a shared document cannot read a stylesheet, and a token renamed later in
 * `@remo/ui` must not change the colour of an object that already exists.
 *
 * The values are the design system's primitives; `colorLevels.test.ts` compares all
 * twenty-one with `packages/ui/src/tokens/tokens.json`, so the copy cannot drift
 * silently. Tone ids and levels are data, never words — the labels in the window are
 * i18n keys beside them.
 */
export const TONES = ["grey", "yellow", "orange", "pink", "violet", "blue", "green"] as const;

export type ColorTone = (typeof TONES)[number];

/** Fills take 100 and 300; 600 is the row for lines, borders and text (ADR-127). */
export const LEVELS = [100, 300, 600] as const;

export type ColorLevel = (typeof LEVELS)[number];

/**
 * The rows a fill role offers — the rail's quick choice and the window's fill grid.
 *
 * Housing the pair here keeps a fill from being defined twice: the rail and the window
 * both draw `colorsForLevels(FILL_LEVELS)`, so their values and order cannot disagree.
 */
export const FILL_LEVELS = [100, 300] as const;

export interface ToneColor {
  /** The column: a hue id, not a label. */
  tone: ColorTone;
  /** The row: 100 is the palest, 600 the deepest. */
  level: ColorLevel;
  /** The painted value a widget stores, lower-case `#rrggbb`. */
  hex: string;
}

/**
 * The twenty-one values, by column.
 *
 * `grey` is the `neutral-*` scale. Yellow is split in the design system — `yellow-100` is
 * the fill, `ochre-300`/`ochre-600` are its deeper steps — so a column is named by hue,
 * not by a token prefix.
 */
export const TONE_LEVELS = {
  grey: { 100: "#efece8", 300: "#bfb9b1", 600: "#58534e" },
  yellow: { 100: "#ffe07a", 300: "#f2b94a", 600: "#9a5800" },
  orange: { 100: "#ffcd9e", 300: "#ff8a57", 600: "#c93e0a" },
  pink: { 100: "#ffc6d9", 300: "#ff8fbd", 600: "#cc2470" },
  violet: { 100: "#d9c9ff", 300: "#c69bff", 600: "#8a35d6" },
  blue: { 100: "#b5dcff", 300: "#78b4ff", 600: "#1a6ad8" },
  green: { 100: "#b9ecac", 300: "#85d965", 600: "#2b7f17" },
} as const satisfies Record<ColorTone, Record<ColorLevel, string>>;

/**
 * The whole palette, row by row: every tone at 100, then every tone at 300, then 600.
 *
 * That is the order the window's grid fills (seven columns, three rows); a column is
 * `levelsFor(tone)`.
 */
export const COLOR_LEVELS: readonly ToneColor[] = LEVELS.flatMap((level) =>
  TONES.map((tone) => ({ tone, level, hex: TONE_LEVELS[tone][level] })),
);

/**
 * The rows a role draws, in the window's row-major order (100 row, then 300 row).
 *
 * One function for every swatch grid: the colour window passes its role's levels and the
 * rail passes `FILL_LEVELS`, so neither can introduce a second list or a different order.
 */
export function colorsForLevels(levels: readonly ColorLevel[]): ToneColor[] {
  return COLOR_LEVELS.filter((color) => levels.includes(color.level));
}

/** One column of the window: a tone's levels, palest first. */
export function levelsFor(tone: ColorTone): ToneColor[] {
  return LEVELS.map((level) => colorAt(tone, level));
}

/** The entry a swatch draws; every (tone, level) pair is in the table by construction. */
export function colorAt(tone: ColorTone, level: ColorLevel): ToneColor {
  return { tone, level, hex: TONE_LEVELS[tone][level] };
}

export interface ColorMatch {
  /** The nearest palette entry — the same entry when the hex is one of the twenty-one. */
  color: ToneColor;
  /** True when the hex is that entry exactly, so the window can ring the swatch. */
  exact: boolean;
  /** Squared RGB distance, 0 for an exact match; used to choose, not to display. */
  distance: number;
}

/**
 * The palette entry a stored hex belongs to, or null for something that is not a colour.
 *
 * Exact first: a note painted from the palette keeps its swatch highlighted. Anything
 * else gets the nearest entry, which is what lets an object from the old 22-colour
 * palette show its closeness without offering to repaint it (ADR-127: no migration).
 * The distance is plain RGB — good enough to sort twenty-one candidates, and it never
 * leaves the model.
 */
export function matchColor(hex: string): ColorMatch | null {
  const value = normalizeHex(hex);
  if (!value) return null;
  const rgb = channels(value);
  let best: ColorMatch | null = null;
  for (const color of COLOR_LEVELS) {
    const distance = rgbDistance(rgb, channels(color.hex));
    if (!best || distance < best.distance) best = { color, exact: distance === 0, distance };
  }
  return best;
}

/** Whether a stored hex is one of the palette's twenty-one, so a swatch can be chosen. */
export function isPaletteColor(hex: string): boolean {
  const value = normalizeHex(hex);
  return value != null && COLOR_LEVELS.some((color) => color.hex === value);
}

/**
 * Whether a stored hex comes from the old `BOARD_COLORS` palette (ADR-120).
 *
 * Those twenty-two colours are no longer offered; an object that already carries one
 * keeps it and the window says "current: custom colour" until the person picks another.
 * Checked before `isPaletteColor`, which the two sets never share.
 */
export function isLegacyColor(hex: string): boolean {
  const value = normalizeHex(hex);
  return value != null && BOARD_COLORS.some((legacy) => legacy.toLowerCase() === value);
}

/** `#abc` is a legitimate CSS colour and reaches us from hand-written settings. */
function normalizeHex(hex: string): string | null {
  const raw = hex.trim().replace("#", "").toLowerCase();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  return /^[0-9a-f]{6}$/.test(full) ? `#${full}` : null;
}

function channels(hex: string): readonly [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function rgbDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
