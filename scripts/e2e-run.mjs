#!/usr/bin/env node
/**
 * Run the browser gate, then drop only the database this run created.
 *
 * The run id is generated once here and passed through the environment, so the Playwright
 * config, every worker and the cleanup step agree on one database name. Cleanup runs after
 * Playwright exits (its web servers are stopped by then) and uses the same ownership rule
 * as every other deletion: the marker must name this environment instance and run. A failed
 * test run is still cleaned up; the test exit code is preserved.
 *
 * The server is always the dedicated test PostgreSQL from `REMO_TEST_POSTGRES_URL`; there is
 * no explicit-database escape hatch that could bypass the installed environment identity.
 *
 * `--linux-browser` runs the scenarios against Chromium in the Playwright Linux image, the
 * one browser the visual baselines are compared in (ADR-222).
 *
 * `--billing` starts sync with `REMO_BILLING=on` for this run only. The flag is the
 * decision, not the developer's shell: without it the variable is removed, so the ordinary
 * run keeps the self-host behaviour and its 0.4.1 scenario set (`spec/billing.md` §11,
 * §13, ADR-247). The 0.4.1 scenarios assume no plan limits, so the billing acceptance is
 * run on its own: `pnpm e2e --billing e2e/billing.spec.ts`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { e2eDatabaseName, normalizeRunSuffix } from "./db-identifiers.mjs";
import { testPostgresUrl } from "./test-environment.mjs";
import { startLinuxBrowser } from "./linux-browser.mjs";
import { cleanupReports } from "./e2e-clean.mjs";

const env = { ...process.env };
if (!env.E2E_RUN_ID) env.E2E_RUN_ID = `${process.pid}_${randomBytes(4).toString("hex")}`;
// scripts/e2e-db.mjs receives these from the Playwright webServer env normally; the cleanup
// step runs here, so set them explicitly and from the same test-server contract.
env.REMO_E2E_RUN_ID = env.E2E_RUN_ID;
env.REMO_TEST_POSTGRES_URL = testPostgresUrl(env);

const base = Number(env.E2E_PORT_BASE ?? 0);
const explicit = (env.E2E_RUN_SUFFIX ?? "").trim();
const suffix = normalizeRunSuffix(explicit !== "" ? explicit : base > 0 ? String(base) : "");
env.REMO_E2E_DATABASE_NAME = e2eDatabaseName(suffix, env.E2E_RUN_ID);

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const linux = process.argv.includes("--linux-browser");
const billing = process.argv.includes("--billing");
const args = process.argv.slice(2).filter((arg) => arg !== "--linux-browser" && arg !== "--billing");

// The flag owns the feature switch in both directions: a stray `E2E_BILLING=1` in the
// shell must not turn the ordinary run into a billing run (spec/billing.md §11).
if (billing) env.E2E_BILLING = "1";
else delete env.E2E_BILLING;

const browser = linux ? await startLinuxBrowser() : null;
if (browser) env.REMO_BROWSER_WS = browser.wsEndpoint;
if (billing) console.log("[e2e] billing on: sync starts with REMO_BILLING=on");

const tests = spawnSync(pnpm, ["exec", "playwright", "test", ...args], {
  stdio: "inherit",
  env,
});
browser?.stop();
if (tests.error) throw tests.error;

const cleanup = spawnSync(process.execPath, ["scripts/e2e-db.mjs", "--teardown"], {
  stdio: "inherit",
  env,
});
if (cleanup.error) throw cleanup.error;

// Reports are disposable after the run. Keep the newest few for debugging; remove the
// rest so a month of traces does not grow into gigabytes. A cleanup failure must never
// change the test result.
try {
  const reports = await cleanupReports({
    keep: Number(env.REMO_E2E_KEEP ?? 10),
    days: Number(env.REMO_E2E_KEEP_DAYS ?? 7),
  });
  for (const report of reports) {
    if (report.removed) {
      console.log(`[e2e] ${report.root}: removed ${report.removed} old run(s), kept ${report.kept}`);
    }
  }
} catch (error) {
  console.warn(`[e2e] report cleanup skipped: ${error.message}`);
}

const status = tests.status ?? 1;
if (status !== 0) process.exit(status);
process.exit(cleanup.status ?? 1);
