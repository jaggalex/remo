import { describe, expect, it } from "vitest";
import { planMapLayout } from "./agentPlanGeometry";

/**
 * The map is read by a person and by a screen reader; neither may receive a shape
 * outside the viewBox or an invented line (ADR-142, M3).
 */
describe("planMapLayout", () => {
  it("turns centre-anchored boxes into top-left rectangles and pads the viewBox", () => {
    const layout = planMapLayout({
      objects: [
        { tempId: "frame", type: "frame", x: 0, y: 0, width: 400, height: 300 },
        { tempId: "note", type: "sticky_note", x: 400, y: 300, width: 100, height: 100 },
      ] as never,
      connectors: [],
    });

    expect(layout.rects).toHaveLength(2);
    expect(layout.rects[0]).toMatchObject({ type: "frame", x: -200, y: -150 });
    expect(layout.bounds).toEqual({ x: -200, y: -150, width: 650, height: 500 });
    const [x, y, width, height] = layout.viewBox.split(" ").map(Number);
    expect(x!).toBeLessThan(-200);
    expect(y!).toBeLessThan(-150);
    expect(x! + width!).toBeGreaterThan(450);
    expect(y! + height!).toBeGreaterThan(350);
    expect(layout.empty).toBe(false);
  });

  it("draws a line only when both ends are planned objects", () => {
    const layout = planMapLayout({
      objects: [
        { tempId: "a", type: "sticky_note", x: 0, y: 0, width: 100, height: 100 },
        { tempId: "b", type: "sticky_note", x: 200, y: 0, width: 100, height: 100 },
      ] as never,
      connectors: [
        { from: "a", to: "b" },
        { from: "a", to: "board_only" },
      ] as never,
    });

    expect(layout.lines).toEqual([{ key: "connector_1", x1: 0, y1: 0, x2: 200, y2: 0 }]);
  });

  it("joins the centres of a diagonal pair and keeps the connector's tempId", () => {
    const layout = planMapLayout({
      objects: [
        { tempId: "a", type: "sticky_note", x: 0, y: 0, width: 100, height: 100 },
        { tempId: "b", type: "sticky_note", x: 200, y: 150, width: 100, height: 100 },
      ] as never,
      connectors: [{ tempId: "link", from: "a", to: "b" }] as never,
    });

    expect(layout.lines).toEqual([{ key: "link", x1: 0, y1: 0, x2: 200, y2: 150 }]);
    // The line is inside the measured box, not clipped by the padding.
    const [x, y, width, height] = layout.viewBox.split(" ").map(Number);
    expect(x!).toBeLessThanOrEqual(0);
    expect(y!).toBeLessThanOrEqual(0);
    expect(x! + width!).toBeGreaterThanOrEqual(200);
    expect(y! + height!).toBeGreaterThanOrEqual(150);
  });

  it("returns a placeholder instead of throwing on an empty or broken plan", () => {
    expect(planMapLayout(null).empty).toBe(true);
    expect(planMapLayout({ objects: [{ x: "nope" }] as never }).empty).toBe(true);
    const fallback = planMapLayout({ objects: [] }, { x: 10, y: 20, width: 300, height: 200 });
    expect(fallback.empty).toBe(true);
    expect(fallback.viewBox.split(" ").map(Number)).toEqual([-5, 5, 330, 230]);
  });
});
