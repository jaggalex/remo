import { describe, expect, it } from "vitest";
import { connectorPath, type SnapTarget } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { MAX_CURVE, bendStep, curveStep, flipStep, moveStep } from "./gestureSteps";

/**
 * Gesture arithmetic.
 *
 * These were inline branches of the pointer handler in BoardCanvas: a bend is a
 * coordinate over a span, a curve handle is a projection onto a normal, a flip is
 * whichever corner is nearer, a drag is a snap. Both recent interaction bugs lived in
 * that code, and it could only be exercised by dragging in a browser (ADR-057).
 */

const note = (id: string, x: number, y: number): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width: 100,
  height: 100,
});

const targets: SnapTarget[] = [
  { x: 0, y: -50, width: 100, height: 100, centers: true },
];

describe("dragging", () => {
  const box = { x: -50, y: -50, width: 100, height: 100 };

  it("passes the raw travel through when snapping is off", () => {
    const step = moveStep({ box, raw: { dx: 120, dy: 30 }, targets, threshold: 0 });
    expect(step).toEqual({ delta: { dx: 120, dy: 30 }, guides: [] });
  });

  it("pulls the object onto a neighbour that is already aligned", () => {
    const step = moveStep({ box, raw: { dx: 2, dy: 0 }, targets, threshold: 6 });
    // The left edges are two units apart, inside the tolerance: the snap removes it.
    expect(step.delta.dx).toBe(0);
  });

  it("leaves a drag alone when the neighbour is far", () => {
    const step = moveStep({ box, raw: { dx: 200, dy: 0 }, targets, threshold: 6 });
    expect(step.delta.dx).toBe(200);
  });
});

describe("an elbow's middle run", () => {
  it("maps the pointer between the two stubs", () => {
    expect(bendStep({ x: 100, y: 0 }, "x", 0, 200)).toBe(0.5);
    expect(bendStep({ x: 0, y: 0 }, "x", 0, 200)).toBe(0);
    expect(bendStep({ x: 200, y: 0 }, "x", 0, 200)).toBe(1);
  });

  it("clamps past the ends instead of turning inside out", () => {
    expect(bendStep({ x: -500, y: 0 }, "x", 0, 200)).toBe(0);
    expect(bendStep({ x: 900, y: 0 }, "x", 0, 200)).toBe(1);
  });

  it("does not divide by a zero span", () => {
    const value = bendStep({ x: 10, y: 0 }, "x", 50, 50);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("reads the other axis for a horizontal run", () => {
    expect(bendStep({ x: 0, y: 50 }, "y", 0, 100)).toBe(0.5);
  });
});

describe("an L-shaped elbow", () => {
  const current = { x: 0, y: 300 };
  const alternate = { x: 350, y: 0 };

  it("flips when the pointer crosses to the other corner", () => {
    expect(flipStep({ x: -20, y: 290 }, current, alternate)).toBe(false);
    expect(flipStep({ x: 340, y: 10 }, current, alternate)).toBe(true);
  });

  it("keeps the current corner at the midpoint", () => {
    // On the diagonal both are equidistant; the current one wins (no flicker).
    const middle = { x: (current.x + alternate.x) / 2, y: (current.y + alternate.y) / 2 };
    expect(flipStep(middle, current, alternate)).toBe(false);
  });
});

describe("a curve's control point", () => {
  const map = new Map([
    ["a", note("a", 0, 0)],
    ["b", note("b", 400, 0)],
  ]);
  const path = connectorPath(
    {
      id: "c",
      type: "connector",
      parentId: null,
      x: 200,
      y: 0,
      width: 400,
      height: 0,
      start: { item: "a", side: "right" },
      end: { item: "b", side: "left" },
      connectorShape: "curved",
    },
    (id) => map.get(id),
  )!;

  it("projects the pointer onto the side's normal", () => {
    const start = path.points[0]!;
    // Right side: pulling 80 units to the right lengthens the control point by 80.
    const step = curveStep({
      handle: "curveFrom",
      point: { x: start.x + 80, y: start.y },
      path,
      current: { from: 60, to: 60 },
    });
    expect(step.from).toBeCloseTo(80, 5);
    expect(step.to).toBe(60);
  });

  it("ignores movement along the line", () => {
    const start = path.points[0]!;
    const step = curveStep({
      handle: "curveFrom",
      point: { x: start.x, y: start.y + 500 },
      path,
      current: { from: 60, to: 60 },
    });
    expect(step.from).toBeCloseTo(0, 5);
  });

  it("cannot be pulled backwards or past the maximum", () => {
    const start = path.points[0]!;
    const backwards = curveStep({
      handle: "curveFrom",
      point: { x: start.x - 300, y: start.y },
      path,
      current: { from: 60, to: 60 },
    });
    expect(backwards.from).toBe(0);

    const far = curveStep({
      handle: "curveFrom",
      point: { x: start.x + 9999, y: start.y },
      path,
      current: { from: 60, to: 60 },
    });
    expect(far.from).toBe(MAX_CURVE);
  });

  it("moves one end at a time", () => {
    const end = path.points[path.points.length - 1]!;
    const step = curveStep({
      handle: "curveTo",
      point: { x: end.x - 120, y: end.y },
      path,
      current: { from: 40, to: 60 },
    });
    expect(step.from).toBe(40);
    expect(step.to).toBeCloseTo(120, 5);
  });
});
