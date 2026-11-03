import { describe, expect, it } from "vitest";
import { createRecorder, METRIC_CATALOG, METRIC_NAMES, metricEvent } from "@remo/metrics";

describe("product metrics (ADR-082)", () => {
  it("keeps the name list and the catalog in sync", () => {
    expect([...METRIC_NAMES].sort()).toEqual(Object.keys(METRIC_CATALOG).sort());
  });

  it("builds a content-free envelope", () => {
    const event = metricEvent({
      name: "board.created",
      orgId: "org-1",
      actorId: "user-1",
      boardId: "board-1",
      props: { teamId: "team-1" },
    });
    expect(event).toMatchObject({
      name: "board.created",
      org_id: "org-1",
      actor_id: "user-1",
      actor_type: "user",
      board_id: "board-1",
      schema_version: 1,
    });
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is a no-op without a sink and never throws", () => {
    const recorder = createRecorder();
    expect(recorder.enabled).toBe(false);
    expect(() => recorder.emit(metricEvent({ name: "board.saved", orgId: "o", props: { objectCount: 0 } }))).not.toThrow();
  });

  it("delivers to an enabled sink only", () => {
    const events = [];
    const recorder = createRecorder({ enabled: true, sink: (event) => events.push(event) });
    recorder.emit(metricEvent({ name: "help.opened", orgId: "org" }));
    expect(events).toHaveLength(1);
  });

  it("rejects unknown event names and missing required props", () => {
    expect(() => metricEvent({ name: "board.opened" })).toThrow(/unknown metric/);
    expect(() => metricEvent({ name: "board.saved", orgId: "o" })).toThrow(/needs prop objectCount/);
    expect(() => metricEvent({ name: "help.search", orgId: "o", props: { query: "secret", lang: "ru", queryLength: 6, resultCount: 0 } })).toThrow(/content or personal data/);
  });
});
