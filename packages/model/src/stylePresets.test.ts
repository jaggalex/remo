import { describe, expect, it } from "vitest";
import {
  COLOR_LEVELS,
  isPaletteColor,
  LINE_PRESETS,
  SHAPE_PRESETS,
  DEFAULT_LINE_PRESET,
  DEFAULT_SHAPE_PRESET,
  DEFAULT_TEXT_COLOR,
  linePresetStyle,
  shapePresetStyle,
} from "./index";

/**
 * The presets and the palette are one list of values (ADR-129).
 *
 * A preset whose colour is not on the tonal grid opens the window on "Custom colour" the
 * moment it is pressed, which is the defect ADR-129 fixed. These tests hold the two tables
 * together and keep the defaults on a swatch.
 */
const palette = new Set(COLOR_LEVELS.map((color) => color.hex));

describe("built-in style presets (ADR-120, values ADR-129)", () => {
  it("has six shape bundles and five line bundles", () => {
    expect(SHAPE_PRESETS).toHaveLength(6);
    expect(LINE_PRESETS).toHaveLength(5);
  });

  it("keeps ids unique, so an i18n key names exactly one chip", () => {
    expect(new Set(SHAPE_PRESETS.map((preset) => preset.id)).size).toBe(SHAPE_PRESETS.length);
    expect(new Set(LINE_PRESETS.map((preset) => preset.id)).size).toBe(LINE_PRESETS.length);
  });

  it("writes the same WidgetStyle fields a manual edit writes", () => {
    expect(shapePresetStyle(SHAPE_PRESETS[0])).toEqual({
      fillColor: "#ffffff",
      strokeColor: "#58534e",
      strokeWidth: 2,
    });
    expect(linePresetStyle(LINE_PRESETS[1])).toEqual({
      strokeColor: "#cdc8c0",
      strokeWidth: 1,
      strokeStyle: "dashed",
    });
    expect(LINE_PRESETS.every((preset) => preset.arrow === "end")).toBe(true);
  });

  it("leaves text automatic: a shape preset never pins textColor", () => {
    for (const preset of SHAPE_PRESETS) {
      expect(shapePresetStyle(preset).textColor).toBeUndefined();
    }
  });

  it("paints only palette values, so a pressed preset rings its swatch", () => {
    // White is the one named exception: it is the chip beside "Fill", not a grid entry.
    for (const preset of SHAPE_PRESETS) {
      for (const value of [preset.fill, preset.stroke]) {
        if (value === "transparent" || value === "#ffffff") continue;
        expect(isPaletteColor(value), `${preset.id}: ${value}`).toBe(true);
      }
    }
    for (const preset of LINE_PRESETS) {
      expect(palette.has(preset.color), `${preset.id}: ${preset.color}`).toBe(true);
    }
  });

  it("starts a new shape, line and text on a swatch", () => {
    expect(DEFAULT_SHAPE_PRESET).toMatchObject({
      id: "plain",
      fill: "#ffffff",
      stroke: "#58534e",
      strokeWidth: 2,
    });
    expect(DEFAULT_LINE_PRESET).toMatchObject({
      id: "plain",
      color: "#58534e",
      width: 2,
      dash: "normal",
      arrow: "end",
    });
    expect(isPaletteColor(DEFAULT_TEXT_COLOR)).toBe(true);
  });
});
