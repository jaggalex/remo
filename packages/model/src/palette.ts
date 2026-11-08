import { TONE_LEVELS } from "./colorLevels";
import type { StickySize } from "./types";

/** Colour vocabulary taken from the live templates (see SPEC §3.3). */

export const STICKY_COLORS: Record<string, string> = {
  dark_blue: "#0047BB",
  light_blue: "#2D9BF0",
  yellow: "#FFDD33",
  green: "#8FD14F",
  red: "#F24726",
  purple: "#652CB3",
  orange: "#FF9F4C",
};

export const CARD_THEMES: Record<string, string> = {
  "#ff9f4c": "orange",
  "#8fd14f": "green",
  "#85b8ff": "blue",
  "#9510ac": "purple",
  "#ffdd33": "yellow",
  "#659df2": "blue",
  "#aba3ff": "lavender",
  "#e598b2": "pink",
  "#ff8080": "coral",
};

export const KANBAN_ACCENTS = {
  todo: "#1a1a1a",
  doing: "#FFDD33",
  done: "#8FD14F",
} as const;

/**
 * The one palette the interface offers for colour.
 *
 * It is the source product's connector palette read off its colour dialog: light /
 * base / dark triples, which is also why it works for both a note's fill and a line's
 * stroke — one list, one picker, one behaviour (ADR-030). Notes and lines store the
 * hex directly; the older named colours below still resolve so existing boards keep
 * their look.
 */
export const BOARD_COLORS = [
  "#fff6b6",
  "#ffdc4a",
  "#af7e04",
  "#f8d3af",
  "#fe9f4d",
  "#9b4a08",
  "#e7e7e7",
  "#ffc6c6",
  "#ff6464",
  "#bd0a0a",
  "#b0b0b0",
  "#adf0c7",
  "#2dc75c",
  "#067429",
  "#595959",
  "#c6dcff",
  "#659df2",
  "#305bab",
  "#1a1a1a",
  "#dedaff",
  "#8f7fee",
  "#6631d7",
] as const;

/**
 * Named colours the captured boards use.
 *
 * Kept as a translation table, not as a picker: the interface offers
 * `BOARD_COLORS`, and these names only exist so an imported sticky keeps the colour
 * it had.
 */
export const STICKY_PALETTE = [
  { name: "yellow", hex: "#FFDD33" },
  { name: "light_blue", hex: "#2D9BF0" },
  { name: "dark_blue", hex: "#0047BB" },
  { name: "green", hex: "#8FD14F" },
  { name: "orange", hex: "#FF9F4C" },
  { name: "red", hex: "#F24726" },
  { name: "purple", hex: "#652CB3" },
  { name: "light_green", hex: "#D0F0B0" },
  { name: "light_pink", hex: "#F5C6D6" },
  { name: "gray", hex: "#E6E6E6" },
] as const;

export type StickyColorName = (typeof STICKY_PALETTE)[number]["name"];

/**
 * The three sticky sizes, with the largest text size Auto will use for each.
 *
 * `M` is the size the captured templates use, so a note created today and one
 * imported from the source product look the same. The font cap scales with the note:
 * a small note with a huge heading is not a note anymore (ADR-027).
 */
export const STICKY_SIZES = {
  S: { width: 120, height: 120, fontCap: 13 },
  M: { width: 161.2, height: 184.7, fontCap: 16 },
  L: { width: 224, height: 224, fontCap: 20 },
} as const;

export function stickySizeOf(size: StickySize | undefined) {
  return STICKY_SIZES[size ?? "M"];
}

/** Largest size a note may use for its preset; explicit sizes are clamped to it. */
export function stickyFontCap(size: StickySize | undefined): number {
  return stickySizeOf(size).fontCap;
}

/** Darker or lighter version of a colour, for a note's edge. */
export function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = parseInt(full, 16);
  const mix = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel + (amount < 0 ? channel : 255 - channel) * amount)));
  const r = mix((num >> 16) & 0xff);
  const g = mix((num >> 8) & 0xff);
  const b = mix(num & 0xff);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What a note with no stored fill is painted: yellow 100, the value a new note gets
 * (ADR-186). Read at call time, not at load: `colorLevels.ts` imports this module too.
 */
export function defaultNoteFill(): string {
  return TONE_LEVELS.yellow[100];
}

/** The hex a widget's fill/solid colour resolves to, name or hex. */
export function resolveColor(name: string | undefined, fallback = defaultNoteFill()): string {
  if (!name) return fallback;
  return name.startsWith("#") ? name : (STICKY_COLORS[name] ?? fallback);
}

/**
 * A note's fill: the stored hex, an imported colour name as it was (ADR-127 keeps stored
 * values), or the default note fill when nothing is stored.
 */
export function stickyFill(name: string | undefined): string {
  if (!name) return defaultNoteFill();
  if (name.startsWith("#")) return name;
  return STICKY_COLORS[name] ?? defaultNoteFill();
}

/** Text needs enough contrast on saturated sticky colours. */
export function readableInk(fill: string): string {
  const value = parseHex(fill);
  if (!value) return "#1a1a1a";
  const luminance = (0.299 * value.r + 0.587 * value.g + 0.114 * value.b) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
}

/** Ink for a filled object: the person's choice, else the readable default. */
export function inkFor(fill: string | undefined, explicit?: string): string {
  return explicit ?? readableInk(fill ?? "#ffffff");
}

function parseHex(colour: string): { r: number; g: number; b: number } | null {
  const raw = colour.trim().replace("#", "");
  // #abc is a legitimate CSS colour and reaches us from hand-written settings.
  const hex =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const value = parseInt(hex, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
