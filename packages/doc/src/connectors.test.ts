import { describe, expect, it } from "vitest";
import {
  addConnectorWaypoint,
  createConnector,
  deleteConnectorWaypoint,
  moveConnectorWaypoint,
  reattachConnectorEnd,
  setConnectorRouting,
  swapConnectorEnds,
} from "./connectors";
import { BoardDocument } from "./board";
import { createWidget, deleteWidgets } from "./widgets";

const note = (id: string, x: number, y: number) => ({
  id,
  type: "sticky_note" as const,
  parentId: null,
  x,
  y,
  width: 100,
  height: 100,
});

function boardWith(): BoardDocument {
  const board = new BoardDocument();
  createWidget(board, note("a", 0, 0));
  createWidget(board, note("b", 400, 0));
  return board;
}

describe("ADR-077 connector commands", () => {
  it("rejects a self-loop and writes the new routing", () => {
    const board = boardWith();
    expect(createConnector(board, "self", "a", "a")).toBeNull();
    expect(createConnector(board, "c", "a", "b")).toBe("c");
    expect(board.widgets.get("c")!.routing).toBe("elbow");
    expect(board.widgets.get("c")!.connectorShape).toBeUndefined();
  });

  it("adds, moves and deletes one rigid waypoint per transaction", () => {
    const board = boardWith();
    createConnector(board, "c", "a", "b");
    expect(addConnectorWaypoint(board, "c", 200, 80, "w1")).toBe("w1");
    expect(board.widgets.get("c")!.waypoints).toEqual([{ id: "w1", x: 200, y: 80, rigid: true }]);

    moveConnectorWaypoint(board, "c", "w1", 220, 100);
    expect(board.widgets.get("c")!.waypoints![0]).toMatchObject({ x: 220, y: 100 });
    board.undoOnce();
    expect(board.widgets.get("c")!.waypoints![0]).toMatchObject({ x: 200, y: 80 });

    deleteConnectorWaypoint(board, "c", "w1");
    expect(board.widgets.get("c")!.waypoints).toEqual([]);
  });

  it("inserts a waypoint at the segment that was dragged", () => {
    const board = boardWith();
    createConnector(board, "c", "a", "b");
    addConnectorWaypoint(board, "c", 200, 80, "w1", 0);
    addConnectorWaypoint(board, "c", 260, 20, "w2", 1);
    expect(board.widgets.get("c")!.waypoints!.map((p) => p.id)).toEqual(["w1", "w2"]);
  });

  it("reverses the route when the ends are swapped", () => {
    const board = boardWith();
    createConnector(board, "c", "a", "b");
    addConnectorWaypoint(board, "c", 150, 60, "w1");
    addConnectorWaypoint(board, "c", 260, 20, "w2");
    swapConnectorEnds(board, ["c"]);
    expect(board.widgets.get("c")!.start!.item).toBe("b");
    expect(board.widgets.get("c")!.waypoints!.map((p) => p.id)).toEqual(["w2", "w1"]);
  });

  it("keeps rigid points when routing changes", () => {
    const board = boardWith();
    createConnector(board, "c", "a", "b");
    addConnectorWaypoint(board, "c", 200, 80, "w1");
    setConnectorRouting(board, ["c"], "curved");
    expect(board.widgets.get("c")!.routing).toBe("curved");
    expect(board.widgets.get("c")!.waypoints).toHaveLength(1);
  });

  it("refuses the 33rd waypoint", () => {
    const board = boardWith();
    createConnector(board, "c", "a", "b");
    for (let i = 0; i < 32; i += 1) {
      expect(addConnectorWaypoint(board, "c", 60 + i * 4, 0, `w${i}`)).toBe(`w${i}`);
    }
    expect(addConnectorWaypoint(board, "c", 300, 0, "w32")).toBeNull();
  });

  it("reattaches an end, but never into a self-loop", () => {
    const board = boardWith();
    createWidget(board, note("other", 0, 300));
    createConnector(board, "c", "a", "b");
    expect(reattachConnectorEnd(board, "c", "end", "a")).toBe(false);
    expect(reattachConnectorEnd(board, "c", "end", "other", "top")).toBe(true);
    expect(board.widgets.get("c")!.end).toEqual({ item: "other", side: "top" });
  });

  it("deletes a connector with its endpoint and restores both on undo", () => {
    const board = boardWith();
    createConnector(board, "c", "a", "b");
    deleteWidgets(board, ["a"]);
    expect(board.widgets.has("c")).toBe(false);
    board.undoOnce();
    expect(board.widgets.has("a")).toBe(true);
    expect(board.widgets.get("c")!.start).toEqual({ item: "a" });
  });
});
