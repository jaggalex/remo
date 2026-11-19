import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { validateAgentPlan } from "./agent-plan.mjs";

/**
 * The server half: board facts are added to the shared contract, and the dry run
 * returns counts and bounds without writing anything (ADR-142).
 */

function documentWith(widgets = []) {
  const doc = new Y.Doc();
  const map = doc.getMap("widgets");
  for (const widget of widgets) map.set(widget.id, widget);
  return doc;
}

function sticky(id, extra = {}) {
  return {
    id,
    type: "sticky_note",
    parentId: null,
    x: 0,
    y: 0,
    width: 161.2,
    height: 184.7,
    ...extra,
  };
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code ?? `unexpected:${error.message}`;
  }
}

describe("validateAgentPlan (ADR-142)", () => {
  it("validates a structure against a document and returns the dry run", () => {
    const ydoc = documentWith();
    const { plan, estimate } = validateAgentPlan({
      ydoc,
      operations: [
        {
          op: "create_structure",
          template: "user-story-map",
          columns: [
            { title: "Activity", stories: ["One", "Two"] },
            { title: "Another", stories: [] },
          ],
        },
      ],
      origin: { x: 0, y: 0 },
    });

    expect(plan.counts.objects).toBe(2 + 2 + 2);
    expect(estimate.actions).toBe(6);
    expect(estimate.width).toBeGreaterThan(0);
    expect(estimate.warnings.map((warning) => warning.code)).toContain("EMPTY_COLUMN");
    // Nothing was written: the document stayed empty.
    expect(ydoc.getMap("widgets").size).toBe(0);
  });

  it("accepts an existing frame as a parent and a locked frame is refused", () => {
    const frame = {
      id: "board_frame",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    };
    const operations = [
      {
        op: "create_widgets",
        objects: [
          {
            tempId: "note",
            type: "sticky_note",
            x: 0,
            y: 0,
            width: 161.2,
            height: 184.7,
            parentRef: "board_frame",
            text: "A story",
          },
        ],
      },
    ];

    expect(() => validateAgentPlan({ ydoc: documentWith([frame]), operations })).not.toThrow();
    expect(
      codeOf(() =>
        validateAgentPlan({ ydoc: documentWith([{ ...frame, locked: true }]), operations }),
      ),
    ).toBe("PARENT_LOCKED");
  });

  it("sees an existing connector and refuses a duplicate", () => {
    const ydoc = documentWith([
      sticky("a"),
      sticky("b", { x: 300 }),
      {
        id: "conn",
        type: "connector",
        parentId: null,
        x: 150,
        y: 0,
        width: 300,
        height: 0,
        start: { item: "b" },
        end: { item: "a" },
      },
    ]);
    expect(
      codeOf(() =>
        validateAgentPlan({
          ydoc,
          operations: [{ op: "create_connector", from: "a", to: "b" }],
        }),
      ),
    ).toBe("CONNECTOR_EXISTS");
  });

  it("refuses a plan above the task's action budget", () => {
    const ydoc = documentWith();
    const operations = [
      {
        op: "create_widgets",
        objects: [1, 2, 3].map((index) => ({
          tempId: `note_${index}`,
          type: "sticky_note",
          x: index * 220,
          y: 0,
          width: 161.2,
          height: 184.7,
        })),
      },
    ];
    expect(codeOf(() => validateAgentPlan({ ydoc, operations, maxActions: 2 }))).toBe(
      "BUDGET_ACTIONS",
    );
    expect(() => validateAgentPlan({ ydoc, operations, maxActions: 3 })).not.toThrow();
  });

  it("returns each warning once, though the plan already carries it", () => {
    const objects = [1, 2].map((index) => ({
      tempId: `far_${index}`,
      type: "sticky_note",
      x: 1_000_000,
      y: 0,
      width: 200,
      height: 120,
    }));
    const { plan, estimate } = validateAgentPlan({
      ydoc: documentWith(),
      operations: [{ op: "create_widgets", objects }],
    });

    // The plan is estimated when it is built and once more here; the person sees two
    // objects, so two rows — not four (ADR-142, M3).
    expect(plan.warnings.filter((warning) => warning.code === "PLAN_OUT_OF_BOUNDS")).toHaveLength(2);
    expect(estimate.warnings.filter((warning) => warning.code === "PLAN_OUT_OF_BOUNDS")).toHaveLength(2);
  });

  it("refuses to run without a document", () => {
    expect(codeOf(() => validateAgentPlan({ operations: [] }))).toBe("NO_DOCUMENT");
  });
});

describe("create-only skills (ADR-143)", () => {
  it("refuses place_widgets in a brief plan", () => {
    const ydoc = documentWith([sticky("a"), sticky("b")]);
    expect(
      codeOf(() =>
        validateAgentPlan({
          ydoc,
          operations: [
            { op: "place_widgets", items: [{ id: "a", x: 0, y: 0 }] },
          ],
          allowPlacements: false,
        }),
      ),
    ).toBe("OPERATION_NOT_ALLOWED");
  });

  it("still allows a tidy plan to move selected objects", () => {
    const ydoc = documentWith([sticky("a")]);
    const { plan } = validateAgentPlan({
      ydoc,
      operations: [{ op: "place_widgets", items: [{ id: "a", x: 100, y: 100 }] }],
      allowedIds: ["a"],
    });
    expect(plan.counts.placements).toBe(1);
  });
});
