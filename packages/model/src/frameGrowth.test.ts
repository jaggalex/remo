import { describe, expect, it } from "vitest";
import { FRAME_GROW_MARGIN, frameBoxHolding } from "./frameGrowth";

const frame = { x: 0, y: 0, width: 400, height: 300 }; // left −200, top −150

describe("a frame grows to hold a member (ADR-243)", () => {
  it("stays the same when the member fits", () => {
    expect(frameBoxHolding(frame, { x: 0, y: 0, width: 100, height: 100 })).toBe(frame);
  });

  it("moves only the side the member crosses, to its edge plus the margin", () => {
    // A member growing down past the bottom (150): the top stays at −150.
    const grown = frameBoxHolding(frame, { x: 0, y: 100, width: 100, height: 200 });
    expect(grown.y - grown.height / 2).toBe(-150);
    expect(grown.y + grown.height / 2).toBe(200 + FRAME_GROW_MARGIN);
    expect(grown.width).toBe(400);
    expect(grown.x).toBe(0);
  });

  it("can grow on two sides at once and never gets smaller", () => {
    const grown = frameBoxHolding(frame, { x: -250, y: -200, width: 200, height: 200 });
    expect(grown.x - grown.width / 2).toBe(-350 - FRAME_GROW_MARGIN);
    expect(grown.y - grown.height / 2).toBe(-300 - FRAME_GROW_MARGIN);
    expect(grown.x + grown.width / 2).toBe(200);
    expect(grown.y + grown.height / 2).toBe(150);
  });
});
