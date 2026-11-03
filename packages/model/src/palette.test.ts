import { describe, expect, it } from "vitest";
import { BOARD_COLORS, inkFor, readableInk, resolveColor, shade, stickyFill } from "./palette";

describe("the shared colour palette", () => {
  it("is one list, long enough to be useful and free of duplicates", () => {
    expect(BOARD_COLORS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BOARD_COLORS.map((c) => c.toLowerCase())).size).toBe(BOARD_COLORS.length);
    for (const colour of BOARD_COLORS) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("resolves a named legacy colour and a hex the same way", () => {
    expect(resolveColor("#fe9f4d")).toBe("#fe9f4d");
    // The captured boards store names; they must keep their look.
    expect(resolveColor("yellow")).toBe(stickyFill("yellow"));
    expect(resolveColor(undefined)).toBe("#FFDD33");
  });

  it("darkens a fill for a note's edge without leaving the colour", () => {
    const edge = shade("#ffdc4a", -0.16);
    expect(edge).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(edge.slice(1, 3), 16)).toBeLessThan(0xff);
    // Dark colours get darker but never negative.
    expect(shade("#1a1a1a", -0.16)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("puts dark ink on a pale fill and white ink on a deep one", () => {
    expect(readableInk("#ffdd33")).toBe("#1a1a1a");
    expect(readableInk("#1a1a1a")).toBe("#ffffff");
    // Short hex reaches us from hand-written settings and means the same colour.
    expect(readableInk("#fff")).toBe("#1a1a1a");
    expect(readableInk("nonsense")).toBe("#1a1a1a");
  });

  it("keeps a text colour that was chosen", () => {
    expect(inkFor("#1a1a1a", "#ff0000")).toBe("#ff0000");
    expect(inkFor("#1a1a1a")).toBe("#ffffff");
    expect(inkFor(undefined)).toBe("#1a1a1a");
  });
});
