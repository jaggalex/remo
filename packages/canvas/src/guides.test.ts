import { describe, expect, it } from "vitest";
import { cellGuides, snapMove, snapResize, unionBox } from "./guides";
import { translateLayout } from "./layout";
import type { KanbanLayout } from "./layout";

const box = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe("alignment snapping", () => {
  it("pulls the box onto the nearest edge and reports where it landed", () => {
    // Four units to the right of a same-size neighbour: the left, centre and right
    // edges all agree on the same -4 correction, so all three get a line — which is
    // exactly what "these two are aligned" looks like.
    const result = snapMove(box(104, 500), [box(100, 0)], 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(0);
    expect(result.guides.map((guide) => guide.position)).toEqual([100, 150, 200]);
    expect(result.guides.every((guide) => guide.axis === "x")).toBe(true);
    // Every line spans both boxes.
    for (const guide of result.guides) expect([guide.from, guide.to]).toEqual([0, 600]);
  });

  it("distinguishes a centre alignment from an edge alignment", () => {
    const edge = snapMove(box(3, 200), [box(0, 0)], 6);
    expect(edge.dx).toBe(-3);
    expect(edge.guides.every((guide) => guide.kind === "edge" || guide.position === 50)).toBe(true);

    // A 100-wide box whose centre is 104 against a 200-wide target: aligning centres
    // takes -4.
    const wide = snapMove(box(54, 200), [box(0, 0, 200, 100)], 6);
    expect(wide.dx).toBe(-4);
    expect(wide.guides).toEqual([{ axis: "x", position: 100, from: 0, to: 300, kind: "center" }]);
  });

  it("snaps both axes independently, possibly to different neighbours", () => {
    const result = snapMove(box(104, 304), [box(100, 0), box(900, 300)], 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(-4);
    const axes = new Set(result.guides.map((guide) => guide.axis));
    expect(axes).toEqual(new Set(["x", "y"]));
    // The vertical guides come from the first neighbour, the horizontal from the
    // second: nothing is invented across the pair.
    expect(result.guides.filter((g) => g.axis === "x").every((g) => g.position <= 200)).toBe(true);
    expect(result.guides.filter((g) => g.axis === "y").every((g) => g.position >= 300)).toBe(true);
  });

  it("ignores anything further away than the tolerance", () => {
    expect(snapMove(box(140, 500), [box(100, 0)], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("picks the smallest correction of all candidates", () => {
    // Left edge 3 away from 100, centre 3 away from the 200-wide box's centre at 100.
    const result = snapMove(box(103, 500), [box(100, 0), box(0, 0, 200, 100)], 6);
    expect(result.dx).toBe(-3);
    expect(result.guides.length).toBeGreaterThan(0);
    // Every line is drawn where the box actually ended up.
    const anchors = [103 + result.dx, 153 + result.dx, 203 + result.dx];
    for (const guide of result.guides) {
      expect(anchors.some((value) => Math.abs(value - guide.position) < 0.01)).toBe(true);
    }
  });

  it("draws one line per position even when several neighbours share it", () => {
    const result = snapMove(box(5, 0), [box(0, 0), box(0, 200)], 6);
    expect(result.dx).toBe(-5);
    const xGuides = result.guides.filter((guide) => guide.axis === "x");
    expect(xGuides.map((guide) => guide.position)).toEqual([0, 50, 100]);
    // Each line covers both neighbours and the moving box.
    for (const guide of xGuides) expect([guide.from, guide.to]).toEqual([0, 300]);
  });

  it("does nothing without targets", () => {
    expect(snapMove(box(10, 10), [], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("marks the cell edges a dropped card will land on", () => {
    const layout: KanbanLayout = {
      left: 0,
      top: 0,
      width: 300,
      height: 300,
      headerHeight: 100,
      padding: 14,
      columns: [
        { id: "c1", title: "Todo", accent: "#000", count: 0, left: 0, centerX: 150, width: 300 },
      ],
      lanes: [{ id: "l1", title: "A", count: 0, top: 100, centerY: 200, height: 200 }],
      placements: [],
    };

    const guides = cellGuides(layout, { columnId: "c1", swimlaneId: "l1" });
    expect(guides).toEqual([
      { axis: "x", position: 14, from: 100, to: 300, kind: "edge" },
      { axis: "x", position: 286, from: 100, to: 300, kind: "edge" },
    ]);
    // An unknown cell has nothing to promise.
    expect(cellGuides(layout, { columnId: "nope", swimlaneId: "l1" })).toEqual([]);
  });

  it("translates a whole matrix when its kanban is carried", () => {
    const layout: KanbanLayout = {
      left: 10,
      top: 20,
      width: 100,
      height: 200,
      headerHeight: 40,
      padding: 5,
      columns: [{ id: "c", title: "T", accent: "#000", count: 1, left: 10, centerX: 60, width: 100 }],
      lanes: [{ id: "l", title: "L", count: 1, top: 60, centerY: 160, height: 160 }],
      placements: [
        { cardId: "k", columnId: "c", swimlaneId: "l", x: 60, y: 120, width: 90, height: 40 },
      ],
    };

    const moved = translateLayout(layout, 30, -5);
    expect(moved.left).toBe(40);
    expect(moved.top).toBe(15);
    expect(moved.columns[0]).toMatchObject({ left: 40, centerX: 90 });
    expect(moved.lanes[0]).toMatchObject({ top: 55, centerY: 155 });
    expect(moved.placements[0]).toMatchObject({ x: 90, y: 115 });
    // The original is untouched.
    expect(layout.left).toBe(10);
  });

  it("unions boxes for the drag footprint", () => {
    expect(unionBox([box(0, 0), box(200, 100, 50, 50)])).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 150,
    });
    expect(unionBox([])).toBeNull();
  });
});


/**
 * Resizing snaps only the edges the corner drags (ADR-212).
 *
 * The anchored side must not move, a guide appears only where the edge really landed,
 * and a snap that would go below the minimum is skipped rather than clamped.
 */
describe("resize snapping (ADR-212)", () => {
  it("pulls the dragged right edge onto a neighbour's left edge", () => {
    const result = snapResize(
      box(0, 0, 190, 100),
      { x: "right", y: "bottom" },
      [box(200, 0)],
      12,
    );

    expect(result.box).toMatchObject({ x: 0, y: 0, width: 200 });
    expect(result.guides).toEqual([
      { axis: "x", position: 200, from: 0, to: 100, kind: "edge" },
    ]);
  });

  it("moves the left edge and keeps the right one anchored", () => {
    const result = snapResize(box(110, 0, 90, 100), { x: "left" }, [box(0, 0)], 12);

    expect(result.box).toMatchObject({ x: 100, width: 100 });
    expect(result.box.x + result.box.width).toBe(200);
  });

  it("does nothing when the edge is outside the tolerance", () => {
    const result = snapResize(box(0, 0, 150, 100), { x: "right" }, [box(200, 0)], 6);

    expect(result.box).toMatchObject({ width: 150 });
    expect(result.guides).toEqual([]);
  });

  it("skips a snap that would break the minimum", () => {
    const result = snapResize(
      box(0, 0, 120, 100),
      { x: "right" },
      [box(40, 0)],
      12,
      { width: 80, height: 60 },
    );

    expect(result.box).toMatchObject({ width: 120 });
    expect(result.guides).toEqual([]);
  });

  it("snaps both edges independently", () => {
    const result = snapResize(
      box(0, 0, 190, 90),
      { x: "right", y: "bottom" },
      [box(200, 100), box(0, 100)],
      12,
    );

    expect(result.box).toMatchObject({ width: 200, height: 100 });
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(["x", "y"]);
  });
});
