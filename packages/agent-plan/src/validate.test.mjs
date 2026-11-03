import { describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  PlanError,
  estimatePlan,
  planFromOperations,
  validatePlan,
} from "./index.mjs";

/**
 * The plan contract: what an agent may ask for, and what is refused before a person
 * ever sees the preview (ADR-142).
 */

function sticky(tempId, extra = {}) {
  return {
    tempId,
    type: "sticky_note",
    x: 0,
    y: 0,
    width: 161.2,
    height: 184.7,
    ...extra,
  };
}

function frame(tempId, extra = {}) {
  return { tempId, type: "frame", x: 0, y: 0, width: 600, height: 400, ...extra };
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof PlanError ? error.code : `unexpected:${error.message}`;
  }
}

function draft(overrides = {}) {
  return {
    version: 1,
    template: null,
    origin: { x: 0, y: 0 },
    objects: [],
    connectors: [],
    counts: { objects: 0, connectors: 0, actions: 0, byType: {} },
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    warnings: [],
    ...overrides,
  };
}

describe("create_widgets (ADR-142)", () => {
  it("normalizes objects and their parent references", () => {
    const plan = planFromOperations([
      {
        op: "create_widgets",
        objects: [
          frame("section", { title: "Section" }),
          sticky("note", { parentRef: "section", text: "A story" }),
          {
            tempId: "head",
            type: "text",
            x: 1000,
            y: 0,
            width: 200,
            height: 60,
            text: "Heading",
            style: { fontSize: 32, textAlign: "center" },
          },
        ],
      },
    ]);

    expect(plan.counts).toEqual({
      objects: 3,
      connectors: 0,
      placements: 0,
      actions: 3,
      byType: { frame: 1, sticky_note: 1, text: 1 },
    });
    expect(plan.objects.find((object) => object.tempId === "note").parentRef).toBe("section");
    expect(plan.warnings).toEqual([]);
  });

  it("accepts a parent that already exists on the board", () => {
    const plan = planFromOperations(
      [{ op: "create_widgets", objects: [sticky("note", { parentRef: "board_frame" })] }],
      { existingWidgets: [{ id: "board_frame", type: "frame" }] },
    );
    expect(plan.objects[0].parentRef).toBe("board_frame");
  });

  it("refuses a parent that is locked", () => {
    expect(
      codeOf(() =>
        planFromOperations(
          [{ op: "create_widgets", objects: [sticky("note", { parentRef: "board_frame" })] }],
          { existingWidgets: [{ id: "board_frame", type: "frame", locked: true }] },
        ),
      ),
    ).toBe("PARENT_LOCKED");
  });

  it("refuses a missing or non-frame parent, and a cycle", () => {
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { parentRef: "missing" })] },
        ]),
      ),
    ).toBe("PARENT_NOT_FOUND");
    expect(
      codeOf(() =>
        planFromOperations([
          {
            op: "create_widgets",
            objects: [sticky("parent"), sticky("note", { parentRef: "parent" })],
          },
        ]),
      ),
    ).toBe("PARENT_NOT_FRAME");
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { parentRef: "note" })] },
        ]),
      ),
    ).toBe("PARENT_CYCLE");
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [frame("outer", { parentRef: "inner" })] },
        ]),
      ),
    ).toBe("PARENT_NOT_ALLOWED");
  });

  it("refuses duplicate and already-taken tempIds", () => {
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_widgets", objects: [sticky("a"), sticky("a")] }]),
      ),
    ).toBe("DUPLICATE_TEMP_ID");
    expect(
      codeOf(() =>
        planFromOperations(
          [{ op: "create_widgets", objects: [sticky("board_note")] }],
          { existingWidgets: [{ id: "board_note", type: "sticky_note" }] },
        ),
      ),
    ).toBe("TEMP_ID_TAKEN");
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_widgets", objects: [sticky("1bad")] }]),
      ),
    ).toBe("BAD_TEMP_ID");
  });

  it("refuses unknown kinds and unknown fields", () => {
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("card", { type: "card" })] },
        ]),
      ),
    ).toBe("BAD_TYPE");
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { opacity: 0.5 })] },
        ]),
      ),
    ).toBe("BAD_WIDGET");
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { style: { shadow: "yes" } })] },
        ]),
      ),
    ).toBe("BAD_STYLE");
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { style: { fillColor: "yellow" } })] },
        ]),
      ),
    ).toBe(null);
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_widgets", objects: [frame("f", { text: "no" })] }]),
      ),
    ).toBe("BAD_WIDGET");
  });

  it("refuses bad coordinates and a box below the kind's floor", () => {
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { x: PLAN_LIMITS.coordinate + 1 })] },
        ]),
      ),
    ).toBe("BAD_COORDINATES");
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("note", { width: 2 })] },
        ]),
      ),
    ).toBe("BAD_SIZE");
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_widgets", objects: [frame("f", { width: 100 })] }]),
      ),
    ).toBe("BAD_SIZE");
  });

  it("enforces the operation and object ceilings", () => {
    expect(codeOf(() => planFromOperations([]))).toBe("BAD_OPERATIONS");
    expect(
      codeOf(() =>
        planFromOperations(
          Array.from({ length: PLAN_LIMITS.operations + 1 }, () => ({
            op: "create_widgets",
            objects: [sticky("note")],
          })),
        ),
      ),
    ).toBe("BAD_OPERATIONS");
    const many = Array.from({ length: PLAN_LIMITS.objects + 1 }, (_, index) =>
      sticky(`note_${index}`, { x: (index % 30) * 200, y: Math.floor(index / 30) * 220 }),
    );
    expect(
      codeOf(() => planFromOperations([{ op: "create_widgets", objects: many }])),
    ).toBe("PLAN_TOO_LARGE");
  });

  it("refuses an unknown operation", () => {
    expect(codeOf(() => planFromOperations([{ op: "delete_widgets" }]))).toBe("BAD_OPERATION");
  });
});

describe("create_connector (ADR-142)", () => {
  it("joins two planned objects and assigns a tempId", () => {
    const plan = planFromOperations([
      { op: "create_widgets", objects: [sticky("a"), sticky("b", { x: 300 })] },
      { op: "create_connector", from: "a", to: "b" },
    ]);

    expect(plan.connectors).toHaveLength(1);
    expect(plan.connectors[0]).toMatchObject({ from: "a", to: "b", tempId: "tmp_conn_1" });
    expect(plan.counts.actions).toBe(3);
  });

  it("joins existing objects without creating widgets", () => {
    const plan = planFromOperations(
      [{ op: "create_connector", from: "a", to: "b", routing: "straight" }],
      {
        existingWidgets: [
          { id: "a", type: "shape" },
          { id: "b", type: "text" },
        ],
      },
    );
    expect(plan.counts.objects).toBe(0);
    expect(plan.counts.connectors).toBe(1);
    expect(plan.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("refuses a self-loop", () => {
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("a")] },
          { op: "create_connector", from: "a", to: "a" },
        ]),
      ),
    ).toBe("connector_self_loop");
  });

  it("refuses a duplicate pair, in either direction", () => {
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [sticky("a"), sticky("b")] },
          { op: "create_connector", from: "a", to: "b" },
          { op: "create_connector", from: "b", to: "a" },
        ]),
      ),
    ).toBe("CONNECTOR_EXISTS");
  });

  it("refuses a duplicate of a board connector", () => {
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_connector", from: "a", to: "b" }], {
          existingWidgets: [
            { id: "a", type: "sticky_note" },
            { id: "b", type: "sticky_note" },
          ],
          existingConnectors: [{ from: "b", to: "a" }],
        }),
      ),
    ).toBe("CONNECTOR_EXISTS");
  });

  it("refuses a frame, a missing object and a locked endpoint", () => {
    expect(
      codeOf(() =>
        planFromOperations([
          { op: "create_widgets", objects: [frame("section"), sticky("a")] },
          { op: "create_connector", from: "a", to: "section" },
        ]),
      ),
    ).toBe("CONNECTOR_TARGET_INVALID");
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_connector", from: "a", to: "missing" }], {
          existingWidgets: [{ id: "a", type: "sticky_note" }],
        }),
      ),
    ).toBe("CONNECTOR_TARGET_MISSING");
    expect(
      codeOf(() =>
        planFromOperations([{ op: "create_connector", from: "a", to: "b" }], {
          existingWidgets: [
            { id: "a", type: "sticky_note" },
            { id: "b", type: "sticky_note", locked: true },
          ],
        }),
      ),
    ).toBe("CONNECTOR_TARGET_LOCKED");
  });
});

describe("validatePlan — the client's half of the contract (ADR-142)", () => {
  it("recomputes counts and bounds instead of trusting them", () => {
    const plan = planFromOperations([
      { op: "create_widgets", objects: [sticky("a"), sticky("b", { x: 200 })] },
    ]);
    const checked = validatePlan({
      ...plan,
      counts: { objects: 999, connectors: 999, actions: 999, byType: {} },
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    });

    expect(checked.counts.objects).toBe(2);
    expect(checked.bounds.width).toBeCloseTo(200 + 161.2, 6);
  });

  it("accepts refs it cannot resolve, for the apply preflight to check", () => {
    const checked = validatePlan(
      draft({
        objects: [sticky("note", { parentRef: "board_frame" })],
        connectors: [{ from: "note", to: "board_object" }],
      }),
    );
    expect(checked.objects[0].parentRef).toBe("board_frame");
    expect(checked.connectors[0].to).toBe("board_object");
  });

  it("refuses an empty plan and a self-loop", () => {
    expect(codeOf(() => validatePlan(draft()))).toBe("EMPTY_PLAN");
    expect(
      codeOf(() =>
        validatePlan(
          draft({
            objects: [sticky("a")],
            connectors: [{ from: "a", to: "a" }],
          }),
        ),
      ),
    ).toBe("connector_self_loop");
  });
});

describe("dry run (ADR-142)", () => {
  it("reports counts and bounds", () => {
    const plan = planFromOperations([
      {
        op: "create_widgets",
        objects: [
          sticky("a", { x: 0, y: 0 }),
          sticky("b", { x: 300, y: 0 }),
        ],
      },
    ]);
    const estimate = estimatePlan(plan);

    expect(estimate).toMatchObject({
      objects: 2,
      connectors: 0,
      actions: 2,
      height: 184.7,
    });
    expect(estimate.width).toBeCloseTo(300 + 161.2, 6);
    expect(estimate.bounds.x).toBeCloseTo(-161.2 / 2, 6);
    expect(estimate.bounds.y).toBeCloseTo(-184.7 / 2, 6);
  });

  it("warns about overlaps but does not refuse them", () => {
    const plan = planFromOperations([
      { op: "create_widgets", objects: [sticky("a"), sticky("b")] },
    ]);
    const overlap = plan.warnings.find((warning) => warning.code === "OVERLAP");

    expect(overlap).toBeTruthy();
    expect(overlap.tempIds.sort()).toEqual(["a", "b"]);
    expect(plan.counts.objects).toBe(2);
  });

  it("does not treat a frame and its child as an overlap", () => {
    const plan = planFromOperations([
      {
        op: "create_widgets",
        objects: [frame("section"), sticky("note", { parentRef: "section" })],
      },
    ]);
    expect(plan.warnings.some((warning) => warning.code === "OVERLAP")).toBe(false);
  });

  it("warns when a plan is close to the ceiling", () => {
    const objects = Array.from({ length: PLAN_LIMITS.warnObjects + 1 }, (_, index) =>
      sticky(`note_${index}`, { x: (index % 20) * 220, y: Math.floor(index / 20) * 240 }),
    );
    const plan = planFromOperations([{ op: "create_widgets", objects }]);

    expect(plan.warnings.some((warning) => warning.code === "PLAN_LARGE")).toBe(true);
  });

  it("does not repeat a warning it received with the plan", () => {
    const plan = planFromOperations([
      { op: "create_widgets", objects: [sticky("a"), sticky("b")] },
    ]);
    // A stored plan already carries the warnings of the pass that produced it; the
    // dry run is called again on apply. One finding must stay one row (ADR-142, M3).
    const once = estimatePlan(plan).warnings;
    const twice = estimatePlan({ ...plan, warnings: once }).warnings;

    expect(twice).toEqual(once);
    expect(twice.filter((warning) => warning.code === "OVERLAP")).toHaveLength(1);

    // The pair is unordered: the same two objects in the other order are the same finding.
    const reversed = once.map((warning) =>
      warning.code === "OVERLAP"
        ? { ...warning, tempIds: [...(warning.tempIds ?? [])].reverse() }
        : warning,
    );
    const again = estimatePlan({ ...plan, warnings: reversed }).warnings;
    expect(again.filter((warning) => warning.code === "OVERLAP")).toHaveLength(1);
  });

  it("keeps a warning code that differs by object or column", () => {
    const object = (tempId) => ({
      tempId,
      type: "sticky_note",
      x: 1_000_000,
      y: 0,
      width: 200,
      height: 120,
    });
    const estimate = estimatePlan({
      objects: [object("far_a"), object("far_b")],
      connectors: [],
      warnings: [
        { code: "PLAN_OUT_OF_BOUNDS", message: "one", tempId: "far_a" },
        { code: "PLAN_OUT_OF_BOUNDS", message: "one again", tempId: "far_a" },
        { code: "EMPTY_COLUMN", message: "first", column: "Browse" },
        { code: "EMPTY_COLUMN", message: "first again", column: "Browse" },
        { code: "EMPTY_COLUMN", message: "second", column: "Pay" },
      ],
    });

    const rows = estimate.warnings.filter((warning) => warning.code === "PLAN_OUT_OF_BOUNDS");
    expect(rows.map((warning) => warning.tempId)).toEqual(["far_a", "far_b"]);
    expect(
      estimate.warnings.filter((warning) => warning.code === "EMPTY_COLUMN"),
    ).toHaveLength(2);
  });

  it("is read-only: the input plan is not mutated", () => {
    const plan = planFromOperations([
      { op: "create_widgets", objects: [sticky("a"), sticky("b", { x: 400 })] },
    ]);
    const before = JSON.stringify(plan);
    estimatePlan(plan);
    expect(JSON.stringify(plan)).toBe(before);
  });
});

describe("place_widgets (ADR-143)", () => {
  const existingWidgets = [
    { id: "a", type: "sticky_note", x: 0, y: 0, width: 160, height: 180 },
    { id: "b", type: "sticky_note", x: 400, y: 0, width: 160, height: 180 },
    { id: "locked", type: "sticky_note", x: 0, y: 400, width: 160, height: 180, locked: true },
    { id: "frame", type: "frame", x: 0, y: 900, width: 600, height: 400 },
    { id: "line", type: "connector", x: 0, y: 0, width: 0, height: 0 },
  ];

  it("normalizes existing objects and counts them as actions", () => {
    const plan = planFromOperations(
      [
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
          ],
        },
      ],
      { existingWidgets },
    );
    expect(plan.counts).toMatchObject({ objects: 1, placements: 2, actions: 3 });
    expect(plan.placements).toHaveLength(2);
  });

  it("refuses an object outside the tidy selection", () => {
    expect(() =>
      planFromOperations(
        [{ op: "place_widgets", items: [{ id: "b", x: 0, y: 0 }] }],
        { existingWidgets, allowedIds: ["a"] },
      ),
    ).toThrow(/not in the selection/);
  });

  it("refuses a duplicate destination, a frame, a line and a missing object", () => {
    const attempt = (items) =>
      planFromOperations([{ op: "place_widgets", items }], { existingWidgets });
    expect(() =>
      attempt([
        { id: "a", x: 0, y: 0 },
        { id: "a", x: 10, y: 10 },
      ]),
    ).toThrow(/placed twice/);
    expect(() => attempt([{ id: "frame", x: 0, y: 0 }])).toThrow(/is a frame/);
    expect(() => attempt([{ id: "line", x: 0, y: 0 }])).toThrow(/is a connector/);
    expect(() => attempt([{ id: "missing", x: 0, y: 0 }])).toThrow(/does not exist/);
    expect(() => attempt([{ id: "a", x: 1_000_001, y: 0 }])).toThrow(/out of bounds/);
  });

  it("skips a locked target and reports it", () => {
    const plan = planFromOperations(
      [{ op: "place_widgets", items: [{ id: "locked", x: 0, y: 0 }] }],
      { existingWidgets },
    );
    expect(plan.placements).toHaveLength(0);
    expect(plan.warnings.some((warning) => warning.code === "TIDY_LOCKED_SKIPPED")).toBe(true);
  });

  it("keeps an unknown id when the client has no board facts, so apply can preflight it", () => {
    const plan = validatePlan({
      version: 1,
      template: null,
      origin: { x: 0, y: 0 },
      objects: [],
      connectors: [],
      placements: [{ id: "a", x: 0, y: 0 }],
      warnings: [],
    });
    expect(plan.placements).toHaveLength(1);
  });
});
