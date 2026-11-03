/**
 * Geometry for connectors.
 *
 * A connector stores only which two objects it joins, and (optionally) which side of
 * each it leaves from. Where the line actually runs is derived here, on every paint.
 * That is the same rule as a kanban card's position: the visible layout is never the
 * stored state, so dragging an object can never leave a stale line behind.
 *
 * The three shapes are the source product's own (`straight`, `elbowed`, `curved`),
 * and so is the anchor model: a side plus a position along it (ADR-029).
 */
import type { ConnectorEnd, ConnectorSide, Rect, Vec2, Widget } from "@remo/model";
import { hasLegacyConnectorShape, rigidWaypoints, routingOf } from "@remo/model";

export interface Segment {
  from: Vec2;
  to: Vec2;
}

/** A connector's path, flattened enough to be drawn and picked. */
export interface ConnectorPath {
  /** Polyline points; a straight connector has two, an elbow three or four. */
  points: Vec2[];
  /** Control points when the line is curved, so the painter can draw it as a curve. */
  curve?: { from: Vec2; c1: Vec2; c2: Vec2; to: Vec2 };
}

export function boxOf(widget: Widget): Rect {
  return {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
}

/** Unit vector pointing out of the given side. */
export function sideNormal(side: ConnectorSide): Vec2 {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

/** Side of `box` that faces `towards`. */
export function facingSide(box: Rect, towards: Vec2): ConnectorSide {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const dx = towards.x - centerX;
  const dy = towards.y - centerY;

  // Compare against the box's aspect so a wide note does not answer "left" for a
  // point that is almost directly below it.
  const scaleX = dx / Math.max(box.width / 2, 1);
  const scaleY = dy / Math.max(box.height / 2, 1);
  if (Math.abs(scaleX) >= Math.abs(scaleY)) return scaleX >= 0 ? "right" : "left";
  return scaleY >= 0 ? "bottom" : "top";
}

/** Ports in the order a tie between two equally near sides is broken (ADR-137). */
const SIDE_ORDER: ConnectorSide[] = ["left", "right", "top", "bottom"];

/**
 * Side whose midpoint is nearest a point (ADR-137).
 *
 * Used only for the legacy corner ends: the point is a corner of the box, which lies
 * on two sides at once. Comparing against the midpoints makes the answer depend on
 * the box's aspect — a corner of a wide note belongs to its short side — and the fixed
 * order settles the square case.
 */
export function nearestSideMidpoint(
  box: Rect,
  point: Vec2,
): ConnectorSide {
  let best: ConnectorSide = SIDE_ORDER[0]!;
  let bestDistance = Infinity;
  for (const side of SIDE_ORDER) {
    const midpoint = anchorPoint(box, side);
    const distance = Math.hypot(midpoint.x - point.x, midpoint.y - point.y);
    if (distance < bestDistance) {
      best = side;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Side a stored end resolves to (ADR-137).
 *
 * Boards made before four ports carry `offset` 0 or 1 for a corner. The corner is
 * folded onto the nearest side midpoint; every other offset is ignored, because a
 * port is now a side and never a point along it. Nothing is written: old documents
 * keep their records and the next edit stores a side-only end.
 */
export function resolvedEndSide(
  end: ConnectorEnd | undefined,
  box: Rect,
  fallback: ConnectorSide,
): ConnectorSide {
  const side = end?.side ?? fallback;
  const offset = end?.offset;
  if (offset !== 0 && offset !== 1) return side;
  return nearestSideMidpoint(box, anchorPoint(box, side, offset));
}

/** Point on `side` of `box`, `offset` along it (0.5 is the middle). */
export function anchorPoint(box: Rect, side: ConnectorSide, offset = 0.5): Vec2 {
  const t = Math.min(1, Math.max(0, offset));
  switch (side) {
    case "left":
      return { x: box.x, y: box.y + t * box.height };
    case "right":
      return { x: box.x + box.width, y: box.y + t * box.height };
    case "top":
      return { x: box.x + t * box.width, y: box.y };
    case "bottom":
      return { x: box.x + t * box.width, y: box.y + box.height };
  }
}

/**
 * Point where the line from `from` to `to` leaves `box`.
 *
 * Used when an end has no explicit side: clipping to the box (rather than starting
 * at the centre) keeps arrow heads and line caps off the object they belong to.
 */
export function edgePoint(box: Rect, towards: Vec2): Vec2 {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scale = Math.min(
    dx === 0 ? Infinity : Math.abs(halfWidth / dx),
    dy === 0 ? Infinity : Math.abs(halfHeight / dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** How an elbow leaves an object; settings can tune both numbers. */
export interface StubOptions {
  /** Longest straight run out of either object. */
  max?: number;
  /** That run as a share of the distance between the two anchors. */
  ratio?: number;
}

const DEFAULT_STUB: Required<StubOptions> = { max: 24, ratio: 0.28 };

/**
 * Stub length for a gap of `distance` between the two anchors.
 *
 * Two full-length stubs in a narrow gap would cross each other and the route would
 * double back on itself — the "double line" an elbow shows between notes placed too
 * close. Shrinking the stub keeps the turn inside the gap.
 */
export function stubLength(distance: number, options: StubOptions = {}): number {
  return stubFor(distance, options);
}

function stubFor(distance: number, options: StubOptions = {}): number {
  const max = options.max ?? DEFAULT_STUB.max;
  const ratio = options.ratio ?? DEFAULT_STUB.ratio;
  // Never past the halfway point: two stubs longer than half the gap cross, and the
  // route would double back whatever the settings say.
  return Math.max(4, Math.min(max, distance * ratio, distance * 0.45));
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

function same(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/** Drop points that repeat or lie on the line through their neighbours. */
export function simplify(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && same(last, point)) continue;
    out.push(point);
  }
  for (let i = 1; i < out.length - 1; ) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 0.01) out.splice(i, 1);
    else i += 1;
  }
  return out;
}

/**
 * Path of an elbow connector.
 *
 * Both ends leave their object straight out of their side, which is what makes the
 * route read as "attached here" rather than as a line that happens to touch a corner.
 * Between the two stubs the route turns on the axis both sides share; sides on
 * different axes meet at one corner.
 */
export function elbowPoints(
  from: Vec2,
  fromSide: ConnectorSide,
  to: Vec2,
  toSide: ConnectorSide,
  stubOptions: StubOptions = {},
  /** Where the middle run sits between the stubs, 0…1. */
  bend = 0.5,
  /** Which corner an elbow turns on when the sides are on different axes. */
  flip = false,
): Vec2[] {
  const stub = stubFor(Math.hypot(to.x - from.x, to.y - from.y), stubOptions);
  const fromStub = add(from, scale(sideNormal(fromSide), stub));
  const toStub = add(to, scale(sideNormal(toSide), stub));
  const fromHorizontal = fromSide === "left" || fromSide === "right";
  const toHorizontal = toSide === "left" || toSide === "right";

  const points: Vec2[] = [from, fromStub];

  const at = Math.min(1, Math.max(0, bend));
  if (fromHorizontal && toHorizontal) {
    const midX = fromStub.x + (toStub.x - fromStub.x) * at;
    points.push({ x: midX, y: fromStub.y }, { x: midX, y: toStub.y });
  } else if (!fromHorizontal && !toHorizontal) {
    const midY = fromStub.y + (toStub.y - fromStub.y) * at;
    points.push({ x: fromStub.x, y: midY }, { x: toStub.x, y: midY });
  } else if (fromHorizontal) {
    points.push(flip ? { x: fromStub.x, y: toStub.y } : { x: toStub.x, y: fromStub.y });
  } else {
    points.push(flip ? { x: toStub.x, y: fromStub.y } : { x: fromStub.x, y: toStub.y });
  }

  points.push(toStub, to);
  return simplify(points);
}

/**
 * Full path of a connector.
 *
 * Returns null when either end is missing — a line to an object that no longer
 * exists has nothing to draw.
 */
export function connectorPath(
  connector: Widget,
  resolve: (id: string) => Widget | undefined,
  stubOptions: StubOptions = {},
): ConnectorPath | null {
  const fromWidget = connector.start?.item ? resolve(connector.start.item) : undefined;
  const toWidget = connector.end?.item ? resolve(connector.end.item) : undefined;
  if (!fromWidget || !toWidget) return null;

  const fromBox = boxOf(fromWidget);
  const toBox = boxOf(toWidget);

  // An explicit side wins; otherwise the side facing the other end is the anchor,
  // which is exactly what "draw a line to that object" means. A stored corner from
  // the eight-port world resolves to its nearest side (ADR-137).
  const fromSide = resolvedEndSide(
    connector.start,
    fromBox,
    facingSide(fromBox, { x: toWidget.x, y: toWidget.y }),
  );
  const toSide = resolvedEndSide(
    connector.end,
    toBox,
    facingSide(toBox, { x: fromWidget.x, y: fromWidget.y }),
  );
  const from = anchorPoint(fromBox, fromSide);
  const to = anchorPoint(toBox, toSide);

  // Records made before ADR-077 keep their old geometry for one release: their
  // `bend`/`elbowFlip`/`curve` fields are not user state any more, but silently
  // changing old boards is worse than a temporary read path.
  if (hasLegacyConnectorShape(connector)) {
    const shape = connector.connectorShape ?? "elbowed";
    if (shape === "elbowed") {
      return {
        points: elbowPoints(from, fromSide, to, toSide, stubOptions, connector.bend, connector.elbowFlip),
      };
    }
    if (shape === "curved") {
      const natural = Math.max(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.42);
      const out = connector.curve?.from ?? natural;
      const into = connector.curve?.to ?? natural;
      const c1 = add(from, scale(sideNormal(fromSide), out));
      const c2 = add(to, scale(sideNormal(toSide), into));
      return {
        points: [from, c1, c2, to],
        curve: { from, c1, c2, to },
      };
    }
    return { points: [from, to] };
  }

  const routing = routingOf(connector);
  const waypoints = (connector.waypoints ?? []).map((point) => ({ x: point.x, y: point.y }));

  if (routing === "straight") {
    return { points: simplify([from, ...waypoints, to]) };
  }

  if (routing === "elbow") {
    if (!waypoints.length) {
      return { points: elbowPoints(from, fromSide, to, toSide, stubOptions) };
    }
    return { points: elbowThrough(from, fromSide, to, toSide, waypoints, stubOptions) };
  }

  if (!waypoints.length) {
    // Curved without waypoints: a cubic leaving each side perpendicular, which is
    // the shape the source product draws.
    const natural = Math.max(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.42);
    const c1 = add(from, scale(sideNormal(fromSide), natural));
    const c2 = add(to, scale(sideNormal(toSide), natural));
    return {
      points: [from, c1, c2, to],
      curve: { from, c1, c2, to },
    };
  }

  // Curved with waypoints: the arc bends around them, so they are supports rather
  // than points the line must pass through (ADR-077). A chain of quadratic segments
  // uses each support as a control point, so the curve approaches it without
  // cutting the corner into a sharp turn.
  return { points: curvedAround(from, waypoints, to) };
}

/**
 * Orthogonal route through user points.
 *
 * Each pair of consecutive supports is joined with one corner; the corner direction
 * follows the previous segment so the line keeps turning in the same sense instead
 * of zig-zagging between every pair.
 */
function elbowThrough(
  from: Vec2,
  fromSide: ConnectorSide,
  to: Vec2,
  toSide: ConnectorSide,
  waypoints: Vec2[],
  stubOptions: StubOptions,
): Vec2[] {
  const stub = stubFor(Math.hypot(to.x - from.x, to.y - from.y), stubOptions);
  const chain = [
    from,
    add(from, scale(sideNormal(fromSide), stub)),
    ...waypoints,
    add(to, scale(sideNormal(toSide), stub)),
    to,
  ];
  const out: Vec2[] = [chain[0]!];
  for (let i = 1; i < chain.length; i += 1) {
    const a = out[out.length - 1]!;
    const b = chain[i]!;
    if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) {
      out.push(b);
      continue;
    }
    const previous = out[out.length - 2] ?? a;
    const lastHorizontal = Math.abs(a.y - previous.y) < 0.01;
    out.push(lastHorizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    out.push(b);
  }
  return simplify(out);
}

/**
 * Curve that bends around its supports instead of passing through them.
 *
 * For supports w1…wn, the curve is a chain of quadratic segments whose controls are
 * the supports and whose knots are the midpoints between them. The endpoints stay
 * exact, a single support bends the line without touching it, and several supports
 * read as a smooth detour rather than a polyline with rounded corners.
 */
function curvedAround(from: Vec2, waypoints: Vec2[], to: Vec2, perSegment = 10): Vec2[] {
  if (!waypoints.length) return [from, to];
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const knots: Vec2[] = [from];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    knots.push(mid(waypoints[i]!, waypoints[i + 1]!));
  }
  knots.push(to);

  const out: Vec2[] = [];
  for (let i = 0; i < waypoints.length; i += 1) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    const control = waypoints[i]!;
    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
      });
    }
  }
  out.push(to);
  return out;
}

/** Backwards-compatible straight segment used by the anchor-drag preview. */
export function connectorSegment(
  connector: Widget,
  resolve: (id: string) => Widget | undefined,
): Segment | null {
  const path = connectorPath(connector, resolve);
  if (!path) return null;
  return { from: path.points[0]!, to: path.points[path.points.length - 1]! };
}

/** Sample a cubic bezier into a polyline, for picking and bounds. */
export function sampleCurve(
  from: Vec2,
  c1: Vec2,
  c2: Vec2,
  to: Vec2,
  steps = 16,
): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    });
  }
  return points;
}

/** Flattened polyline of a path, curves included. */
export function pathPolyline(path: ConnectorPath): Vec2[] {
  if (!path.curve) return path.points;
  const { from, c1, c2, to } = path.curve;
  return sampleCurve(from, c1, c2, to);
}

/**
 * Point a given fraction along the line, measured by length.
 *
 * A label goes there, and so do the handles that reshape a curve. Halfway by index
 * would sit near a dense cluster of sampled points; halfway by the bounding box
 * would drift away from an elbow. Walking the flattened path is the only answer that
 * stays on the line.
 */
export function pointAtPath(path: ConnectorPath, t = 0.5): Vec2 {
  const points = pathPolyline(path);
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  const target = total * Math.min(1, Math.max(0, t));
  if (total === 0) return points[0]!;

  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (walked + length >= target) {
      const step = (target - walked) / (length || 1);
      return { x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step };
    }
    walked += length;
  }
  return points[points.length - 1]!;
}

/** Point halfway along the line. */
export function pathMidpoint(path: ConnectorPath): Vec2 {
  return pointAtPath(path, 0.5);
}

/** Unit tangent of the line at a fraction of its length. */
export function tangentAtPath(path: ConnectorPath, t = 0.5): Vec2 {
  const points = pathPolyline(path);
  if (points.length < 2) return { x: 1, y: 0 };
  const target = Math.min(1, Math.max(0, t));
  // Pick the segment the point falls in, the same way pointAtPath does.
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    lengths.push(length);
    total += length;
  }
  let walked = 0;
  let index = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    if (walked + lengths[i]! >= total * target) {
      index = i;
      break;
    }
    walked += lengths[i]!;
    index = i;
  }
  const from = points[index] ?? points[0]!;
  const to = points[index + 1] ?? points[points.length - 1]!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

/**
 * Where a connector's label sits: a fraction along the line plus a perpendicular
 * nudge, so it keeps its place (and its side of the line) when the ends move.
 */
export function labelPoint(
  path: ConnectorPath,
  at?: { t?: number; offset?: number },
): Vec2 {
  const point = pointAtPath(path, at?.t ?? 0.5);
  const offset = at?.offset ?? 0;
  if (!offset) return point;
  const tangent = tangentAtPath(path, at?.t ?? 0.5);
  return { x: point.x - tangent.y * offset, y: point.y + tangent.x * offset };
}

/**
 * Nearest point on a line to `point`, as a fraction of its length plus a signed
 * perpendicular distance.
 *
 * Dragging a label writes both: `t` slides it along the line, `offset` pushes it to
 * one side. Storing the pair (instead of a coordinate) is what keeps the label in the
 * same place relative to the line when either end moves (ADR-043).
 */
export function closestOnPath(
  path: ConnectorPath,
  point: Vec2,
): { t: number; offset: number } {
  const points = pathPolyline(path);
  if (points.length < 2) return { t: 0.5, offset: 0 };

  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    lengths.push(length);
    total += length;
  }

  let best = { t: 0.5, offset: 0, distance: Infinity };
  let walked = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const raw = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq;
    const clamped = Math.min(1, Math.max(0, raw));
    const px = from.x + dx * clamped;
    const py = from.y + dy * clamped;
    const distance = Math.hypot(point.x - px, point.y - py);
    if (distance < best.distance) {
      const length = Math.sqrt(lengthSq);
      // Positive when the point is to the left of the direction of travel.
      const side = ((point.x - px) * -dy + (point.y - py) * dx) / length;
      best = {
        t: total === 0 ? 0 : (walked + lengths[i]! * clamped) / total,
        offset: side,
        distance,
      };
    }
    walked += lengths[i]!;
  }
  return { t: best.t, offset: best.offset };
}

/** A reshape handle on a selected connector. */
export interface ConnectorHandle {
  kind: "bend" | "flip" | "curveFrom" | "curveTo" | "end" | "waypoint" | "midpoint";
  point: Vec2;
  /** The other corner a flip would choose; only meaningful for `flip`. */
  alternate?: Vec2;
  /** Segment index, waypoint index or end index. */
  index: number;
  /** The stored waypoint this handle moves, when it is a rigid point. */
  waypointId?: string;
}

/**
 * The blue dots Miro shows on a selected line.
 *
 * Four shapes, two handles: an elbow's middle run can slide between its stubs, and a
 * curve's two control lengths can be pulled out or pushed in. A straight line has
 * nothing to reshape — its only meaningful change is its endpoints.
 */
/**
 * ADR-077/§2.5: a segment shorter than this has no automatic midpoint dot, so the
 * handles never collapse into a cluster when two objects are pulled together.
 */
export const MIN_SEGMENT = 24;

export function connectorHandles(path: ConnectorPath, connector: Widget): ConnectorHandle[] {
  // New records: hollow ends/rigid points and one filled dot per segment (ADR-077).
  if (!hasLegacyConnectorShape(connector)) {
    const points = path.points;
    if (points.length < 2) return [];
    const handles: ConnectorHandle[] = [
      { kind: "end", point: points[0]!, index: 0 },
      { kind: "end", point: points[points.length - 1]!, index: 1 },
    ];
    const rigid = rigidWaypoints(connector);
    for (const [index, point] of rigid.entries()) {
      handles.push({ kind: "waypoint", point: { x: point.x, y: point.y }, index, waypointId: point.id });
    }

    // A straight/elbow line has real corners, so every segment gets a dot. A curved
    // line is sampled; its dots sit between the supports, not on every sample.
    if (routingOf(connector) === "curved") {
      if (rigid.length) {
        const supports = [points[0]!, ...rigid.map((p) => ({ x: p.x, y: p.y })), points[points.length - 1]!];
        for (let i = 1; i < supports.length; i += 1) {
          const a = supports[i - 1]!;
          const b = supports[i]!;
          if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEGMENT) continue;
          handles.push({ kind: "midpoint", point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, index: i - 1 });
        }
      } else {
        const start = points[0]!;
        const end = points[points.length - 1]!;
        if (Math.hypot(end.x - start.x, end.y - start.y) >= MIN_SEGMENT) {
          handles.push({ kind: "midpoint", point: pointAtPath(path, 0.5), index: 0 });
        }
      }
    } else {
      const corners = simplify(points);
      for (let i = 1; i < corners.length; i += 1) {
        const a = corners[i - 1]!;
        const b = corners[i]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEGMENT) continue;
        handles.push({ kind: "midpoint", point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, index: i - 1 });
      }
    }
    return handles;
  }

  const shape = connector.connectorShape ?? "straight";

  if (shape === "curved") {
    return [
      { kind: "curveFrom", point: pointAtPath(path, 1 / 3), index: 0 },
      { kind: "curveTo", point: pointAtPath(path, 2 / 3), index: 1 },
    ];
  }
  if (shape !== "elbowed") return [];

  const points = simplify(path.points);
  // Every point where the direction changes. Two turns are the ends of the straight
  // run that can slide; one turn is a single corner, and the only choice there is
  // which of the two corners the route uses.
  const turns: Vec2[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 0.01) turns.push(b);
  }

  if (turns.length >= 2) {
    return turns.slice(0, 2).map((point, index) => ({ kind: "bend" as const, point, index }));
  }
  if (turns.length === 1) {
    const corner = turns[0]!;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    // The corner shares one coordinate with each end; the alternate corner is the
    // other diagonal of the rectangle those two ends span.
    const alternate =
      Math.abs(corner.x - first.x) < 0.01
        ? { x: last.x, y: corner.y }
        : { x: first.x, y: corner.y };
    return [{ kind: "flip", point: corner, alternate, index: 0 }];
  }
  return [];
}

/** Shortest distance from a point to a polyline. */
export function distanceToPath(point: Vec2, points: Vec2[]): number {  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, { from: points[i - 1]!, to: points[i]! }));
  }
  return best;
}

/** Arrow head at `tip`, pointing away from `tail`. */
export function arrowHead(tip: Vec2, tail: Vec2, size: number): Vec2[] {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const spread = 0.42;
  return [
    tip,
    { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) },
    { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) },
  ];
}

/** Hit test a connector by distance to its line, for picking. */
export function distanceToSegment(point: Vec2, segment: Segment): number {
  const { from, to } = segment;
  const lengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + t * (to.x - from.x)), point.y - (from.y + t * (to.y - from.y)));
}
