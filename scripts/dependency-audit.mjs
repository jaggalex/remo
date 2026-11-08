#!/usr/bin/env node
/**
 * A dependency gate that fails only when there is something to do (ADR-133).
 *
 * `pnpm audit` alone is either report-only (and ignored) or blocks on a transitive
 * advisory with no fix, which teaches people to add `|| true`. This script fails on a
 * high or critical production advisory **when a fix exists**, and lets an operator
 * allowlist a specific advisory with a reason and an expiry.
 *
 * A registry outage is not a vulnerability: with no report the script warns and exits 0.
 * Set `REMO_AUDIT_REQUIRED=1` in CI when a missing report should fail the gate.
 *
 *   node scripts/dependency-audit.mjs
 *   node scripts/dependency-audit.mjs --strict   # fail on any high/critical
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const STRICT = process.argv.includes("--strict");
const REQUIRED = process.env.REMO_AUDIT_REQUIRED === "1";
const ALLOWLIST = join(ROOT, "security", "audit-allowlist.json");

function allowlist() {
  if (!existsSync(ALLOWLIST)) return {};
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
    return parsed.allow ?? parsed;
  } catch (error) {
    console.warn(`[audit] cannot read ${ALLOWLIST}: ${error.message}`);
    return {};
  }
}

function allowed(entry, reasons) {
  for (const [key, value] of Object.entries(reasons)) {
    const matches =
      entry.id === key ||
      entry.githubAdvisory === key ||
      entry.module === key ||
      (entry.url && entry.url.includes(key));
    if (!matches) continue;
    if (value.expires && new Date(value.expires).getTime() <= Date.now()) {
      console.warn(`[audit] allowlist entry ${key} expired on ${value.expires}`);
      return false;
    }
    console.log(`[audit] allowed ${key}: ${value.reason ?? "no reason recorded"}`);
    return true;
  }
  return false;
}

/** Normalise npm v6 `advisories` and npm v7 `vulnerabilities` into one shape. */
function findings(report) {
  const out = [];
  for (const [id, advisory] of Object.entries(report.advisories ?? {})) {
    out.push({
      id: String(advisory.github_advisory_id ?? id),
      githubAdvisory: advisory.github_advisory_id ?? null,
      module: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
      url: advisory.url,
      fix: advisory.patched_versions && advisory.patched_versions !== "<0.0.0",
      fixAvailable: advisory.patched_versions && advisory.patched_versions !== "<0.0.0",
    });
  }
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    const via = (vulnerability.via ?? []).find((entry) => typeof entry === "object") ?? {};
    out.push({
      id: String(via.source ?? name),
      githubAdvisory: via.url?.split("/").pop() ?? null,
      module: name,
      severity: vulnerability.severity,
      title: via.title ?? "advisory",
      url: via.url ?? null,
      fix: vulnerability.fixAvailable === true || Boolean(vulnerability.fixAvailable?.version),
      fixAvailable: vulnerability.fixAvailable,
    });
  }
  return out;
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["audit", "--json", "--prod"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

let report = null;
try {
  report = JSON.parse(result.stdout || "null");
} catch {
  report = null;
}

if (!report) {
  const message = `[audit] no report (${result.error?.message ?? result.stderr?.trim().split("\n")[0] ?? "unknown"})`;
  if (REQUIRED) {
    console.error(`${message}; REMO_AUDIT_REQUIRED=1`);
    process.exit(1);
  }
  console.warn(`${message}; not failing the build`);
  process.exit(0);
}

const all = findings(report);
const actionable = all.filter((entry) => {
  if (!["high", "critical"].includes(entry.severity)) return false;
  if (!STRICT && !entry.fix) return false;
  return !allowed(entry, allowlist());
});

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `[audit] ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ` +
    `${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low; ` +
    `${actionable.length} actionable`,
);

for (const entry of actionable) {
  console.error(
    `[audit] ${entry.severity} ${entry.module}: ${entry.title}` +
      `${entry.url ? ` (${entry.url})` : ""} — fix ${entry.fix ? "available" : "not available"}`,
  );
}

if (actionable.length) {
  console.error(
    "[audit] update the dependency, or add a reasoned, expiring entry to security/audit-allowlist.json",
  );
  process.exit(1);
}
