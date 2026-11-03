import { expect, test } from "@playwright/test";

/**
 * The probe is reachable without a session and says one bit.
 *
 * The store version, board and room counts and a raw driver error used to travel with
 * it; a health endpoint is for a load balancer, not for an inventory of the deployment.
 */
test("the health probe reports ok and nothing else", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
