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
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { e2eDatabaseName, normalizeRunSuffix } from "./db-identifiers.mjs";
import { testPostgresUrl } from "./test-environment.mjs";

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
const args = process.argv.slice(2);

const tests = spawnSync(pnpm, ["exec", "playwright", "test", ...args], {
  stdio: "inherit",
  env,
});
if (tests.error) throw tests.error;

const cleanup = spawnSync(process.execPath, ["scripts/e2e-db.mjs", "--teardown"], {
  stdio: "inherit",
  env,
});
if (cleanup.error) throw cleanup.error;

const status = tests.status ?? 1;
if (status !== 0) process.exit(status);
process.exit(cleanup.status ?? 1);
