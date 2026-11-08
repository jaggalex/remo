import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import {
  anchorPoint,
  boxOf,
  connectorHandles,
  connectorPath,
  closestOnPath,
  distanceToPath,
  elbowPoints,
  facingSide,
  pathMidpoint,
  pathPolyline,
  resolvedEndSide,
  simplify,
  CONNECTOR_GAP,
  arrowHeadSize,
  insetPath,
  roundedArrowHead,
} from "./connectors";

const note = (id: string, x: number, y: number, width = 100, height = 100): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width,
  height,
});

const connector = (start: Widget["start"], end: Widget["end"], shape?: Widget["connectorShape"]): Widget => ({
  id: "c",
  type: "connector",
  parentId: null,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  start,
  end,
  connectorShape: shape,
});

const widgets = new Map([
  ["a", note("a", 0, 0)],
  ["b", note("b", 400, 0)],
]);
const resolve = (id: string) => widgets.get(id);

describe("connector anchors", () => {
  it("names the side that faces the other object", () => {
    expect(facingSide(boxOf(note("a", 0, 0)), { x: 400, y: 0 })).toBe("right");
    expect(facingSide(boxOf(note("a", 0, 0)), { x: -400, y: 0 })).toBe("left");
    expect(facingSide(boxOf(note("a", 0, 0)), { x: 0, y: 400 })).toBe("bottom");
    expect(facingSide(boxOf(note("a", 0, 0)), { x: 0, y: -400 })).toBe("top");
  });

  it("places an anchor on the side, at the requested offset", () => {
    const box = boxOf(note("a", 0, 0, 100, 80));
    expect(anchorPoint(box, "right")).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(box, "left", 1)).toEqual({ x: -50, y: 40 });
    expect(anchorPoint(box, "bottom", 0)).toEqual({ x: -50, y: 40 });
    expect(anchorPoint(box, "top", 0.5)).toEqual({ x: 0, y: -40 });
  });
});

describe("connector paths", () => {
  it("runs straight between the facing sides", () => {
    const path = connectorPath(connector({ item: "a" }, { item: "b" }), resolve)!;
    expect(path.points).toEqual([
      { x: 50, y: 0 },
      { x: 350, y: 0 },
    ]);
    expect(path.curve).toBeUndefined();
  });

  it("honours an explicit side over the facing one", () => {
    const path = connectorPath(
      connector({ item: "a", side: "top" }, { item: "b", side: "bottom" }, "straight"),
      resolve,
    )!;
    expect(path.points[0]).toEqual({ x: 0, y: -50 });
    expect(path.points[1]).toEqual({ x: 400, y: 50 });
  });

  it("leaves and enters perpendicular to both sides on an elbow", () => {
    // Offset vertically, so the elbow really turns instead of collapsing to a line.
    const offset = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 200)],
    ]);
    const path = connectorPath(
      connector({ item: "a" }, { item: "b" }, "elbowed"),
      (id) => offset.get(id),
    )!;
    // Right side out, left side in, with one vertical leg between them.
    expect(path.points[0]).toEqual({ x: 50, y: 0 });
    expect(path.points[1]).toEqual({ x: 200, y: 0 });
    expect(path.points[2]).toEqual({ x: 200, y: 200 });
    expect(path.points[path.points.length - 1]).toEqual({ x: 350, y: 200 });
  });

  it("collapses to a straight line when both sides already line up", () => {
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "elbowed"), resolve)!;
    expect(path.points).toEqual([
      { x: 50, y: 0 },
      { x: 350, y: 0 },
    ]);
  });

  it("routes between top and bottom vertically", () => {
    const below = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 0, 400)],
    ]);
    const path = connectorPath(
      connector({ item: "a" }, { item: "b" }, "elbowed"),
      (id) => below.get(id),
    )!;
    expect(path.points[0]).toEqual({ x: 0, y: 50 });
    expect(path.points[path.points.length - 1]).toEqual({ x: 0, y: 350 });
    // Leaves downwards, enters upwards.
    expect(path.points[1]!.x).toBe(path.points[0]!.x);
    expect(path.points[1]!.y).toBeGreaterThan(50);
  });

  it("turns once when the sides are on different axes", () => {
    const diagonal = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 400)],
    ]);
    const path = connectorPath(
      connector({ item: "a", side: "right" }, { item: "b", side: "top" }, "elbowed"),
      (id) => diagonal.get(id),
    )!;
    const last = path.points[path.points.length - 1]!;
    const beforeLast = path.points[path.points.length - 2]!;
    // The final leg is vertical, so the line arrives through the top side.
    expect(beforeLast.x).toBe(last.x);
    expect(beforeLast.y).toBeLessThan(last.y);
  });

  it("builds a curve whose ends leave along the side normals", () => {
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "curved"), resolve)!;
    expect(path.curve).toBeDefined();
    expect(path.curve!.from).toEqual({ x: 50, y: 0 });
    expect(path.curve!.to).toEqual({ x: 350, y: 0 });
    // Control points sit outside the notes, on the axis the line leaves along.
    expect(path.curve!.c1.x).toBeGreaterThan(50);
    expect(path.curve!.c1.y).toBe(0);
    expect(path.curve!.c2.x).toBeLessThan(350);
    expect(path.curve!.c2.y).toBe(0);
  });

  it("draws nothing when an endpoint is gone", () => {
    expect(connectorPath(connector({ item: "a" }, { item: "ghost" }), resolve)).toBeNull();
  });

  it("drops collinear and repeated points", () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });
});

describe("elbows in a narrow gap", () => {
  it("does not double back when two notes are close", () => {
    // 40 units between the boxes is less than two full stubs: without shrinking the
    // stub the route would cross itself and read as a double line.
    const close = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 140, 0)],
    ]);
    const path = connectorPath(
      connector({ item: "a" }, { item: "b" }, "elbowed"),
      (id) => close.get(id),
    )!;
    const xs = path.points.map((point) => point.x);
    // Right-to-left, so every step must move forward or stay put.
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
    expect(xs[0]).toBe(50);
    expect(xs[xs.length - 1]).toBe(90);
  });

  it("stays monotonic even when the settings ask for huge stubs", () => {
    const close = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 140, 0)],
    ]);
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "elbowed"), (id) => close.get(id), {
      max: 500,
      ratio: 3,
    })!;
    const xs = path.points.map((point) => point.x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
  });

  it("keeps a long gap's full stubs", () => {
    const far = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 800, 300)],
    ]);
    const path = connectorPath(
      connector({ item: "a" }, { item: "b" }, "elbowed"),
      (id) => far.get(id),
    )!;
    // Leaves the right side and turns a full stub later, not immediately.
    expect(path.points[1]!.x).toBeGreaterThan(50 + 10);
  });
});

describe("a label's place on the line", () => {
  it("sits halfway along a straight line", () => {
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "straight"), resolve)!;
    const mid = pathMidpoint(path);
    expect(mid.x).toBeCloseTo(200, 0);
    expect(mid.y).toBeCloseTo(0, 0);
  });

  it("splits the line in half by length, curve included", () => {
    const curved = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 300)],
    ]);
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "curved"), (id) =>
      curved.get(id),
    )!;
    const mid = pathMidpoint(path);
    const points = pathPolyline(path);

    const length = (from: { x: number; y: number }, to: { x: number; y: number }) =>
      Math.hypot(to.x - from.x, to.y - from.y);
    const steps: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      steps.push(length(points[i - 1]!, points[i]!));
    }
    const total = steps.reduce((sum, step) => sum + step, 0);

    // Walk to the sample nearest the midpoint and add up what comes before it.
    let nearest = 0;
    let closest = Infinity;
    points.forEach((point, index) => {
      const distance = Math.hypot(point.x - mid.x, point.y - mid.y);
      if (distance < closest) {
        closest = distance;
        nearest = index;
      }
    });
    const before = steps.slice(0, nearest).reduce((sum, step) => sum + step, 0);

    // On the path, and halfway along it — which is what makes the label look centred
    // on a curve rather than on the chord.
    expect(distanceToPath(mid, points)).toBeLessThan(0.5);
    expect(before / total).toBeGreaterThan(0.4);
    expect(before / total).toBeLessThan(0.6);
  });

  it("stays on an elbow's path", () => {
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "elbowed"), resolve)!;
    const mid = pathMidpoint(path);
    const distance = distanceToPath(mid, pathPolyline(path));
    expect(distance).toBeLessThan(0.001);
  });
});

describe("reshaping a line", () => {
  it("slides an elbow's middle run with `bend`", () => {
    const close = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 200)],
    ]);
    const widget = connector({ item: "a", side: "right" }, { item: "b", side: "left" }, "elbowed");
    const middle = (bend: number) => {
      const path = connectorPath({ ...widget, bend }, (id) => close.get(id))!;
      const xs = path.points.map((point) => point.x);
      // The middle run is the vertical segment between the stubs.
      return Math.max(...xs.slice(1, -1));
    };
    expect(middle(0.25)).toBeLessThan(middle(0.75));
    // And the ends never move: the line stays attached to both sides.
    const path = connectorPath({ ...widget, bend: 0.1 }, (id) => close.get(id))!;
    expect(path.points[0]).toEqual({ x: 50, y: 0 });
    expect(path.points[path.points.length - 1]).toEqual({ x: 350, y: 200 });
  });

  it("offers a corner flip when the two sides are on different axes", () => {
    const map = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 300)],
    ]);
    const widget = connector({ item: "a", side: "bottom" }, { item: "b", side: "left" }, "elbowed");
    const straight = connectorPath(widget, (id) => map.get(id))!;
    const flipped = connectorPath({ ...widget, elbowFlip: true }, (id) => map.get(id))!;
    expect(straight.points).not.toEqual(flipped.points);

    const handles = connectorHandles(straight, widget);
    expect(handles).toHaveLength(1);
    expect(handles[0]!.kind).toBe("flip");
    // The handle sits on the corner the route turns on today.
    expect(handles[0]!.point).toEqual(straight.points[1]);
  });

  it("pulls a curve's control length with `curve`", () => {
    const map = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 0)],
    ]);
    const widget = connector({ item: "a", side: "right" }, { item: "b", side: "left" }, "curved");
    const shallow = connectorPath({ ...widget, curve: { from: 20, to: 20 } }, (id) => map.get(id))!;
    const deep = connectorPath({ ...widget, curve: { from: 300, to: 300 } }, (id) => map.get(id))!;
    expect(deep.curve!.c1.x).toBeGreaterThan(shallow.curve!.c1.x);
  });

  it("gives a curved line two handles and a straight one none", () => {
    const map = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 300)],
    ]);
    const curved = connector({ item: "a" }, { item: "b" }, "curved");
    const straight = connector({ item: "a" }, { item: "b" }, "straight");
    expect(connectorHandles(connectorPath(curved, (id) => map.get(id))!, curved)).toHaveLength(2);
    expect(connectorHandles(connectorPath(straight, (id) => map.get(id))!, straight)).toHaveLength(0);
  });
});

describe("a label's place", () => {
  it("is recorded as a fraction of the line and an offset from it", () => {
    const map = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 0)],
    ]);
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "straight"), (id) =>
      map.get(id),
    )!;
    // A point a little above the middle of a left-to-right line.
    const at = closestOnPath(path, { x: 200, y: -20 });
    expect(at.t).toBeCloseTo(0.5, 1);
    expect(Math.abs(at.offset)).toBeCloseTo(20, 0);
  });
});

describe("picking a connector", () => {
  it("measures the distance to the path, curve included", () => {
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "curved"), resolve)!;
    const polyline = pathPolyline(path);
    // The midpoint of the chord lies on this particular curve only because both
    // control points are on the same axis; a point well away is far from it.
    expect(distanceToPath({ x: 200, y: 0 }, polyline)).toBeLessThan(0.5);
    expect(distanceToPath({ x: 200, y: 300 }, polyline)).toBeGreaterThan(100);
  });

  it("follows an elbow's corner rather than the straight chord", () => {
    const below = new Map([
      ["a", note("a", 0, 0)],
      ["b", note("b", 400, 400)],
    ]);
    const path = connectorPath(connector({ item: "a" }, { item: "b" }, "elbowed"), (id) => below.get(id))!;
    const polyline = pathPolyline(path);
    // A point at the inside of the corner is close to the elbow, far from the chord.
    expect(distanceToPath({ x: 300, y: 300 }, polyline)).toBeLessThan(200);
  });

  it("keeps a straight line's endpoints on the box edges", () => {
    const elbow = elbowPoints({ x: 50, y: 0 }, "right", { x: 350, y: 100 }, "left");
    expect(elbow[0]).toEqual({ x: 50, y: 0 });
    expect(elbow[elbow.length - 1]).toEqual({ x: 350, y: 100 });
  });
});

describe("ADR-077: routing with waypoints", () => {
  const routed = (
    start: Widget["start"],
    end: Widget["end"],
    routing: "straight" | "elbow" | "curved",
    waypoints: { id: string; x: number; y: number; rigid?: boolean }[] = [],
  ): Widget => ({
    id: "c",
    type: "connector",
    parentId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    start,
    end,
    routing,
    waypoints,
  });

  it("passes a straight line through its rigid points in order", () => {
    const path = connectorPath(
      routed({ item: "a", side: "right" }, { item: "b", side: "left" }, "straight", [
        { id: "w1", x: 150, y: 80, rigid: true },
        { id: "w2", x: 240, y: -40, rigid: true },
      ]),
      resolve,
    )!;
    expect(path.points).toEqual([
      { x: 50, y: 0 },
      { x: 150, y: 80 },
      { x: 240, y: -40 },
      { x: 350, y: 0 },
    ]);
  });

  it("keeps every elbow segment orthogonal around a waypoint", () => {
    const path = connectorPath(
      routed({ item: "a", side: "right" }, { item: "b", side: "left" }, "elbow", [
        { id: "w1", x: 150, y: 120 },
      ]),
      resolve,
    )!;
    for (let i = 1; i < path.points.length; i += 1) {
      const a = path.points[i - 1]!;
      const b = path.points[i]!;
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
    }
    expect(path.points[0]).toEqual({ x: 50, y: 0 });
    expect(path.points[path.points.length - 1]).toEqual({ x: 350, y: 0 });
  });

  it("bends a curved line around its supports instead of ignoring them", () => {
    const flat = connectorPath(routed({ item: "a" }, { item: "b" }, "curved"), resolve)!;
    const bent = connectorPath(
      routed({ item: "a" }, { item: "b" }, "curved", [{ id: "w1", x: 200, y: 160 }]),
      resolve,
    )!;
    expect(Math.max(...bent.points.map((p) => p.y))).toBeGreaterThan(
      Math.max(...flat.points.map((p) => p.y)),
    );
    expect(bent.curve).toBeUndefined();
    // A support is a control point, not a stop: the arc passes near it, not through.
    expect(distanceToPath({ x: 200, y: 160 }, bent.points)).toBeGreaterThan(10);
  });

  it("shows hollow ends and rigid points, and a filled dot per segment", () => {
    const widget = routed({ item: "a", side: "right" }, { item: "b", side: "left" }, "straight", [
      { id: "w1", x: 200, y: 80, rigid: true },
    ]);
    const handles = connectorHandles(connectorPath(widget, resolve)!, widget);
    expect(handles.filter((h) => h.kind === "end")).toHaveLength(2);
    expect(handles.filter((h) => h.kind === "waypoint")).toHaveLength(1);
    expect(handles.filter((h) => h.kind === "midpoint")).toHaveLength(2);
  });

  it("hides the automatic midpoint when the segment is shorter than 24 px", () => {
    const close = new Map([
      ["a", note("a", 0, 0, 100, 100)],
      ["b", note("b", 120, 0, 100, 100)],
    ]);
    const short = routed({ item: "a", side: "right" }, { item: "b", side: "left" }, "straight");
    const handles = connectorHandles(connectorPath(short, (id) => close.get(id))!, short);
    expect(handles.filter((h) => h.kind === "midpoint")).toHaveLength(0);
    expect(handles.filter((h) => h.kind === "end")).toHaveLength(2);
  });

  it("limits a line to 32 waypoints", () => {
    const waypoints = Array.from({ length: 32 }, (_, i) => ({ id: `w${i}`, x: 60 + i * 5, y: 0 }));
    const widget = routed({ item: "a" }, { item: "b" }, "straight", waypoints);
    // The router itself does not enforce the limit; the command does. This is the
    // guard the command reads.
    expect(waypoints).toHaveLength(32);
    expect(connectorHandles(connectorPath(widget, resolve)!, widget).filter((h) => h.kind === "waypoint")).toHaveLength(32);
  });
});

describe("legacy corner ports (ADR-137)", () => {
  const wide = boxOf(note("a", 0, 0, 200, 100));

  it("folds a stored corner onto the nearest side midpoint", () => {
    // Top-left of a wide note is closer to the left midpoint than to the top one.
    expect(resolvedEndSide({ item: "a", side: "top", offset: 0 }, wide, "right")).toBe("left");
    // Top-right is closer to the right midpoint.
    expect(resolvedEndSide({ item: "a", side: "top", offset: 1 }, wide, "left")).toBe("right");
  });

  it("keeps an explicit side with no legacy offset", () => {
    expect(resolvedEndSide({ item: "a", side: "top" }, wide, "right")).toBe("top");
    expect(resolvedEndSide(undefined, wide, "bottom")).toBe("bottom");
    // 0.5 was the old midpoint and is still that side.
    expect(resolvedEndSide({ item: "a", side: "top", offset: 0.5 }, wide, "right")).toBe("top");
  });

  it("breaks a square corner tie in the fixed order", () => {
    const square = boxOf(note("s", 0, 0, 100, 100));
    // Two sides are equally near; `left` comes first in the order.
    expect(resolvedEndSide({ item: "s", side: "top", offset: 0 }, square, "right")).toBe("left");
  });

  it("draws the line from the migrated side, not the stored corner", () => {
    const path = connectorPath(
      connector({ item: "a", side: "top", offset: 0 }, { item: "b", side: "left" }, "straight"),
      resolve,
    )!;
    // `a` is 100×80 at the origin: its left midpoint is (-50, 0).
    expect(path.points[0]).toEqual({ x: -50, y: 0 });
  });
});

describe("the drawn line stops short of its objects (ADR-184)", () => {
  it("pulls each end back along its own segment", () => {
    const drawn = insetPath({ points: [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 350, y: 100 }] }, 8);
    expect(drawn.points).toEqual([{ x: 50, y: 8 }, { x: 50, y: 100 }, { x: 342, y: 100 }]);
  });

  it("moves a curve's ends with its points", () => {
    const curve = { from: { x: 0, y: 0 }, c1: { x: 60, y: 0 }, c2: { x: 140, y: 0 }, to: { x: 200, y: 0 } };
    const drawn = insetPath({ points: [curve.from, curve.c1, curve.c2, curve.to], curve }, 8);
    expect(drawn.curve).toEqual({ ...curve, from: { x: 8, y: 0 }, to: { x: 192, y: 0 } });
  });

  it("keeps a short line visible and leaves the attached path alone", () => {
    const path = { points: [{ x: 0, y: 0 }, { x: 12, y: 0 }] };
    expect(insetPath(path, 8).points).toEqual([{ x: 4, y: 0 }, { x: 8, y: 0 }]);
    expect(path.points).toEqual([{ x: 0, y: 0 }, { x: 12, y: 0 }]);
    expect(CONNECTOR_GAP).toBe(8);
  });
});

describe("an arrow head meets its line cleanly (ADR-187)", () => {
  const tip = { x: 100, y: 0 };
  const tail = { x: 0, y: 0 };

  it("rounds its apex onto the tip, never past it", () => {
    for (const width of [1, 2, 4, 8]) {
      const head = roundedArrowHead(tip, tail, width);
      const apex = head.points[0]!;
      // The round join grows the apex by radius / sin(spread): it reaches the tip exactly.
      expect(apex.x + head.radius / Math.sin(0.42)).toBeCloseTo(tip.x, 6);
      expect(apex.y).toBeCloseTo(0, 6);
      for (const point of head.points) expect(point.x).toBeLessThan(tip.x);
    }
  });

  it("stops the line inside the head, where the head is wider than the line", () => {
    for (const width of [1, 2, 4, 8]) {
      const head = roundedArrowHead(tip, tail, width);
      expect(head.lineEnd.x).toBeLessThan(tip.x - width / 2);
      const [apex, b, c] = head.points;
      const halfAt = ((apex!.x - head.lineEnd.x) * Math.abs(b!.y - c!.y)) / 2 / (apex!.x - b!.x) + head.radius;
      expect(halfAt).toBeGreaterThan(width / 2);
      expect(head.trim).toBeCloseTo(tip.x - head.lineEnd.x, 6);
    }
  });

  it("grows with a thick line and keeps the default size at 2", () => {
    expect(arrowHeadSize(2)).toBe(14);
    expect(arrowHeadSize(6)).toBeGreaterThan(arrowHeadSize(2));
  });

  it("trims each end of the drawn path by its own amount", () => {
    const drawn = insetPath({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, 0, 10);
    expect(drawn.points).toEqual([{ x: 0, y: 0 }, { x: 90, y: 0 }]);
  });
});
