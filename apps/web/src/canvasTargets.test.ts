import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { contextTargetAt } from "./canvasTargets";

/**
 * What a right-click acts on.
 *
 * The rule used to be three branches inside `BoardCanvas`: the topmost object, otherwise
 * a kanban band, otherwise the board. It never looked at the selection, so right-clicking
 * one of five selected notes offered the menu for that note alone — while the keys and
 * the panel acted on all five (ADR-058).
 */

const note = (id: string, x: number, y: number, extra: Partial<Widget> = {}): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width: 100,
  height: 100,
  ...extra,
});

const args = (widgets: Widget[], selectedIds: string[], point: { x: number; y: number }) => ({
  world: point,
  widgets,
  layouts: new Map(),
  selectedIds,
  isCardOfKanban: () => false,
  resolve: (id: string) => widgets.find((widget) => widget.id === id),
  connector: { tolerance: 8 },
});

describe("a right-click", () => {
  it("keeps a multi-selection when the click is inside it", () => {
    const widgets = [note("a", 0, 0), note("b", 220, 0), note("c", 440, 0)];
    const target = contextTargetAt(args(widgets, ["a", "b", "c"], { x: 220, y: 0 }));
    expect(target).toEqual({ kind: "selection", ids: ["a", "b", "c"] });
  });

  it("acts on the clicked object when it is outside the selection", () => {
    const widgets = [note("a", 0, 0), note("b", 220, 0)];
    const target = contextTargetAt(args(widgets, ["a"], { x: 220, y: 0 }));
    expect(target).toEqual({ kind: "selection", ids: ["b"] });
  });

  it("keeps the selection when a member of a selected group is clicked", () => {
    const widgets = [
      note("a", 0, 0, { groupId: "g" }),
      note("b", 220, 0, { groupId: "g" }),
      note("c", 440, 0),
    ];
    const target = contextTargetAt(args(widgets, ["a", "b", "c"], { x: 220, y: 0 }));
    expect(target).toEqual({ kind: "selection", ids: ["a", "b", "c"] });
  });

  it("expands to the group when the group is not selected", () => {
    const widgets = [note("a", 0, 0, { groupId: "g" }), note("b", 220, 0, { groupId: "g" })];
    const target = contextTargetAt(args(widgets, [], { x: 0, y: 0 }));
    expect(target).toEqual({ kind: "selection", ids: ["a", "b"] });
  });

  it("falls back to the current selection on empty canvas", () => {
    const widgets = [note("a", 0, 0)];
    const target = contextTargetAt(args(widgets, ["a"], { x: 900, y: 900 }));
    expect(target).toEqual({ kind: "selection", ids: ["a"] });
  });

  it("keeps a multi-selection when one of its connectors is clicked", () => {
    const widgets = [
      note("a", 0, 0),
      note("b", 220, 0),
      {
        id: "line",
        type: "connector" as const,
        parentId: null,
        x: 110,
        y: 0,
        width: 220,
        height: 0,
        start: { item: "a", side: "right" as const },
        end: { item: "b", side: "left" as const },
        connectorShape: "straight" as const,
      },
    ];
    const target = contextTargetAt(args(widgets, ["a", "b", "line"], { x: 110, y: 0 }));
    expect(target).toEqual({ kind: "selection", ids: ["a", "b", "line"] });
  });
});
