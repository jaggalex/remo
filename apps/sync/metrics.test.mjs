/**
 * Metrics registry tests.
 *
 * Pure functions, so they need no service and no database — which is exactly why
 * the registry has no dependency: the thing that reports on the service must be the
 * last thing that can fail.
 */
import { describe, expect, it } from "vitest";
import { METRICS_CONTENT_TYPE, Metrics, processMetrics } from "./metrics.mjs";

describe("metrics registry", () => {
  it("accumulates counters and keeps label sets apart", () => {
    const metrics = new Metrics();
    metrics.inc("remo_events_total");
    metrics.inc("remo_events_total");
    metrics.inc("remo_events_total", { kind: "a" });
    metrics.inc("remo_events_total", { kind: "b" }, 3);

    const text = metrics.render();
    expect(text).toContain("remo_events_total 2");
    expect(text).toContain('remo_events_total{kind="a"} 1');
    expect(text).toContain('remo_events_total{kind="b"} 3');
    expect(text).toContain("# TYPE remo_events_total counter");
  });

  it("replaces gauges instead of accumulating them", () => {
    const metrics = new Metrics();
    metrics.set("remo_rooms_active", 3);
    metrics.set("remo_rooms_active", 1);
    const text = metrics.render();
    expect(text).toContain("remo_rooms_active 1");
    expect(text).toContain("# TYPE remo_rooms_active gauge");
    expect(text).not.toContain("remo_rooms_active 3");
  });

  it("escapes label values so a room name cannot break the format", () => {
    const metrics = new Metrics();
    metrics.inc("remo_http_requests_total", { path: '/boards/a"b\\c' });
    expect(metrics.render()).toContain('path="/boards/a\\"b\\\\c"');
  });

  it("describes a family once", () => {
    const metrics = new Metrics();
    metrics.describe("remo_ws_connections_total", "WebSocket connections accepted");
    metrics.inc("remo_ws_connections_total");
    const lines = metrics.render().split("\n");
    expect(lines.filter((line) => line.startsWith("# HELP remo_ws_connections_total"))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("# TYPE remo_ws_connections_total"))).toHaveLength(1);
  });

  it("reports process facts that are always available", () => {
    const text = processMetrics(Date.now() - 2000);
    expect(text).toContain("remo_process_uptime_seconds");
    expect(text).toContain("remo_process_resident_memory_bytes");
    expect(text).toContain("remo_process_nodejs_eventloop_lag_seconds");
    expect(METRICS_CONTENT_TYPE).toContain("text/plain");
  });
});
