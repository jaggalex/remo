import { describe, expect, it } from "vitest";
import { formatMoney, planLimitFrom } from "./apiBilling";
import { ApiError } from "./apiCall";

describe("plan limit refusals", () => {
  it("reads the limit body of a 402", () => {
    const notice = planLimitFrom(
      new ApiError(402, "PLAN_LIMIT", "the free plan allows 5 active rooms", {
        error: "PLAN_LIMIT",
        limit: "rooms",
        current: 5,
        max: 5,
        plan: "free",
      }),
    );
    expect(notice).toEqual({ kind: "limit", limit: "rooms", current: 5, max: 5, plan: "free" });
  });

  it("reads the feature body of a 402", () => {
    const notice = planLimitFrom(
      new ApiError(402, "PLAN_FEATURE", "pdf export needs a paid plan", {
        error: "PLAN_FEATURE",
        feature: "export.pdf",
        plan: "free",
      }),
    );
    expect(notice).toEqual({ kind: "feature", feature: "export.pdf", plan: "free" });
  });

  it("leaves every ordinary failure alone", () => {
    expect(planLimitFrom(new ApiError(403, "FORBIDDEN", "no"))).toBeNull();
    expect(planLimitFrom(new ApiError(500, "PLAN_LIMIT", "boom"))).toBeNull();
    expect(planLimitFrom(new TypeError("Failed to fetch"))).toBeNull();
  });
});

describe("money", () => {
  it("reads minor units with the currency's own number of digits", () => {
    expect(formatMoney(29000, "USD", "en")).toContain("290.00");
    expect(formatMoney(500, "JPY", "en")).toContain("500");
  });
});
