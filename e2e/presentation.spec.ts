import { test, expect } from "@playwright/test";
import { PASSWORD, freshBoard, startPresentation } from "./helpers";

test("starts, advances and stops a presentation, restoring the camera", async ({ page }) => {
  await freshBoard(page, "presentation");
  const before = await page.evaluate(
    () => (window as unknown as { __remo: { camera: unknown } }).__remo.camera,
  );

  await startPresentation(page);
  const panel = page.locator(".presentation-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".presentation-list li")).toHaveCount(2);
  await panel.locator(".presentation-actions .primary-button").click();

  const bar = page.locator(".present-bar");
  await expect(bar).toContainText("1");
  await expect(bar).toContainText("2");
  await bar.getByRole("button", { name: "Next slide" }).click();
  await expect(bar).toContainText("2");
  await bar.getByRole("button", { name: "Stop" }).click();
  await expect(bar).toHaveCount(0);

  const after = await page.evaluate(
    () => (window as unknown as { __remo: { camera: unknown } }).__remo.camera,
  );
  expect(after).toEqual(before);
});

test("a second session of one account cannot start another presentation", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "present-two", { user: "Sess" });
  await startPresentation(page);
  await page.locator(".presentation-panel .presentation-actions .primary-button").click();
  await expect(page.locator(".present-bar")).toBeVisible();

  const second = await browser.newContext();
  const other = await second.newPage();
  try {
    const login = await other.request.post("/api/auth/login", {
      data: { email: account.email, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    await other.goto(`/?room=${account.boardId}&lang=en`);
    await expect(other.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
    // The second session sees the live presentation before it tries to start its own.
    await expect(other.locator(".present-join")).toContainText("Sess");

    await startPresentation(other);
    await other.locator(".presentation-panel .presentation-actions .primary-button").click();
    await expect(other.locator(".canvas-notice")).toContainText("already running");
    await expect(other.locator(".present-bar")).toHaveCount(0);
  } finally {
    await second.close();
  }
});
