import { describe, expect, it } from "vitest";
import {
  FAKE_CONNECTED_MARKER,
  FAKE_OUT_OF_BOUNDS_MARKER,
  fakeModelEnabled,
  fakePlanClient,
  fakePlanReply,
} from "./ai-fake.mjs";

/**
 * The fake plan is a test seam, not a feature: it must be impossible to switch on in a
 * production process, even by setting both variables.
 */
describe("fake plan provider", () => {
  it("needs the explicit flag and an e2e run", () => {
    expect(fakeModelEnabled({ REMO_AI_FAKE: "plan" })).toBe(false);
    expect(fakeModelEnabled({ REMO_E2E_RUN_ID: "1" })).toBe(false);
    expect(fakeModelEnabled({ REMO_AI_FAKE: "plan", REMO_E2E_RUN_ID: "1" })).toBe(true);
  });

  it("is refused in production", () => {
    expect(
      fakeModelEnabled({
        NODE_ENV: "production",
        REMO_AI_FAKE: "plan",
        REMO_E2E_RUN_ID: "1",
      }),
    ).toBe(false);
  });

  it("answers with one story-map operation and no cost", async () => {
    const reply = await fakePlanClient().chatJson({ system: "", user: "" });
    expect(reply.json).toEqual(fakePlanReply());
    expect(reply.json.operations).toHaveLength(1);
    expect(reply.json.operations[0].op).toBe("create_structure");
    expect(reply.usage).toEqual({ promptTokens: 0, completionTokens: 0, costUsd: 0 });
    expect(reply.model).toBe("fake/plan");
  });

  it("switches to a two-object connector fixture when the brief asks for it", async () => {
    const reply = await fakePlanClient().chatJson({
      system: "",
      user: `<task>{"intent":"connect ${FAKE_CONNECTED_MARKER}"}</task>`,
    });
    expect(reply.json.operations.map((operation) => operation.op)).toEqual([
      "create_widgets",
      "create_connector",
    ]);
    expect(reply.json.operations[0].objects).toHaveLength(2);
    expect(reply.json.operations[1]).toMatchObject({
      from: "note_start",
      to: "note_end",
      arrow: "end",
    });
  });

  it("switches to an out-of-bounds fixture when the brief asks for it", async () => {
    const reply = await fakePlanClient().chatJson({
      system: "",
      user: `<task>{"intent":"collect ${FAKE_OUT_OF_BOUNDS_MARKER}"}</task>`,
    });
    expect(reply.json.operations[0].op).toBe("create_widgets");
    const objects = reply.json.operations[0].objects;
    expect(objects).toHaveLength(2);
    // The centre is legal; the right edge is not, which is the warning the UI blocks on.
    expect(objects[1].x).toBe(1_000_000);
    expect(objects[1].x + objects[1].width / 2).toBeGreaterThan(1_000_000);
  });
});
