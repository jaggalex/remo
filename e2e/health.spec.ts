import { expect, test } from "@playwright/test";
import { SCHEMA_VERSION } from "../apps/sync/schema-version.mjs";

/**
 * The probe is reachable without a session and names the build, not the deployment.
 *
 * A load balancer needs one bit; whoever operates the deployment needs to know which
 * version answered. The store version, board and room counts and a raw driver error
 * stay in metrics — the internet has no business seeing them.
 */
test("the health probe reports ok and the build identity, nothing else", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["build", "commit", "ok", "schema", "version"]);
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe("string");
  expect(body.version).not.toBe("");
  expect(typeof body.build).toBe("string");
  expect(body.build).not.toBe("");
  expect(typeof body.commit).toBe("string");
  expect(body.commit).not.toBe("");
  expect(body.schema).toBe(SCHEMA_VERSION);
});
