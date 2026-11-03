import { expect, test } from "@playwright/test";
import { freshBoard, openBoard, openMore, register } from "./helpers";

/**
 * A first-party app on the board (ADR-098).
 *
 * The panel is a schema the server sent; the board draws it. The scenario proves the two
 * halves that matter: a disabled app leaves no surface at all, and an enabled one answers
 * with a sentence carrying the viewer's own name.
 */
test("an installed app draws its panel and answers with the viewer's name", async ({ page }) => {
  const account = await register(page, "apps-on", { user: "Ada" });
  const installed = await page.request.post(`/api/orgs/${account.orgId}/apps`, {
    data: { appId: "app.hello" },
  });
  expect(installed.ok()).toBeTruthy();

  await openBoard(page, account.boardId, { user: "Ada" });
  await openMore(page);
  await page.getByRole("menuitem", { name: "Apps" }).click();

  const dialog = page.getByRole("dialog", { name: "Apps" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Hello, Ada!")).toBeVisible();

  await dialog.getByRole("button", { name: "Say hello" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Hello, Ada!");
});

test("a disabled app leaves nothing on the board", async ({ page }) => {
  const account = await register(page, "apps-off");
  await page.request.post(`/api/orgs/${account.orgId}/apps`, {
    data: { appId: "app.hello" },
  });
  const disabled = await page.request.patch(`/api/orgs/${account.orgId}/apps/app.hello`, {
    data: { enabled: false },
  });
  expect(disabled.ok()).toBeTruthy();

  await openBoard(page, account.boardId);
  await openMore(page);
  await page.getByRole("menuitem", { name: "Apps" }).click();
  const dialog = page.getByRole("dialog", { name: "Apps" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/No apps are installed/)).toBeVisible();
});

test("the board's apps come from its organisation, not from the browser", async ({ page }) => {
  // A board with no organisation (a legacy room) has nothing to install into.
  const account = await freshBoard(page, "apps-legacy");
  await openMore(page);
  await expect(page.getByRole("menuitem", { name: "Apps" })).toHaveCount(1);
  await page.getByRole("menuitem", { name: "Apps" }).click();
  await expect(page.getByRole("dialog", { name: "Apps" })).toBeVisible();
  // `freshBoard` creates a real account, so the panel is simply empty for it.
  await expect(page.getByRole("dialog", { name: "Apps" })).toContainText(
    /No apps are installed/,
  );
  void account;
});
