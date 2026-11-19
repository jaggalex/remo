import { describe, expect, it } from "vitest";
import {
  BOARD_COLORS,
  COLOR_LEVELS,
  FILL_LEVELS,
  NAMED_COLORS,
  TONES,
  TONE_LEVELS,
  colorExtras,
  colorsForLevels,
} from "@remo/model";
import { enCore } from "../i18n/en-core";
import { ruCore } from "../i18n/ru-core";
import { colorName, namedColorWord } from "./colorWindowData";
import { defaultStickerFill, noteFillChoices, noteFillExtras } from "./palette";

/**
 * Every swatch has a word (ADR-120).
 *
 * The palette is data in the model and the names are i18n keys `color.<hex>`; a colour
 * added to the model without a name would render as a circle nobody can describe, which
 * is the thing this rule exists to prevent.
 */
describe("the palette names", () => {
  const name = (table: Record<string, string>, hex: string) => table[`color.${hex.slice(1)}`];

  it("names every colour in both languages", () => {
    for (const hex of BOARD_COLORS) {
      expect(name(enCore as Record<string, string>, hex), hex).toBeTruthy();
      expect(name(ruCore as Record<string, string>, hex), hex).toBeTruthy();
    }
  });

  it("gives each colour its own word, so a name never means two shades", () => {
    const names = BOARD_COLORS.map((hex) => name(enCore as Record<string, string>, hex));
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * The rail and the colour window are one set of fills (ADR-127/ADR-139).
 *
 * The rail is a shortcut into the window's fill grid, not a second palette: same values,
 * same order, same seven columns, same words, and the default sheet is the swatch that is
 * marked. A failure here means two lists have appeared where the product promises one.
 */
describe("one fill grid for the rail and the window", () => {
  it("offers the window's fourteen fills, in the same order", () => {
    const rail = noteFillChoices();
    const window = colorsForLevels(FILL_LEVELS);

    expect(window).toHaveLength(14);
    expect(rail.map((color) => color.hex)).toEqual(window.map((color) => color.hex));
    expect(rail.map((color) => `${color.tone}-${color.level}`)).toEqual(
      window.map((color) => `${color.tone}-${color.level}`),
    );
    // Seven columns × two rows, exactly as the window lays its fill section out.
    expect(rail.filter((color) => color.level === 100)).toHaveLength(7);
    expect(rail.filter((color) => color.level === 300)).toHaveLength(7);
    expect(rail.map((color) => color.tone)).toEqual([...TONES, ...TONES]);
    expect(rail.map((color) => color.level)).toEqual([
      ...Array.from({ length: 7 }, () => 100),
      ...Array.from({ length: 7 }, () => 300),
    ]);
    // The rail is the fill rows of the same model table, never a third one.
    expect(rail.map((color) => color.hex)).toEqual(
      COLOR_LEVELS.filter((color) => color.level !== 600).map((color) => color.hex),
    );
  });

  it("marks exactly the default sheet: yellow at 100", () => {
    const marked = noteFillChoices().filter((color) => color.hex === defaultStickerFill());

    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ tone: "yellow", level: 100 });
    expect(defaultStickerFill()).toBe(TONE_LEVELS.yellow[100]);
  });

  it("names every swatch with the window's key", () => {
    for (const color of noteFillChoices()) {
      expect(color.key).toBe(`color.${color.hex.slice(1)}`);
      expect(enCore[color.key as keyof typeof enCore], color.hex).toBeTruthy();
      expect(ruCore[color.key as keyof typeof ruCore], color.hex).toBeTruthy();
    }
  });

  it("keeps the old sheet colour out of the grid, as Custom colour", () => {
    // The legacy #FFDD33 is the value ADR-120 shipped and ADR-127 stopped offering.
    expect(noteFillChoices().some((color) => color.hex === "#ffdd33")).toBe(false);
    expect(colorName("#ffdd33")).toEqual({ key: "color.own", detail: "#ffdd33" });
  });
});

/**
 * The named chips are one list too (ADR-140).
 *
 * The rail's flyout and the note's colour window both draw White and Black from
 * `colorExtras("note")`: same values, same order, same words. A chip is not a swatch —
 * it never joins the fourteen fills and never takes a key 1–7.
 */
describe("one named list for the rail and the window", () => {
  it("draws the rail's chips in the model's order with the model's values", () => {
    const rail = noteFillExtras();
    const model = colorExtras("note");

    expect(rail.map((choice) => choice.id)).toEqual([...model]);
    expect(rail.map((choice) => choice.value)).toEqual(
      model.map((id) => NAMED_COLORS[id]),
    );
  });

  it("names the rail's chips with the window's keys", () => {
    for (const choice of noteFillExtras()) {
      expect(choice.key).toBe(namedColorWord(choice.id, "note"));
      expect(enCore[choice.key as keyof typeof enCore], choice.id).toBeTruthy();
      expect(ruCore[choice.key as keyof typeof ruCore], choice.id).toBeTruthy();
    }
  });

  it("keeps the named chips out of the 7 × 2 grid and its keys", () => {
    const grid = new Set(noteFillChoices().map((color) => color.hex));
    for (const choice of noteFillExtras()) {
      expect(grid.has(choice.value)).toBe(false);
    }
    // White and Black are not columns, so they cannot answer to 1–7.
    expect(noteFillChoices()).toHaveLength(14);
  });
});
