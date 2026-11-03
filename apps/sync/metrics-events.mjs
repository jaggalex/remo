/**
 * Product metrics emitter for the sync service (ADR-082).
 *
 * This is separate from `metrics.mjs`, which is the Prometheus registry. Product
 * metrics go to a separate PostgreSQL database and are never mixed with operational
 * metrics or with the audit log.
 */
import { createRecorder, metricEvent } from "@remo/metrics";

let recorder = createRecorder();
let appVersion = "dev";

export function configureMetrics(sink, { enabled = true, version = "dev" } = {}) {
  appVersion = version;
  recorder = createRecorder({ sink, enabled });
}

export function emitMetric(event) {
  try {
    recorder.emit(metricEvent({ appVersion, ...event }));
  } catch {
    // A malformed metric must never interrupt the operation that produced it.
  }
}

export function productMetricsEnabled() {
  return recorder.enabled;
}
