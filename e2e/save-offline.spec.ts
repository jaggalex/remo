import { expect, test } from "@playwright/test";
import { freshBoard } from "./helpers";
import { PROXY_PORT } from "./ports";

/**
 * Offline is a socket condition, not an HTTP one.
 *
 * `context.setOffline` stops new requests but leaves the live WebSocket alone, so the
 * app would honestly stay in "saving". Closing the socket at the transport level is
 * what a tunnel or a sleeping laptop actually does (ADR-084/090).
 */
test("an offline edit is queued and replayed after reconnect", async ({ page }) => {
  await freshBoard(page, "offline");

  // The harness proxy can lose the socket; Chromium's offline mode cannot, because it
  // does not affect localhost. The port follows the run (ADR-130).
  await page.request.post(`http://localhost:${PROXY_PORT}/__control/pause`);
  await expect(page.locator(".save-state")).toContainText(/offline/i, { timeout: 20_000 });

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  // The count is local Yjs updates, not objects: one note can be two updates.
  await expect(page.locator(".save-state")).toContainText(/Offline \(\d+\)/, { timeout: 15_000 });

  await page.request.post(`http://localhost:${PROXY_PORT}/__control/resume`);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 30_000 });

  await page.reload();
  await expect(page.locator(".counts li", { hasText: "Sticky note" })).toContainText("1");
});
