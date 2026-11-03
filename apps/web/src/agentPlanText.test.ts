import { describe, expect, it } from "vitest";
import type { PlanWarning } from "@remo/doc";
import { isCriticalWarning, uniqueWarnings } from "./agentPlanText";

/**
 * A warning is either a question or a stop; the preview must not leave that to a
 * string comparison at the call site (ADR-142, M3).
 */
describe("agent plan warnings", () => {
  const warning = (code: string, extra: Partial<PlanWarning> = {}): PlanWarning => ({
    code,
    message: code,
    ...extra,
  });

  it("blocks only on a box outside the allowed coordinates", () => {
    expect(isCriticalWarning(warning("PLAN_OUT_OF_BOUNDS", { tempId: "n" }))).toBe(true);
    // A plan over the ceiling is refused before it is stored, so this code never
    // reaches the preview; treating it as critical would wait for a finding that
    // cannot arrive.
    expect(isCriticalWarning(warning("PLAN_TOO_LARGE"))).toBe(false);
    expect(isCriticalWarning(warning("OVERLAP"))).toBe(false);
    expect(isCriticalWarning(warning("PLAN_LARGE"))).toBe(false);
    expect(isCriticalWarning(warning("STORIES_EXCEED_LANES"))).toBe(false);
  });

  it("keeps one row per finding when the dry run repeats a warning", () => {
    const warnings = [
      warning("PLAN_OUT_OF_BOUNDS", { tempId: "far" }),
      warning("PLAN_OUT_OF_BOUNDS", { tempId: "far" }),
      warning("OVERLAP", { tempIds: ["a", "b"] }),
      warning("OVERLAP", { tempIds: ["b", "a"] }),
      warning("PLAN_LARGE"),
    ];
    expect(uniqueWarnings(warnings)).toHaveLength(4);
  });
});
