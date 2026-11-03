import { test, expect } from "@playwright/test";
import { freshBoard, PASSWORD, startPresentation } from "./helpers";

test("a late viewer joins the current slide and stays after the stop", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "presentation-viewer");
  const origin = new URL(page.url()).origin;

  const second = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const email = `e2e-viewer-${Date.now()}@example.com`;
  const registered = await second.request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: "Viewer" },
  });
  const viewer = (await registered.json()) as { user: { id: string } };

  const invite = await page.request.post(`/api/orgs/${account.orgId}/invitations`, {
    data: { email },
  });
  const invited = (await invite.json()) as { url: string };
  await second.request.post("/api/invitations/accept", {
    data: { token: new URL(invited.url).searchParams.get("invite") },
  });
  await page.request.post(`/api/boards/${account.boardId}/grants`, {
    data: { subjectType: "user", subjectId: viewer.user.id, role: "viewer" },
  });

  const viewerPage = await second.newPage();
  await viewerPage.goto(`${origin}/?room=${account.boardId}&lang=en&user=Viewer`);
  await expect(viewerPage.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await startPresentation(page);
  await page.locator(".presentation-actions .primary-button").click();
  await expect(page.locator(".present-bar")).toBeVisible();

  await expect(viewerPage.locator(".present-join")).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByRole("button", { name: "Watch" }).click();
  await expect(viewerPage.locator(".present-follow")).toBeVisible();
  await expect(viewerPage.locator(".present-follow")).toContainText("Watching");

  await page.locator(".present-bar").getByRole("button", { name: "Next slide" }).click();
  await expect(viewerPage.locator(".present-follow")).toBeVisible();

  await page.locator(".present-bar").getByRole("button", { name: "Stop" }).click();
  await expect(viewerPage.locator(".present-follow")).toHaveCount(0, { timeout: 10_000 });

  await second.close();
});
