import { describe, expect, it } from "vitest";
import { canElevate, elevationOf } from "./elevation";

describe("elevation (ADR-245)", () => {
  it("lets only a kanban, a frame and a shape stand off the board", () => {
    expect(["kanban", "frame", "shape"].every((type) => canElevate({ type: type as never }))).toBe(true);
    expect(canElevate({ type: "sticky_note" })).toBe(false);
    expect(canElevate({ type: "card" })).toBe(false);
    expect(canElevate({ type: "connector" })).toBe(false);
  });

  it("reads an absent or foreign level as flat", () => {
    expect(elevationOf({ type: "frame" })).toBeNull();
    expect(elevationOf({ type: "frame", style: { elevation: "raised" } })).toBe("raised");
    expect(elevationOf({ type: "card", style: { elevation: "raised" } })).toBeNull();
    expect(elevationOf({ type: "shape", style: { elevation: "x" as never } })).toBeNull();
  });
});
