import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COLOR_LEVELS,
  LEVELS,
  TONES,
  FILL_LEVELS,
  PREVIOUS_FILL_LEVELS,
  TONE_LEVELS,
  colorAt,
  colorsForLevels,
  isLegacyColor,
  isPaletteColor,
  levelsFor,
  matchColor,
  paletteValue,
  type ColorLevel,
  type ColorTone,
} from "./colorLevels";
import { BOARD_COLORS } from "./palette";

const TOKENS = fileURLToPath(new URL("../../ui/src/tokens/tokens.json", import.meta.url));

/** The design-system primitive each palette entry is copied from (ADR-127). */
const TOKEN_NAMES: Record<ColorTone, Record<ColorLevel, string>> = {
  grey: { 100: "paper-grey-100", 300: "paper-grey-300", 600: "neutral-600" },
  yellow: { 100: "paper-yellow-100", 300: "paper-yellow-300", 600: "ochre-600" },
  orange: { 100: "paper-orange-100", 300: "paper-orange-300", 600: "orange-600" },
  pink: { 100: "paper-pink-100", 300: "paper-pink-300", 600: "pink-600" },
  violet: { 100: "paper-violet-100", 300: "paper-violet-300", 600: "violet-600" },
  blue: { 100: "paper-blue-100", 300: "paper-blue-300", 600: "blue-600" },
  green: { 100: "paper-green-100", 300: "paper-green-300", 600: "green-600" },
};

/** Squared-free luminance is enough to order a column; no colour science intended. */
function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff);
}

/** WCAG 2 contrast ratio, enough to pin ADR-182's ink figure. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const value = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
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
    const yellow = { color: colorAt("yellow", 100), exact: true, previous: false, distance: 0 };
    expect(matchColor("#ece2c8")).toEqual(yellow);
    expect(matchColor(" #ECE2C8 ")).toEqual(yellow);
    expect(isPaletteColor("#8a35d6")).toBe(true);
  });

  it("reads a fill painted before ADR-182 as its entry, without offering it", () => {
    for (const tone of TONES) {
      for (const level of FILL_LEVELS) {
        const old = PREVIOUS_FILL_LEVELS[tone][level];
        expect(matchColor(old)).toEqual({ color: colorAt(tone, level), exact: true, previous: true, distance: 0 });
        expect(paletteValue(old)).toBe(TONE_LEVELS[tone][level]);
        // Never a swatch: choosing one writes the new value (ADR-127 forbids rewriting).
        expect(isPaletteColor(old)).toBe(false);
        expect(COLOR_LEVELS.some((color) => color.hex === old)).toBe(false);
        expect(isLegacyColor(old)).toBe(false);
      }
    }
    expect(paletteValue(TONE_LEVELS.blue[600])).toBe(TONE_LEVELS.blue[600]);
    expect(paletteValue("#f8d3af")).toBeNull();
    expect(paletteValue("nonsense")).toBeNull();
  });

  it("keeps ink readable on every fill (ADR-182: 6.98:1 at worst, orange 300)", () => {
    for (const color of colorsForLevels(FILL_LEVELS)) {
      expect(contrast(color.hex, "#1e2136"), color.hex).toBeGreaterThanOrEqual(6.97);
    }
  });

  it("finds the nearest value for a colour the palette does not contain", () => {
    // A fill from the old palette: no exact entry, closest is the pale orange.
    const old = matchColor("#f8d3af");
    expect(old?.exact).toBe(false);
    expect(old?.color).toEqual(colorAt("orange", 100));
    expect(old?.distance).toBeGreaterThan(0);

    // A dark grey has no exact entry: the model answers the nearest one rather than invent.
    expect(matchColor("#606060")?.color).toEqual(colorAt("grey", 600));
    expect(matchColor("#606060")?.exact).toBe(false);
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
