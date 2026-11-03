import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateLegacyDefaults, normalizeSettings } from "./settings";

describe("settings", () => {
  it("returns the defaults for an empty or broken object", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and falls back per field", () => {
    const settings = normalizeSettings({
      grid: { size: 64, style: "dots" },
      notes: { gapRatio: 0.8 },
      connectors: { shape: "curved", width: 4 },
    });
    expect(settings.grid).toEqual({ size: 64, style: "dots" });
    expect(settings.notes.gapRatio).toBe(0.8);
    expect(settings.notes.minGap).toBe(DEFAULT_SETTINGS.notes.minGap);
    expect(settings.connectors.shape).toBe("curved");
    expect(settings.connectors.width).toBe(4);
    expect(settings.connectors.colour).toBe(DEFAULT_SETTINGS.connectors.colour);
  });

  it("clamps a number that would break the board", () => {
    const settings = normalizeSettings({
      grid: { size: 100000 },
      snapping: { thresholdPx: -5 },
      notes: { gapRatio: 99, minGap: -100 },
      connectors: { width: 0 },
      shapes: { strokeWidth: 500 },
    });
    expect(settings.grid.size).toBe(400);
    expect(settings.snapping.thresholdPx).toBe(0);
    expect(settings.notes.gapRatio).toBe(3);
    expect(settings.notes.minGap).toBe(0);
    expect(settings.connectors.width).toBe(1);
    expect(settings.shapes.strokeWidth).toBe(12);
  });

  it("rejects an enum value it does not know and a colour that is not one", () => {
    const settings = normalizeSettings({
      connectors: { shape: "spiral", arrow: "maybe", colour: "red" },
      grid: { style: "checkerboard" },
      shapes: { fill: "#fff" },
    });
    expect(settings.connectors.shape).toBe(DEFAULT_SETTINGS.connectors.shape);
    expect(settings.connectors.arrow).toBe(DEFAULT_SETTINGS.connectors.arrow);
    expect(settings.connectors.colour).toBe(DEFAULT_SETTINGS.connectors.colour);
    expect(settings.grid.style).toBe(DEFAULT_SETTINGS.grid.style);
    // Short hex is a legitimate CSS colour.
    expect(settings.shapes.fill).toBe("#fff");
  });

  it("reads numbers written as strings, because a JSON paste may", () => {
    const settings = normalizeSettings({ grid: { size: "56" } });
    expect(settings.grid.size).toBe(56);
  });

  it("ignores unknown keys instead of carrying them around", () => {
    const settings = normalizeSettings({ grid: { size: 40, wobble: true }, extra: 1 });
    expect(Object.keys(settings.grid)).toEqual(["size", "style"]);
    expect("extra" in settings).toBe(false);
  });
});

/**
 * Defaults move to the tonal palette without touching a deliberate choice (ADR-129).
 *
 * A browser that never opened settings carries the values the product shipped; those must
 * become the Plain presets so the first sample rings a swatch. A stroke or line the person
 * tuned is theirs.
 */
describe("reading stored settings", () => {
  it("writes the new shape, line and text defaults", () => {
    expect(DEFAULT_SETTINGS.shapes).toEqual({
      fill: "#ffffff",
      stroke: "#58534e",
      strokeWidth: 2,
    });
    expect(DEFAULT_SETTINGS.connectors).toMatchObject({
      colour: "#58534e",
      width: 2,
      dash: "normal",
      arrow: "end",
    });
  });

  it("moves both untouched shape defaults to Plain", () => {
    for (const legacy of [
      { stroke: "#1a1a1a", strokeWidth: 1 },
      { stroke: "#595959", strokeWidth: 2 },
      { stroke: "#1A1A1A", strokeWidth: 1 },
    ]) {
      const settings = migrateLegacyDefaults(
        normalizeSettings({ shapes: legacy }),
      );
      expect(settings.shapes).toEqual(DEFAULT_SETTINGS.shapes);
    }
  });

  it("moves the untouched connector default to the line Plain preset", () => {
    const settings = migrateLegacyDefaults(
      normalizeSettings({ connectors: { colour: "#333333", width: 1 } }),
    );
    expect(settings.connectors.colour).toBe(DEFAULT_SETTINGS.connectors.colour);
    expect(settings.connectors.width).toBe(DEFAULT_SETTINGS.connectors.width);
    // Everything else about the stored line is kept.
    expect(settings.connectors.stubMax).toBe(DEFAULT_SETTINGS.connectors.stubMax);
  });

  it("leaves a deliberate shape border and line alone", () => {
    // One half of a default is a choice: a 3 px #595959 border is not "untouched".
    const thick = migrateLegacyDefaults(
      normalizeSettings({ shapes: { stroke: "#595959", strokeWidth: 3 } }),
    );
    expect(thick.shapes).toEqual({ fill: "#ffffff", stroke: "#595959", strokeWidth: 3 });

    const custom = migrateLegacyDefaults(
      normalizeSettings({ shapes: { stroke: "#1a1a1a", strokeWidth: 4 } }),
    );
    expect(custom.shapes.stroke).toBe("#1a1a1a");

    const line = migrateLegacyDefaults(
      normalizeSettings({ connectors: { colour: "#333333", width: 3 } }),
    );
    expect(line.connectors.colour).toBe("#333333");
  });
});
