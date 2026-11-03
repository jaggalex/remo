import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COLOR_LEVELS,
  LEVELS,
  TONES,
  TONE_LEVELS,
  colorAt,
  isLegacyColor,
  isPaletteColor,
  levelsFor,
  matchColor,
  type ColorLevel,
  type ColorTone,
} from "./colorLevels";
import { BOARD_COLORS } from "./palette";

const TOKENS = fileURLToPath(new URL("../../ui/src/tokens/tokens.json", import.meta.url));

/** The design-system primitive each palette entry is copied from (ADR-127). */
const TOKEN_NAMES: Record<ColorTone, Record<ColorLevel, string>> = {
  grey: { 100: "neutral-100", 300: "neutral-300", 600: "neutral-600" },
  yellow: { 100: "yellow-100", 300: "ochre-300", 600: "ochre-600" },
  orange: { 100: "orange-100", 300: "orange-300", 600: "orange-600" },
  pink: { 100: "pink-100", 300: "pink-300", 600: "pink-600" },
  violet: { 100: "violet-100", 300: "violet-300", 600: "violet-600" },
  blue: { 100: "blue-100", 300: "blue-300", 600: "blue-600" },
  green: { 100: "green-100", 300: "green-300", 600: "green-600" },
};

/** Squared-free luminance is enough to order a column; no colour science intended. */
function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff);
}

describe("the tonal palette (ADR-127)", () => {
  it("is seven columns of three levels, twenty-one values in all", () => {
    expect(TONES).toEqual(["grey", "yellow", "orange", "pink", "violet", "blue", "green"]);
    expect(LEVELS).toEqual([100, 300, 600]);
    expect(COLOR_LEVELS).toHaveLength(21);
    for (const tone of TONES) {
      const column = levelsFor(tone);
      expect(column.map((color) => color.level)).toEqual([100, 300, 600]);
      expect(column.map((color) => color.tone)).toEqual([tone, tone, tone]);
    }
  });

  it("has one value per (tone, level), all well-formed and all different", () => {
    for (const tone of TONES) {
      for (const level of LEVELS) {
        expect(colorAt(tone, level)).toEqual({ tone, level, hex: TONE_LEVELS[tone][level] });
      }
    }
    const hexes = COLOR_LEVELS.map((color) => color.hex);
    expect(new Set(hexes).size).toBe(21);
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("orders every column light → deep, so the window is read top to bottom", () => {
    for (const tone of TONES) {
      const [lightest, middle, deepest] = levelsFor(tone).map((color) => luminance(color.hex));
      expect(lightest!).toBeGreaterThan(middle!);
      expect(middle!).toBeGreaterThan(deepest!);
    }
  });

  it("finds an exact value, ignoring case and stray whitespace", () => {
    expect(matchColor("#ffe07a")).toEqual({ color: colorAt("yellow", 100), exact: true, distance: 0 });
    expect(matchColor(" #FFE07A ")).toEqual({ color: colorAt("yellow", 100), exact: true, distance: 0 });
    expect(isPaletteColor("#8a35d6")).toBe(true);
  });

  it("finds the nearest value for a colour the palette does not contain", () => {
    // A fill from the old palette: no exact entry, closest is the pale orange.
    const old = matchColor("#f8d3af");
    expect(old?.exact).toBe(false);
    expect(old?.color).toEqual(colorAt("orange", 100));
    expect(old?.distance).toBeGreaterThan(0);

    // Mid grey has no exact entry: the model answers the nearest one rather than invent.
    expect(matchColor("#808080")?.color).toEqual(colorAt("grey", 600));
    expect(matchColor("#808080")?.exact).toBe(false);
  });

  it("treats a short hex as the same colour, as CSS does", () => {
    // `#abc` means the same as `#aabbcc`; a hand-written setting may use either.
    expect(matchColor("#fff")).toEqual(matchColor("#ffffff"));
    expect(matchColor("#FFF")).toEqual(matchColor("#ffffff"));
  });

  it("does not offer any of the old twenty-two colours as a palette value", () => {
    expect(BOARD_COLORS).toHaveLength(22);
    for (const legacy of BOARD_COLORS) {
      expect(isLegacyColor(legacy)).toBe(true);
      expect(isPaletteColor(legacy)).toBe(false);
      expect(matchColor(legacy)?.exact).toBe(false);
    }
    // The palette itself is never mistaken for the old list.
    for (const color of COLOR_LEVELS) expect(isLegacyColor(color.hex)).toBe(false);
  });

  it("says nothing about values that are not colours", () => {
    expect(matchColor("nonsense")).toBeNull();
    expect(matchColor("#12345")).toBeNull();
    expect(matchColor("")).toBeNull();
    // `transparent` is a real stored value for a border, but not a palette colour.
    expect(isPaletteColor("transparent")).toBe(false);
    expect(isLegacyColor("transparent")).toBe(false);
    expect(matchColor("#ffffff")).toMatchObject({ exact: false });
  });

  it("is the design system's primitives, not a second palette", () => {
    const tokens = JSON.parse(readFileSync(TOKENS, "utf8")) as {
      color: { tokens: Array<{ name: string; value: unknown; layer: string }> };
    };
    const primitives = new Map(
      tokens.color.tokens.filter((token) => token.layer === "primitive").map((token) => [token.name, token.value]),
    );
    for (const tone of TONES) {
      for (const level of LEVELS) {
        expect(primitives.get(TOKEN_NAMES[tone][level]), `${tone}-${level}`).toBe(TONE_LEVELS[tone][level]);
      }
    }
  });
});
