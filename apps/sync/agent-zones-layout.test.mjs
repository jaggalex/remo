import { describe, expect, it } from "vitest";
import { PlanError } from "@remo/agent-plan";
import { fakeRequirementsReply } from "./ai-fake.mjs";
import { fitDraftFrame } from "./agent-room-draft.mjs";
import { requirementsPlan } from "./agent-zones-layout.mjs";

const facts = { existingWidgets: [], existingConnectors: [] };

describe("requirements discovery (ADR-192)", () => {
  it("lays out the six zones and their items", () => {
    const built = requirementsPlan(fakeRequirementsReply("Request: возврат"), facts);
    const headers = built.plan.objects.filter((object) => object.tempId.startsWith("zone-"));
    expect(headers.map((header) => header.tempId)).toEqual([
      "zone-context",
      "zone-actors",
      "zone-scenarios",
      "zone-data",
      "zone-constraints",
      "zone-questions",
    ]);
    expect(built.plan.counts.objects).toBeGreaterThan(20);
    expect(built.plan.connectors).toEqual([]);
  });

  it("keeps every object inside the frame after the fit", () => {
    const built = requirementsPlan(fakeRequirementsReply("Request: возврат"), facts);
    fitDraftFrame(built.plan);
    const frame = built.plan.objects.find((object) => object.type === "frame");
    const children = built.plan.objects.filter((object) => object !== frame);
    for (const child of children) {
      expect(child.x - child.width / 2).toBeGreaterThanOrEqual(frame.x - frame.width / 2);
      expect(child.y - child.height / 2).toBeGreaterThanOrEqual(frame.y - frame.height / 2);
      expect(child.x + child.width / 2).toBeLessThanOrEqual(frame.x + frame.width / 2);
      expect(child.y + child.height / 2).toBeLessThanOrEqual(frame.y + frame.height / 2);
    }
  });

  it("cites only selected sources", () => {
    const raw = fakeRequirementsReply("Request: возврат");
    const built = requirementsPlan(raw, { ...facts, sourceIds: [] });
    expect(built.citations).toEqual([]);
  });

  it("refuses an unknown zone", () => {
    const raw = fakeRequirementsReply("Request: возврат");
    raw.zones = [...raw.zones, { key: "someday", label: "", items: [] }];
    expect(() => requirementsPlan(raw, facts)).toThrow(PlanError);
  });
});
