import { describe, expect, it } from "vitest";
import { placeWindow, type WindowBounds, type WindowRect } from "./windowClamp";

/**
 * Every window of a bar lands in the same strip (ADR-129).
 *
 * The strip starts past the rail and stops before the inspector; a window that does not
 * fit is shifted, never cut, and one taller than the strip scrolls. These are the numbers
 * the hook applies, without a browser.
 */
const bounds: WindowBounds = { left: 60, top: 60, right: 1000, bottom: 700 };
const rect = (left: number, top: number, width = 300, height = 400): WindowRect => ({
  left,
  top,
  width,
  height,
});

describe("the panel window clamp", () => {
  it("leaves a window that already fits alone", () => {
    expect(placeWindow(rect(400, 200), bounds)).toEqual({ dx: 0, dy: 0, maxHeight: null });
  });

  it("pushes a window off the rail", () => {
    // The bar sits at the very edge of the canvas; the window would start under the rail.
    expect(placeWindow(rect(10, 200), bounds).dx).toBe(50);
  });

  it("pulls a window back from the inspector", () => {
    // The strip ends at 1000, so a 300 px window may start at most at 700.
    expect(placeWindow(rect(900, 200), bounds).dx).toBe(-200);
  });

  it("moves a window up when the bar is near the bottom", () => {
    // height 400, bottom 700: the top may be at most 300.
    expect(placeWindow(rect(400, 500), bounds).dy).toBe(-200);
  });

  it("never shifts a window past the top edge", () => {
    // 600 px tall in a 640 px strip: it is pinned to the top and scrolls.
    const tall = placeWindow(rect(400, 100, 300, 1000), bounds);
    expect(tall.dy).toBe(-40);
    expect(tall.maxHeight).toBe(640);
  });

  it("keeps a window narrower than the strip at its width", () => {
    const narrow: WindowBounds = { left: 900, top: 60, right: 1000, bottom: 700 };
    // The 300 px window cannot fit; it starts at the left edge of the strip, uncut.
    expect(placeWindow(rect(950, 200), narrow).dx).toBe(-50);
  });
});
