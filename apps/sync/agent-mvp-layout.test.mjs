import { describe, expect, it } from "vitest";
import { fakeArchitectureReply, fakeCompetitorsReply, fakeIdeasReply, fakeMvpReply, fakePrioritizationReply } from "./ai-fake.mjs";
import { fitDraftFrame } from "./agent-room-draft.mjs";
import { matrixPlan, mvpPlan } from "./agent-mvp-layout.mjs";

const facts = { existingWidgets: [], existingConnectors: [] };

describe("MVP story map (ADR-192)", () => {
  it("lays out columns, rows, cells and the MVP boundary", () => {
    const built = mvpPlan(fakeMvpReply("Request: возврат"), facts);
    const objects = built.plan.objects;
    expect(objects.filter((object) => object.tempId.startsWith("column-"))).toHaveLength(3);
    expect(objects.filter((object) => object.tempId.startsWith("row-"))).toHaveLength(3);
    expect(objects.find((object) => object.tempId === "mvp-boundary")?.text).toContain("граница MVP");
    expect(objects.filter((object) => object.tempId.startsWith("item-mvp-"))).toHaveLength(3);
    expect(built.plan.connectors).toEqual([]);
  });

  it("keeps every object inside the frame after the fit", () => {
    const built = mvpPlan(fakeMvpReply("Request: возврат"), facts);
    fitDraftFrame(built.plan);
    const frame = built.plan.objects.find((object) => object.type === "frame");
    for (const child of built.plan.objects.filter((object) => object !== frame)) {
      expect(child.x - child.width / 2).toBeGreaterThanOrEqual(frame.x - frame.width / 2);
      expect(child.y - child.height / 2).toBeGreaterThanOrEqual(frame.y - frame.height / 2);
      expect(child.x + child.width / 2).toBeLessThanOrEqual(frame.x + frame.width / 2);
      expect(child.y + child.height / 2).toBeLessThanOrEqual(frame.y + frame.height / 2);
    }
  });

  it("refuses a cell outside the declared grid", () => {
    const raw = fakeMvpReply("Request: возврат");
    raw.cells = [{ row: "mvp", column: "unknown", items: [] }];
    expect(() => mvpPlan(raw, facts)).toThrow(/existing row and column/);
  });
});

const matrixCases = [
  ["prioritization", fakePrioritizationReply, "Эффект"],
  ["competitors", fakeCompetitorsReply, "Продукт A"],
  ["architecture-decision", fakeArchitectureReply, "Стоимость"],
  ["idea-generation", fakeIdeasReply, "Самообслуживание"],
];

describe("comparison matrices (ADR-192)", () => {
  for (const [name, fixture, firstLabel] of matrixCases) {
    it(`lays out ${name} inside its frame`, () => {
      const built = matrixPlan(fixture("Request: итоги"), { ...facts, cellType: "text", cellHeight: 76 });
      const labels = built.plan.objects
        .filter((object) => object.type === "text")
        .map((object) => object.text);
      expect(labels).toContain(firstLabel);
      fitDraftFrame(built.plan);
      const frame = built.plan.objects.find((object) => object.type === "frame");
      for (const child of built.plan.objects.filter((object) => object !== frame)) {
        expect(child.x - child.width / 2).toBeGreaterThanOrEqual(frame.x - frame.width / 2);
        expect(child.y - child.height / 2).toBeGreaterThanOrEqual(frame.y - frame.height / 2);
        expect(child.x + child.width / 2).toBeLessThanOrEqual(frame.x + frame.width / 2);
        expect(child.y + child.height / 2).toBeLessThanOrEqual(frame.y + frame.height / 2);
      }
    });
  }
});
