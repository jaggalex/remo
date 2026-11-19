/**
 * Prometheus metrics for the sync service.
 *
 * Deliberately tiny: a counter and a gauge registry plus one text renderer, in the
 * exposition format Prometheus scrapes. No dependency, because the service is the
 * thing that must stay up when everything else is broken.
 *
 * Naming follows Prometheus conventions — `<namespace>_<thing>_<unit>`, counters end
 * in `_total`, gauges describe a value that goes up and down.
 */

function labelKey(name, labels) {
  const entries = Object.entries(labels ?? {}).filter(([, value]) => value !== undefined);
  if (!entries.length) return name;
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${name}{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export class Metrics {
  constructor() {
    /** Counter values keyed by name and labels; counters only ever increase. */
    this.counters = new Map();
    /** Gauge values keyed by name and labels; set, not accumulated. */
    this.gauges = new Map();
    /** Human-readable help text, one line per metric family. */
    this.help = new Map();
  }

  describe(name, text, type = "counter") {
    this.help.set(name, { text, type });
  }

  /** Add to a counter. `labels` distinguishes series of the same metric. */
  inc(name, labels, value = 1) {
    const key = labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  /** Set a gauge to an absolute value. */
  set(name, value, labels) {
    this.gauges.set(labelKey(name, labels), value);
  }

  /**
   * Render the registry in the Prometheus text exposition format.
   *
   * One `# TYPE` line per metric family, then one sample line per label set.
   */
  render() {
    const lines = [];
    const counters = [...this.counters.entries()];
    const gauges = [...this.gauges.entries()];
    const nameOf = (key) => key.split("{")[0];
    const names = new Set([
      ...counters.map(([key]) => nameOf(key)),
      ...gauges.map(([key]) => nameOf(key)),
    ]);

    for (const name of names) {
      const isCounter = counters.some(([key]) => nameOf(key) === name);
      const meta = this.help.get(name);
      if (meta?.text) lines.push(`# HELP ${name} ${meta.text}`);
      lines.push(`# TYPE ${name} ${meta?.type ?? (isCounter ? "counter" : "gauge")}`);
      for (const [key, value] of counters) {
        if (nameOf(key) === name) lines.push(`${key} ${formatValue(value)}`);
      }
      for (const [key, value] of gauges) {
        if (nameOf(key) === name) lines.push(`${key} ${formatValue(value)}`);
      }
    }

    return lines.join("\n");
  }
}

function formatValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/**
 * Process-level metrics.
 *
 * Rendered on demand rather than registered as gauges: they are read from the
 * runtime at scrape time, so nothing has to keep them fresh.
 */
export function processMetrics(startedAt) {
  const memory = process.memoryUsage();
  const uptime = Math.max(0, (Date.now() - startedAt) / 1000);
  return [
    "# HELP remo_process_uptime_seconds Seconds since the service started",
    "# TYPE remo_process_uptime_seconds gauge",
    `remo_process_uptime_seconds ${uptime.toFixed(3)}`,
    "# HELP remo_process_resident_memory_bytes Resident memory size",
    "# TYPE remo_process_resident_memory_bytes gauge",
    `remo_process_resident_memory_bytes ${memory.rss}`,
    "# HELP remo_process_heap_used_bytes Heap in use",
    "# TYPE remo_process_heap_used_bytes gauge",
    `remo_process_heap_used_bytes ${memory.heapUsed}`,
    "# HELP remo_process_nodejs_eventloop_lag_seconds Event loop lag, measured now",
    "# TYPE remo_process_nodejs_eventloop_lag_seconds gauge",
    `remo_process_nodejs_eventloop_lag_seconds ${eventLoopLagSeconds().toFixed(6)}`,
  ].join("\n");
}

/**
 * Event loop lag.
 *
 * Measured by scheduling a timer for "now" and timing how late it fires — the same
 * trick `prom-client` uses, without the dependency.
 */
let lastLag = 0;
export function eventLoopLagSeconds() {
  return lastLag / 1000;
}

export function watchEventLoop(resolutionMs = 500) {
  let expected = Date.now() + resolutionMs;
  const timer = setInterval(() => {
    const now = Date.now();
    lastLag = Math.max(0, now - expected);
    expected = now + resolutionMs;
  }, resolutionMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Prometheus exposition content type, with the version it speaks. */
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
