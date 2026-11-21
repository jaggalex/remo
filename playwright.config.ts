import { defineConfig } from "@playwright/test";
import {
  DATABASE_NAME,
  E2E_DATABASE_URL,
  E2E_KEK,
  MAIL_FILE,
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
 *   pnpm e2e --billing             # the same servers with REMO_BILLING=on (ADR-247 §11)
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
  // Baselines are compared only in the Linux browser and written only on purpose (ADR-222).
  snapshotPathTemplate: "spec/baselines/{arg}{ext}",
  // "changed": rewrite only what is outside the tolerance (ADR-223).
  updateSnapshots: process.env.REMO_UPDATE_BASELINES ? "changed" : "none",
  use: {
    ...(process.env.REMO_BROWSER_WS
      ? { connectOptions: { wsEndpoint: process.env.REMO_BROWSER_WS, exposeNetwork: "<loopback>" } }
      : {}),
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
        // Plans are a product mode, not a default (ADR-247, `spec/billing.md` §11/§13):
        // `pnpm e2e --billing` turns the feature on for its run and every other run keeps
        // the self-host answer, so the 0.4.1 scenarios stay exactly as they were.
        REMO_BILLING: process.env.E2E_BILLING === "1" ? "on" : "off",
        // The card replacement scenario needs the fake provider's page; the adapter is
        // gated by `REMO_PAY_FAKE=1` and by a non-production process (ADR-248 §7). Off in
        // the ordinary run, exactly like the billing family itself.
        ...(process.env.E2E_BILLING === "1" ? { REMO_PAY_FAKE: "1" } : {}),
        REMO_METRICS: "off",
        // A deterministic plan instead of a provider. `ai-fake.mjs` accepts it only
        // because this process also carries REMO_E2E_RUN_ID and is not production.
        REMO_AI_FAKE: "plan",
        // The scenarios register a fresh account per test from one address.
        REMO_LOGIN_IP_LIMIT: "10000",
        REMO_REGISTER_LIMIT: "10000",
        // Mail runs through the console driver and a file the scenarios read back
        // (ADR-246). `console` is the only driver that prints the link on purpose.
        REMO_MAIL_DRIVER: "console",
        REMO_MAIL_FROM: "remo <no-reply@mail.example.test>",
        REMO_MAIL_CONSOLE_FILE: MAIL_FILE,
        REMO_APP_ORIGIN: `http://localhost:${WEB_PORT}`,
        REMO_KEK: E2E_KEK,
        // Support is off unless the run asks for it (ADR-250). The scenarios read the
        // mode from `/api/support/config`, so one configuration drives all of them:
        // `E2E_SUPPORT_PROVIDER=link|chatwoot pnpm e2e e2e/support.spec.ts`.
        REMO_SUPPORT_PROVIDER: process.env.E2E_SUPPORT_PROVIDER ?? "none",
        ...(process.env.E2E_SUPPORT_URL ? { REMO_SUPPORT_URL: process.env.E2E_SUPPORT_URL } : {}),
        ...(process.env.E2E_SUPPORT_ORIGIN
          ? { REMO_SUPPORT_ORIGIN: process.env.E2E_SUPPORT_ORIGIN }
          : {}),
        ...(process.env.E2E_SUPPORT_HMAC_SECRET
          ? { REMO_SUPPORT_HMAC_SECRET: process.env.E2E_SUPPORT_HMAC_SECRET }
          : {}),
        ...(process.env.E2E_SUPPORT_CONTEXT_TOKEN
          ? { REMO_SUPPORT_CONTEXT_TOKEN: process.env.E2E_SUPPORT_CONTEXT_TOKEN }
          : {}),
        // The invitation scenarios predate verification; the guard has its own test.
        REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES: "0",
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
