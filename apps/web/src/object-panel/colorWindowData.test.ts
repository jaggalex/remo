import { describe, expect, it } from "vitest";
import {
  BOARD_COLORS,
  COLOR_LEVELS,
  NAMED_COLORS,
  TONES,
  TONE_LEVELS,
} from "@remo/model";
import {
  colorName,
  fillLevel,
  inkExtraIds,
  inkOption,
  mainLevel,
  namedColorWord,
  markedColor,
  normalizeColor,
  sharedFillLevel,
  TEXT_INKS,
  toneColor,
} from "./colorWindowData";
import { enCore } from "../i18n/en-core";
import { ruCore } from "../i18n/ru-core";

/**
 * The colour window's words and rows (ADR-127).
 *
 * The window has no second palette and no unnamed swatch: every one of the twenty-one
 * values must translate in both languages, a value from the old palette must be named
 * "Custom colour" with its hex, and a digit must paint the row its role uses.
 */
const name = (table: Record<string, string>, key: string) => table[key];

describe("the tonal palette's words", () => {
  it("names all twenty-one values in both languages", () => {
    for (const color of COLOR_LEVELS) {
      const key = `color.${color.hex.slice(1)}`;
      expect(name(enCore as Record<string, string>, key), key).toBeTruthy();
      expect(name(ruCore as Record<string, string>, key), key).toBeTruthy();
    }
  });

  it("gives every value its own word, so a name never means two shades", () => {
    for (const table of [enCore, ruCore] as Array<Record<string, string>>) {
      const words = COLOR_LEVELS.map((color) => table[`color.${color.hex.slice(1)}`]);
      expect(new Set(words).size).toBe(COLOR_LEVELS.length);
    }
  });

  it("does not offer an old BOARD_COLORS value as a palette entry", () => {
    for (const legacy of BOARD_COLORS) {
      expect(colorName(legacy).key).toBe("color.own");
      expect(colorName(legacy).detail).toBe(legacy.toLowerCase());
    }
  });
});

describe("the named values' words (ADR-140)", () => {
  it("names White, Black and both words for transparency in both languages", () => {
    for (const id of ["white", "black"] as const) {
      const key = namedColorWord(id);
      expect(name(enCore as Record<string, string>, key), key).toBeTruthy();
      expect(name(ruCore as Record<string, string>, key), key).toBeTruthy();
    }
    // A fill is "Transparent"; a border or a line is "None", the role itself absent.
    for (const key of [
      namedColorWord("none", "fill"),
      namedColorWord("none", "stroke"),
    ]) {
      expect(name(enCore as Record<string, string>, key), key).toBeTruthy();
      expect(name(ruCore as Record<string, string>, key), key).toBeTruthy();
    }
    expect(namedColorWord("none", "fill")).toBe("color.transparent");
    expect(namedColorWord("none", "stroke")).toBe("object.none");
    expect(namedColorWord("white")).toBe("color.ffffff");
    expect(namedColorWord("black")).toBe("color.1a1a1a");
  });

  it("gives White and Black different words in the same language", () => {
    for (const table of [enCore, ruCore] as Array<Record<string, string>>) {
      const white = table[namedColorWord("white")];
      const black = table[namedColorWord("black")];
      expect(white).not.toBe(black);
    }
  });
});

describe("the current value's name", () => {
  it("names a palette value by its hex", () => {
    expect(colorName(TONE_LEVELS.yellow[100])).toEqual({ key: "color.ece2c8" });
    expect(colorName("#1A6AD8")).toEqual({ key: "color.1a6ad8" });
    expect(colorName(" #ECE2C8 ")).toEqual({ key: "color.ece2c8" });
  });

  it("names a fill painted before ADR-182 by the entry it stands for", () => {
    // The stored hex stays; the word and the ringed swatch are the new entry's.
    expect(colorName("#ffe07a")).toEqual({ key: "color.ece2c8" });
    expect(colorName("#ff8a57")).toEqual({ key: "color.bca996" });
    expect(markedColor("#FFE07A")).toBe(TONE_LEVELS.yellow[100]);
    expect(markedColor("#f8d3af")).toBe("#f8d3af");
    expect(markedColor("#ffffff")).toBe("#ffffff");
    expect(markedColor(null)).toBeNull();
    // A pre-ADR-182 300 fill keeps its row when only the hue changes.
    expect(fillLevel("#85d965")).toBe(300);
  });

  it("keeps an old hex as Custom colour with the hex beside it", () => {
    expect(colorName("#f8d3af")).toEqual({ key: "color.own", detail: "#f8d3af" });
    // A short hex is the same colour CSS paints; the detail shows the full value.
    expect(colorName("#abc")).toEqual({ key: "color.own", detail: "#aabbcc" });
  });

  it("names transparency and White only where the role offers them", () => {
    expect(colorName("transparent", { role: "fill" }).key).toBe("color.transparent");
    expect(colorName("transparent", { role: "stroke" }).key).toBe("object.none");
    expect(colorName("transparent", { role: "note" }).key).toBe("color.own");
    expect(colorName("#ffffff", { role: "note" }).key).toBe("color.ffffff");
    expect(colorName("#ffffff").key).toBe("color.own");
  });

  it("names Black only where the role offers it (ADR-140)", () => {
    expect(colorName("#1a1a1a", { role: "stroke" })).toEqual({
      key: "color.1a1a1a",
    });
    expect(colorName(NAMED_COLORS.black, { role: "text" })).toEqual({
      key: "color.1a1a1a",
    });
    // #1a1a1a is also one of the old twenty-two; without the named list it stays custom.
    expect(colorName("#1a1a1a").key).toBe("color.own");
  });

  it("says Auto only for a role that can have no explicit value", () => {
    expect(colorName(null, { auto: true }).key).toBe("sticky.auto");
    expect(colorName(null).key).toBe("color.own");
  });

  it("says Mixed colours instead of pretending one value is common", () => {
    expect(colorName("#ece2c8", { mixed: true }).key).toBe("color.mixed");
    expect(colorName(null, { mixed: true }).key).toBe("color.mixed");
  });

  it("normalises a value it cannot read to null", () => {
    expect(normalizeColor("nonsense")).toBeNull();
    expect(normalizeColor("#12345")).toBeNull();
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor(undefined)).toBeNull();
  });
});

describe("Auto / Dark / White", () => {
  it("reads an absent colour as Auto", () => {
    expect(inkOption(undefined)).toBe("auto");
    expect(inkOption(null)).toBe("auto");
  });

  it("recognises the three explicit inks and keeps an old one as custom", () => {
    expect(inkOption(TEXT_INKS.dark)).toBe("dark");
    expect(inkOption(TEXT_INKS.black)).toBe("black");
    expect(inkOption(TEXT_INKS.white.toUpperCase())).toBe("white");
    expect(inkOption("#305bab")).toBe("own");
  });

  it("does not repeat White as a chip beside the control that already names it", () => {
    expect(inkExtraIds()).toEqual(["black"]);
  });
});

describe("the row a key paints", () => {
  it("keeps a fill's 300 row and otherwise starts at 100", () => {
    expect(fillLevel(TONE_LEVELS.pink[300])).toBe(300);
    expect(fillLevel(TONE_LEVELS.pink[100])).toBe(100);
    // An old fill and a value the palette does not contain start at the pale row.
    expect(fillLevel("#f8d3af")).toBe(100);
    expect(fillLevel("#ffffff")).toBe(100);
    expect(fillLevel(null)).toBe(100);
  });

  it("always uses 600 for a line and text", () => {
    expect(mainLevel("line", TONE_LEVELS.pink[300])).toBe(600);
    expect(mainLevel("text", null)).toBe(600);
    expect(mainLevel("fill", TONE_LEVELS.pink[300])).toBe(300);
  });

  it("maps 1–7 to the seven columns and nothing outside them", () => {
    expect(TONES).toHaveLength(7);
    expect(toneColor(0, 100)).toBe(TONE_LEVELS.grey[100]);
    expect(toneColor(6, 600)).toBe(TONE_LEVELS.green[600]);
    expect(toneColor(7, 100)).toBeNull();
    expect(toneColor(-1, 100)).toBeNull();
  });

  it("keeps one row for a selection that agrees and writes 100 when it does not", () => {
    // The same row twice is the row the selection keeps.
    expect(sharedFillLevel([TONE_LEVELS.pink[300], TONE_LEVELS.blue[300]])).toBe(300);
    expect(sharedFillLevel([TONE_LEVELS.pink[100], TONE_LEVELS.blue[100]])).toBe(100);
    // 100 and 300 side by side: neither wins, so the pale row wins (ADR-129).
    expect(sharedFillLevel([TONE_LEVELS.pink[100], TONE_LEVELS.blue[300]])).toBe(100);
    // A value outside the palette counts as the 100 row, like any other fill.
    expect(sharedFillLevel(["#f8d3af", TONE_LEVELS.pink[300]])).toBe(100);
    expect(sharedFillLevel([TONE_LEVELS.pink[300], null])).toBe(100);
    expect(sharedFillLevel([TONE_LEVELS.pink[300]])).toBe(300);
  });
});
