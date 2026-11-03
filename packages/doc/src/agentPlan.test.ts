import { describe, expect, it } from "vitest";
import { WIDGET_KINDS } from "@remo/model";
import {
  CONNECTABLE_TYPES,
  buildStructurePlan,
  planFromOperations,
  type AgentPlan,
} from "@remo/agent-plan";
import { BoardDocument } from "./board";
import { applyAgentPlan } from "./agentPlan";
import { createConnector } from "./connectors";
import { createSticky } from "./notes";

/**
 * Applying an agent plan is one local gesture (ADR-142): one transaction, one undo
 * step, and no server write. These tests pin that promise at the document level.
 */

function freshBoard(): BoardDocument {
  return new BoardDocument();
}

function note(tempId: string, x = 0, extra = {}) {
  return {
    tempId,
    type: "sticky_note" as const,
    x,
    y: 0,
    width: 161.2,
    height: 184.7,
    ...extra,
  };
}

describe("applyAgentPlan (ADR-142)", () => {
  it("writes a story map and takes it back with one undo", () => {
    const board = freshBoard();
    board.author = "Ada";
    const plan = buildStructurePlan(
      "user-story-map",
      { columns: [{ title: "Activity", stories: ["One", "Two"] }] },
      { x: 0, y: 0 },
    );

    const applied = applyAgentPlan(board, plan, { approved: true, now: 1_700_000_000_000 });

    expect(board.widgets.size).toBe(plan.counts.objects);
    const storyId = applied.ids.tmp_sticky_c1_r1!;
    expect(board.textOf(storyId)).toBe("One");
    expect(board.widgets.get(applied.ids.tmp_header!)!).toMatchObject({
      createdBy: "Ada",
      createdAt: 1_700_000_000_000,
    });
    expect(board.widgets.get(storyId)!.parentId).toBe(applied.ids.tmp_lane_1);

    board.undoOnce();

    expect(board.widgets.size).toBe(0);
    expect(board.texts.size).toBe(0);
  });

  it("resolves connector endpoints from tempIds", () => {
    const board = freshBoard();
    const plan = planFromOperations([
      { op: "create_widgets", objects: [note("a"), note("b", 300)] },
      { op: "create_connector", from: "a", to: "b", arrow: "both" },
    ]);

    const applied = applyAgentPlan(board, plan, { approved: true, author: "Ada" });
    const connector = board.widgets.get(applied.ids.tmp_conn_1!)!;

    expect(connector.type).toBe("connector");
    expect(connector.start?.item).toBe(applied.ids.a);
    expect(connector.end?.item).toBe(applied.ids.b);
    expect(connector.arrow).toBe("both");

    board.undoOnce();
    expect(board.widgets.size).toBe(0);
  });

  it("keeps an existing frame when the plan only adds its children", () => {
    const board = freshBoard();
    const frameId = "frame_existing";
    board.widgets.set(frameId, {
      id: frameId,
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      title: "Section",
    });
    board.undo.clear();

    const plan = planFromOperations(
      [
        {
          op: "create_widgets",
          objects: [note("note", 0, { parentRef: frameId, text: "Inside" })],
        },
      ],
      { existingWidgets: [{ id: frameId, type: "frame" }] },
    );
    const applied = applyAgentPlan(board, plan, { approved: true });

    expect(board.widgets.get(applied.ids.note!)!.parentId).toBe(frameId);

    board.undoOnce();

    expect(board.widgets.size).toBe(1);
    expect(board.widgets.has(frameId)).toBe(true);
  });

  it("refuses a plan whose parent is missing and writes nothing", () => {
    const board = freshBoard();
    const plan: AgentPlan = {
      version: 1,
      template: null,
      origin: { x: 0, y: 0 },
      objects: [{ ...note("note"), parentRef: "missing" }],
      connectors: [],
      counts: { objects: 1, connectors: 0, actions: 1, byType: { sticky_note: 1 } },
      bounds: { x: -80.6, y: -92.35, width: 161.2, height: 184.7 },
      warnings: [],
    };

    expect(() => applyAgentPlan(board, plan, { approved: true })).toThrowError(/does not exist/);
    expect(board.widgets.size).toBe(0);
  });

  it("stamps agent provenance on every object when asked", () => {
    const board = freshBoard();
    const plan = planFromOperations([
      { op: "create_widgets", objects: [note("a"), note("b", 300)] },
      { op: "create_connector", from: "a", to: "b" },
    ]);
    const applied = applyAgentPlan(board, plan, {
      approved: true,
      author: "Ada",
      provenance: { id: "agent_1", name: "Story map", taskId: "task_1", skill: "authoring" },
    });

    for (const id of [...applied.objectIds, ...applied.connectorIds]) {
      expect(board.widgets.get(id)!.agent).toEqual({
        id: "agent_1",
        name: "Story map",
        taskId: "task_1",
        skill: "authoring",
      });
    }
  });

  it("refuses a connector duplicate of a board line before writing", () => {
    const board = freshBoard();
    const a = createSticky(board, "sticky_a", { x: 0, y: 0 });
    const b = createSticky(board, "sticky_b", { x: 300, y: 0 });
    createConnector(board, "conn_existing", a, b);
    board.undo.clear();

    const plan: AgentPlan = {
      version: 1,
      template: null,
      origin: { x: 0, y: 0 },
      objects: [],
      connectors: [{ tempId: "tmp_conn_1", from: a, to: b }],
      counts: { objects: 0, connectors: 1, actions: 1, byType: {} },
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      warnings: [],
    };

    expect(() => applyAgentPlan(board, plan, { approved: true })).toThrowError(/already have a connector/);
    expect(board.widgets.size).toBe(3);
  });

  it("refuses to apply without explicit approval", () => {
    const board = freshBoard();
    const plan = buildStructurePlan(
      "user-story-map",
      { columns: [{ title: "Activity", stories: ["One"] }] },
      { x: 0, y: 0 },
    );

    expect(() => applyAgentPlan(board, plan, { approved: false })).toThrowError(/confirms/);
    expect(board.widgets.size).toBe(0);
  });

  it("moves existing objects and creates block frames in one undo step", () => {
    const board = freshBoard();
    board.author = "Ada";
    for (const [id, x] of [["a", -500], ["b", 0], ["c", 500]]) {
      board.widgets.set(id, {
        id,
        type: "sticky_note",
        parentId: null,
        x,
        y: 0,
        width: 160,
        height: 180,
        content: `Note ${id}`,
      });
    }
    // A line between two notes must survive a tidy: moving an object never edits a
    // connector (ADR-143).
    createConnector(board, "line", "a", "b");
    board.undo.clear();

    const plan = planFromOperations([
      {
        op: "create_widgets",
        objects: [
          {
            tempId: "block",
            type: "frame",
            x: 0,
            y: 0,
            width: 220,
            height: 500,
            title: "US",
          },
        ],
      },
      {
        op: "place_widgets",
        items: [
          { id: "a", x: 0, y: -100, parentRef: "block" },
          { id: "b", x: 0, y: 200, parentRef: "block" },
          { id: "c", x: 0, y: 380, parentRef: "block" },
        ],
      },
    ], {
      existingWidgets: [
        { id: "a", type: "sticky_note" },
        { id: "b", type: "sticky_note" },
        { id: "c", type: "sticky_note" },
      ],
    });

    const applied = applyAgentPlan(board, plan, {
      approved: true,
      allowedIds: ["a", "b", "c"],
    });
    const frameId = applied.ids.block!;
    expect(applied.movedIds.sort()).toEqual(["a", "b", "c"]);
    expect(board.widgets.get("a")).toMatchObject({
      x: 0,
      y: -100,
      width: 160,
      height: 180,
      parentId: frameId,
      content: "Note a",
    });
    const line = [...board.widgets.values()].find((widget) => widget.type === "connector");
    expect(line?.start?.item).toBe("a");
    expect(line?.end?.item).toBe("b");

    // One gesture: the frames and every move disappear together.
    board.undoOnce();
    expect(board.widgets.get(frameId)).toBeUndefined();
    expect(board.widgets.get("a")).toMatchObject({ x: -500, y: 0, parentId: null });
    expect(board.widgets.get("b")).toMatchObject({ x: 0, y: 0, parentId: null });
  });

  it("leaves a locked object where it is and reports the skip", () => {
    const board = freshBoard();
    for (const [id, locked] of [["a", false], ["b", true]] as const) {
      board.widgets.set(id, {
        id,
        type: "sticky_note",
        x: id === "a" ? -300 : 300,
        y: 0,
        width: 160,
        height: 180,
        locked,
      });
    }
    board.undo.clear();

    const plan = planFromOperations([
      {
        op: "place_widgets",
        items: [
          { id: "a", x: 0, y: 0 },
          { id: "b", x: 0, y: 200 },
        ],
      },
    ], {
      existingWidgets: [
        { id: "a", type: "sticky_note" },
        { id: "b", type: "sticky_note", locked: true },
      ],
    });
    const applied = applyAgentPlan(board, plan, { approved: true });
    expect(applied.movedIds).toEqual(["a"]);
    expect(board.widgets.get("b")).toMatchObject({ x: 300, y: 0 });
    expect(plan.warnings.some((warning) => warning.code === "TIDY_LOCKED_SKIPPED")).toBe(true);
  });

  it("refuses a placement outside the selection", () => {
    const board = freshBoard();
    for (const id of ["a", "b"]) {
      board.widgets.set(id, {
        id,
        type: "sticky_note",
        x: 0,
        y: 0,
        width: 160,
        height: 180,
      });
    }
    board.undo.clear();
    const plan = planFromOperations([
      { op: "place_widgets", items: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 200 }] },
    ], {
      existingWidgets: [
        { id: "a", type: "sticky_note" },
        { id: "b", type: "sticky_note" },
      ],
    });

    expect(() =>
      applyAgentPlan(board, plan, { approved: true, allowedIds: ["a"] }),
    ).toThrow(/not in the selection/);
    expect(board.widgets.get("b")).toMatchObject({ x: 0, y: 0 });
  });

  it("keeps the connectable list equal to the model's capability table", () => {
    const model = Object.entries(WIDGET_KINDS)
      .filter(([, kind]) => kind.connectable)
      .map(([type]) => type)
      .sort();
    expect([...CONNECTABLE_TYPES].sort()).toEqual(model);
  });
});
