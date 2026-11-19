import { describe, expect, it } from "vitest";
import {
  hasLegacyConnectorShape,
  joinsWithin,
  rigidWaypoints,
  routingOf,
  withRouting,
} from "./connectors";
import type { Widget } from "./types";

const line = (extra: Partial<Widget>): Widget => ({
  id: "c",
  type: "connector",
  parentId: null,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  ...extra,
});

describe("connector migration (ADR-077)", () => {
  it("maps the old shape names to routing", () => {
    expect(routingOf(line({ connectorShape: "straight" }))).toBe("straight");
    expect(routingOf(line({ connectorShape: "elbowed" }))).toBe("elbow");
    expect(routingOf(line({ connectorShape: "curved" }))).toBe("curved");
    expect(routingOf(line({}))).toBe("elbow");
  });

  it("drops the old special cases on the first write", () => {
    const old = line({ connectorShape: "elbowed", bend: 0.4, elbowFlip: true, curve: { from: 1, to: 2 } });
    expect(hasLegacyConnectorShape(old)).toBe(true);
    const next = withRouting(old, "curved");
    expect(next.routing).toBe("curved");
    expect(next.connectorShape).toBeUndefined();
    expect(next.bend).toBeUndefined();
    expect(next.elbowFlip).toBeUndefined();
    expect(next.curve).toBeUndefined();
  });

  it("keeps only rigid points as user state", () => {
    expect(
      rigidWaypoints(line({ waypoints: [
        { id: "a", x: 1, y: 2, rigid: true },
        { id: "b", x: 3, y: 4, rigid: false },
      ] })),
    ).toEqual([{ id: "a", x: 1, y: 2, rigid: true }]);
  });
});

describe("a line needs both ends (ADR-138)", () => {
  const ids = new Set(["a", "b"]);

  it("joins when both ends are in the set, in either direction", () => {
    expect(joinsWithin(line({ start: { item: "a" }, end: { item: "b" } }), ids)).toBe(true);
    expect(joinsWithin(line({ start: { item: "b" }, end: { item: "a" } }), ids)).toBe(true);
  });

  it("does not join with one end inside, or with no ends at all", () => {
    expect(joinsWithin(line({ start: { item: "a" }, end: { item: "c" } }), ids)).toBe(false);
    expect(joinsWithin(line({ start: { item: "a" } }), ids)).toBe(false);
    expect(joinsWithin(line({}), ids)).toBe(false);
  });

  it("is never true for an object that is not a connector", () => {
    const note = line({ type: "sticky_note" });
    expect(joinsWithin(note, ids)).toBe(false);
  });
});
