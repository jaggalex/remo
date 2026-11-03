#!/usr/bin/env node
/**
 * Bootstrap the dedicated test PostgreSQL identity (ADR-136).
 *
 *   pnpm test:db:up      # starts Compose, then runs this
 *   pnpm test:db:init    # install only
 *
 * Idempotent. If the server already carries the expected identity, nothing is written.
 * If it is unreachable, retries while the container becomes healthy. If it is reachable
 * but holds other databases, it refuses to bootstrap: that is a development server, not
 * the dedicated test server, regardless of its host or port.
 */
import {
  TestEnvironmentNotBootstrapped,
  TestEnvironmentUnavailable,
  bootstrapTestEnvironment,
  describeTestEnvironment,
  testPostgresUrl,
  verifyTestEnvironment,
} from "./test-environment.mjs";

const ATTEMPTS = 30;
const DELAY_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const url = testPostgresUrl();

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const identity = await verifyTestEnvironment(url).catch(async (error) => {
      if (
        error instanceof TestEnvironmentNotBootstrapped ||
        error instanceof TestEnvironmentUnavailable
      ) {
        return bootstrapTestEnvironment(url);
      }
      throw error;
    });
    console.log(`[test-db] ready: ${describeTestEnvironment(url, identity)}`);
    process.exit(0);
  } catch (error) {
    if (error instanceof TestEnvironmentUnavailable && attempt < ATTEMPTS) {
      await sleep(DELAY_MS);
      continue;
    }
    if (error instanceof TestEnvironmentUnavailable) {
      console.error(`[test-db] ${error.message}`);
      console.error("[test-db] start the dedicated server with: pnpm test:db:up");
      process.exit(1);
    }
    console.error(`[test-db] bootstrap refused: ${error.message}`);
    console.error(
      "[test-db] the identity is installed only on the dedicated empty test server; " +
        "check REMO_TEST_POSTGRES_URL and docker-compose.test.yml.",
    );
    process.exit(1);
  }
}
