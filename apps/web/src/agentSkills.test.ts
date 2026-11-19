import { describe, expect, it } from "vitest";
import { AUTO_SKILL, compatibleSkills } from "./agentSkills";

const skills = [
  { id: "1", slug: "brief-to-board", name: "Brief" },
  { id: "2", slug: "diagram", name: "Diagram" },
  { id: "3", slug: "cards", name: "Cards" },
  { id: "4", slug: "tidy-selection", name: "Tidy" },
];

describe("skill selector compatibility (ADR-143)", () => {
  it("hides skills that need a selection when nothing is selected", () => {
    expect(compatibleSkills(skills, { hasSelection: false }).map((skill) => skill.slug)).toEqual([
      "brief-to-board",
      "diagram",
    ]);
  });

  it("offers every skill when the selection is the source", () => {
    expect(compatibleSkills(skills, { hasSelection: true })).toHaveLength(4);
  });

  it("reserves the empty value for Auto, which the server resolves", () => {
    expect(AUTO_SKILL).toBe("");
  });
});
