import { describe, expect, it } from "vitest";
import { COLOR_LEVELS } from "./colorLevels";
import { BOARD_COLORS } from "./palette";
import {
  COLOR_EXTRAS,
  NAMED_COLORS,
  colorExtras,
  namedColorValue,
  type NamedColorId,
  type NamedColorRole,
} from "./namedColors";

/**
 * White, black and transparency beside the tonal grid (ADR-140).
 *
 * The named values are not a second palette: each role names the few it can paint, in the
 * order the window draws them, and every surface reads that one list. A value that leaked
 * into the 7 × 2 grid would take a key 1–7 and teach a column that does not exist.
 */
describe("the named values (ADR-140)", () => {
  it("is exactly the three values the document stores", () => {
    expect(NAMED_COLORS).toEqual({
      white: "#ffffff",
      black: "#1a1a1a",
      none: "transparent",
    });
    for (const id of Object.keys(NAMED_COLORS) as NamedColorId[]) {
      expect(namedColorValue(id)).toBe(NAMED_COLORS[id]);
    }
  });

  it("offers each role its own list, in the window's order", () => {
    expect(COLOR_EXTRAS.note).toEqual(["white", "black"]);
    expect(COLOR_EXTRAS.fill).toEqual(["white", "black", "none"]);
    expect(COLOR_EXTRAS.stroke).toEqual(["black", "none"]);
    expect(COLOR_EXTRAS.text).toEqual(["black", "white"]);
  });

  it("hands out the same list every time, so rail and window cannot drift", () => {
    for (const role of Object.keys(COLOR_EXTRAS) as NamedColorRole[]) {
      expect(colorExtras(role)).toBe(COLOR_EXTRAS[role]);
    }
  });

  it("never repeats a value inside a role", () => {
    for (const role of Object.keys(COLOR_EXTRAS) as NamedColorRole[]) {
      expect(new Set(colorExtras(role)).size).toBe(colorExtras(role).length);
    }
  });

  it("keeps every named value out of the 7 × 2 grid", () => {
    const grid = new Set(COLOR_LEVELS.map((color) => color.hex));
    expect(grid.has(NAMED_COLORS.white)).toBe(false);
    expect(grid.has(NAMED_COLORS.black)).toBe(false);
    expect(grid.has(NAMED_COLORS.none)).toBe(false);
    // Black is the old palette's value of the same name: still named, never a grid entry.
    expect(BOARD_COLORS.map((hex) => hex.toLowerCase())).toContain(NAMED_COLORS.black);
  });

  it("offers transparency only to a fill and a stroke, where 'none' is paintable", () => {
    const roles = Object.keys(COLOR_EXTRAS) as NamedColorRole[];
    expect(roles.filter((role) => colorExtras(role).includes("none"))).toEqual([
      "fill",
      "stroke",
    ]);
  });

  it("does not let a note be transparent: its sheet is the object", () => {
    expect(colorExtras("note")).not.toContain("none");
  });
});
