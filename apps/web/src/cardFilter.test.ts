import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { cardAssignees, cardsMatching } from "./cardFilter";

const card = (id: string, patch: Partial<Widget> = {}): Widget => ({
  id,
  type: "card",
  parentId: "k1",
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  ...patch,
});

describe("card filter", () => {
  it("matches by assignee", () => {
    const widgets = [card("a", { assigneeId: "u1" }), card("b", { assigneeId: "u2" })];
    expect(cardsMatching(widgets, { assigneeId: "u1", due: "any" }).map((w) => w.id)).toEqual(["a"]);
  });

  it("separates overdue from no due date", () => {
    const widgets = [
      card("late", { dueAt: "2026-10-01" }),
      card("future", { dueAt: "2026-12-01" }),
      card("none"),
    ];
    expect(cardsMatching(widgets, { assigneeId: "", due: "overdue" }, "2026-10-29").map((w) => w.id)).toEqual(["late"]);
    expect(cardsMatching(widgets, { assigneeId: "", due: "none" }).map((w) => w.id)).toEqual(["none"]);
  });

  it("lists distinct assignees by name", () => {
    const widgets = [
      card("a", { assigneeId: "u1", assigneeName: "Ann" }),
      card("b", { assigneeId: "u1", assigneeName: "Ann" }),
      card("c", { assigneeId: "u2", assigneeName: "Bob" }),
    ];
    expect(cardAssignees(widgets)).toEqual([
      { id: "u1", name: "Ann" },
      { id: "u2", name: "Bob" },
    ]);
  });

  it("ignores objects that are not cards", () => {
    const widgets: Widget[] = [{ ...card("s"), type: "sticky_note" }];
    expect(cardsMatching(widgets, { assigneeId: "", due: "any" })).toEqual([]);
  });
});
