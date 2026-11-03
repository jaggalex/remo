import { defineConfig } from "@playwright/test";
import {
  DATABASE_NAME,
  E2E_DATABASE_URL,
  OUTPUT_DIR,
  PROXY_PORT,
  REPORT_DIR,
  RUN_ID,
  SYNC_PORT,
  TEST_POSTGRES_URL,
  WEB_PORT,
  WORKERS,
} from "./e2e/ports";

/**
 * End-to-end acceptance (ADR-090), addressable per run (ADR-130).
 *
 * Three servers on dedicated ports, one dedicated database, file-level parallelism only:
 * the scenarios share a board and a store, and running tests of one file in parallel
 * would turn a product bug into a race in the harness.
 *
 * A run owns its ports, its database and its report directories, so two runs can overlap:
 *
 *   pnpm e2e                       # defaults: 1235 / 1237 / 5175, remo_e2e_<run id>
 *   E2E_PORT_BASE=1000 pnpm e2e    # 2235 / 2237 / 6175, remo_e2e_1000_<run id>
 *
 * Artifact directories are run-scoped siblings; no run's output is an ancestor of another
 * run's output, so Playwright's cleanup of one cannot delete the other's evidence.
 *
 * Reports and traces stay out of git.
 */
export default defineConfig({
  testDir: "./e2e",
  // `*.test.ts` in this directory is a Vitest regression test, not a browser scenario.
  testMatch: "**/*.spec.ts",
  outputDir: OUTPUT_DIR,
  fullyParallel: false,
  workers: WORKERS,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: REPORT_DIR }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "en-US",
    // The product's design target; 1280 still overflows the topbar (recorded in Q2).
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/e2e-db.mjs && node apps/sync/server.mjs",
      url: `http://localhost:${SYNC_PORT}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        REMO_E2E_DATABASE_NAME: DATABASE_NAME,
        REMO_E2E_RUN_ID: RUN_ID,
        REMO_TEST_POSTGRES_URL: TEST_POSTGRES_URL,
        PORT: String(SYNC_PORT),
        REMO_METRICS: "off",
        // A deterministic plan instead of a provider. `ai-fake.mjs` accepts it only
        // because this process also carries REMO_E2E_RUN_ID and is not production.
        REMO_AI_FAKE: "plan",
        // The scenarios register a fresh account per test from one address.
        REMO_LOGIN_IP_LIMIT: "10000",
        REMO_REGISTER_LIMIT: "10000",
      },
    },
    {
      command: "node scripts/e2e-proxy.mjs",
      url: `http://localhost:${PROXY_PORT}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        E2E_PROXY_PORT: String(PROXY_PORT),
        E2E_PROXY_TARGET: `http://localhost:${SYNC_PORT}`,
      },
    },
    {
      command: `pnpm --filter @remo/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        REMO_SYNC_TARGET: `http://localhost:${PROXY_PORT}`,
      },
    },
  ],
});
