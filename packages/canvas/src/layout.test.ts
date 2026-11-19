import { describe, expect, it } from "vitest";
import { emptyKanbanState, type Widget } from "@remo/model";
import { layoutKanban } from "./layout";

const kanban: Widget = {
  id: "k",
  type: "kanban",
  parentId: null,
  x: 0,
  y: 0,
  width: 600,
  height: 400,
};

describe("kanban layout", () => {
  it("carries a column's WIP limit into the band", () => {
    const state = emptyKanbanState({
      columns: [{ id: "c", title: "Doing", accent: "#000", width: 300, wipLimit: 2 }],
      swimlanes: [{ id: "l", title: "Team" }],
    });
    const layout = layoutKanban(kanban, [], state);
    expect(layout.columns[0]!.wipLimit).toBe(2);
  });
});
