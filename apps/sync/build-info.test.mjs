import { describe, expect, it } from "vitest";
import { buildInfo } from "./build-info.mjs";

describe("build identity (ADR-179)", () => {
  it("reports the environment Docker passes", () => {
    expect(buildInfo({ REMO_VERSION: "0.2.0", REMO_BUILD: "1247", REMO_COMMIT: "a1b2c3d" })).toEqual(
      { version: "0.2.0", build: "1247", commit: "a1b2c3d", schema: 18 },
    );
  });

  it("has a safe source-checkout default", () => {
    expect(buildInfo({})).toEqual({
      version: "0.0.0-dev",
      build: "dev",
      commit: "dev",
      schema: 18,
    });
  });
});
