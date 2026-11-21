/**
 * Prometheus metrics for the gateway (`spec/ai-gateway.md` §7).
 *
 * No dependency and no organisation labels: an organisation id as a label would create
 * one series per tenant for every provider and status. A small hand-written registry is
 * enough for the eight families the spec asks for.
 */

const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

const HELP = {
  remo_gw_requests_total: "Model calls handled by the gateway.",
  remo_gw_latency_seconds: "Time from accepting a call to receiving the provider answer.",
  remo_gw_tokens_total: "Tokens reported by providers, by direction.",
  remo_gw_cost_total: "Estimated provider cost, using registry prices.",
  remo_gw_killed_total: "Calls refused by a kill switch.",
  remo_gw_rate_limited_total: "Calls refused by a rate or daily limit.",
  remo_gw_inflight: "Upstream calls in flight.",
  remo_gw_upstream_errors_total: "Provider errors, by provider status.",
};

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelKey(labels = {}) {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!entries.length) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

class Histogram {
  constructor() {
    this.buckets = new Map(LATENCY_BUCKETS.map((bound) => [bound, 0]));
    this.count = 0;
    this.sum = 0;
  }

  observe(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.count += 1;
    this.sum += value;
    for (const bound of LATENCY_BUCKETS) {
      if (value <= bound) this.buckets.set(bound, (this.buckets.get(bound) ?? 0) + 1);
    }
  }
}

export class GatewayMetrics {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    // Small rolling samples back the `remo-gw providers` table; they are never rendered.
    this.latencySamples = new Map();
    this.errorTimes = new Map();
    this.requestTimes = new Map();
  }

  inc(name, labels = {}, value = 1) {
    const key = labelKey(labels);
    const family = this.counters.get(name) ?? new Map();
    family.set(key, (family.get(key) ?? 0) + value);
    this.counters.set(name, family);
  }

  set(name, value, labels = {}) {
    this.gauges.set(`${name}${labelKey(labels)}`, { name, labels, value });
  }

  observe(name, labels, value) {
    const key = labelKey(labels);
    const family = this.histograms.get(name) ?? new Map();
    const histogram = family.get(key) ?? new Histogram();
    histogram.observe(value);
    family.set(key, histogram);
    this.histograms.set(name, family);
  }

  request({ provider, model, status }) {
    this.inc("remo_gw_requests_total", { provider, model, status: String(status) });
    const previous = this.requestTimes.get(provider) ?? [];
    previous.push(Date.now());
    if (previous.length > 1000) previous.shift();
    this.requestTimes.set(provider, previous);
  }

  latency(provider, seconds) {
    this.observe("remo_gw_latency_seconds", { provider }, seconds);
    const samples = this.latencySamples.get(provider) ?? [];
    samples.push(seconds * 1000);
    if (samples.length > 500) samples.shift();
    this.latencySamples.set(provider, samples);
  }

  tokens(provider, direction, count) {
    if (!count) return;
    this.inc("remo_gw_tokens_total", { provider, direction }, count);
  }

  cost(provider, amount) {
    if (!amount) return;
    this.inc("remo_gw_cost_total", { provider }, amount);
  }

  killed(scope) {
    this.inc("remo_gw_killed_total", { scope });
  }

  rateLimited(scope) {
    this.inc("remo_gw_rate_limited_total", { scope });
  }

  inflight(count) {
    this.set("remo_gw_inflight", count);
  }

  upstreamError(provider, code) {
    this.inc("remo_gw_upstream_errors_total", { provider, code: String(code) });
    const times = this.errorTimes.get(provider) ?? [];
    times.push(Date.now());
    if (times.length > 1000) times.shift();
    this.errorTimes.set(provider, times);
  }

  /** Per-provider numbers for the admin table: requests and errors in the last hour, p95. */
  providerStats(provider) {
    const now = Date.now();
    const recent = (this.errorTimes.get(provider) ?? []).filter((time) => now - time <= 3_600_000);
    const requests = (this.requestTimes.get(provider) ?? []).filter((time) => now - time <= 3_600_000);
    const samples = [...(this.latencySamples.get(provider) ?? [])].sort((a, b) => a - b);
    const index = samples.length ? Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1) : 0;
    return {
      errorsLastHour: recent.length,
      requestsLastHour: requests.length,
      p95Ms: samples.length ? Math.round(samples[index]) : 0,
    };
  }

  render() {
    const lines = [];
    for (const name of Object.keys(HELP)) {
      const hasCounter = this.counters.has(name);
      const hasHistogram = this.histograms.has(name);
      const hasGauge = [...this.gauges.values()].some((entry) => entry.name === name);
      if (!hasCounter && !hasHistogram && !hasGauge) continue;
      lines.push(`# HELP ${name} ${HELP[name]}`);
      lines.push(`# TYPE ${name} ${hasHistogram ? "histogram" : hasCounter ? "counter" : "gauge"}`);
      for (const [key, value] of this.counters.get(name) ?? []) {
        lines.push(`${name}${key} ${formatNumber(value)}`);
      }
      for (const [key, histogram] of this.histograms.get(name) ?? []) {
        for (const bound of [...LATENCY_BUCKETS, "+Inf"]) {
          const count = bound === "+Inf" ? histogram.count : (histogram.buckets.get(bound) ?? 0);
          lines.push(`${name}_bucket${mergeLabels(key, bound)} ${formatNumber(count)}`);
        }
        lines.push(`${name}_sum${key || ""} ${formatNumber(histogram.sum)}`);
        lines.push(`${name}_count${key || ""} ${formatNumber(histogram.count)}`);
      }
    }
    for (const { name, labels, value } of this.gauges.values()) {
      // A gauge family appears once; its own HELP/TYPE block was emitted in the loop above.
      if (!lines.includes(`# HELP ${name} ${HELP[name]}`)) {
        lines.push(`# HELP ${name} ${HELP[name] ?? ""}`);
        lines.push(`# TYPE ${name} gauge`);
      }
      lines.push(`${name}${labelKey(labels)} ${formatNumber(value)}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

/** Add `le` to an existing label set, in the style `render` uses. */
function mergeLabels(key, bound) {
  const inner = key.startsWith("{") ? key.slice(1, -1) : "";
  const le = `le="${bound}"`;
  return `{${inner ? `${inner},${le}` : le}}`;
}
