import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app imports the workspace packages by name; the tests resolve them to
  // their sources, exactly as Vite does, so a module under `apps/web/src` can be
  // tested against the real document and model instead of a mock.
  resolve: {
    alias: {
      "@remo/model": fileURLToPath(new URL("./packages/model/src/index.ts", import.meta.url)),
      "@remo/canvas": fileURLToPath(new URL("./packages/canvas/src/index.ts", import.meta.url)),
      "@remo/doc": fileURLToPath(new URL("./packages/doc/src/index.ts", import.meta.url)),
      "@remo/ui": fileURLToPath(new URL("./packages/ui/src/index.ts", import.meta.url)),
    },
  },
  test: {
    // Unit tests live next to the code they cover: domain packages, plus the
    // sync service's pure pieces (projection, diffing) and its storage tests,
    // which run against Postgres when one is reachable.
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.mts",
      // The plain-ESM packages shared by web and sync (metrics, agent plan) keep
      // their tests beside the runtime module.
      "packages/**/*.test.mjs",
      "apps/sync/**/*.test.mjs",
      // The web app keeps its pure modules (settings, clipboard, rich text) beside the
      // components, so their tests live there too.
      "apps/web/src/**/*.test.ts",
      // Run-configuration and database-identifier guards: pure modules that decide where a
      // parallel run writes and which database it may drop.
      "e2e/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    environment: "node",
    // One throwaway database per run: created and migrated once before the workers start,
    // dropped afterwards, and never the developer's own database (ADR-131). The setup also
    // refuses to let a run go green with its database suites silently skipped.
    globalSetup: ["./apps/sync/test-db-setup.mjs"],
    // Storage tests talk to a real database: schema creation, a few round trips and
    // a flush on teardown take longer than pure unit tests.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
