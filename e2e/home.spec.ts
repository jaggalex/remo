import { test, expect } from "@playwright/test";
import { freshBoard, openBoardMenu } from "./helpers";

test("home shows board tiles with metadata, then the directory at a second page", async ({
  page,
}) => {
  const account = await freshBoard(page, "home-meta", { title: "Meta board" });
  await page.getByRole("button", { name: "All rooms" }).click();

  const home = page.locator(".home");
  await expect(home.locator(".org-badge.personal").first()).toBeVisible();
  const tile = home.locator(".home-tile").filter({ hasText: "Meta board" });
  await expect(tile).toContainText("Created");
  await expect(tile).toContainText("Updated");
  await expect(tile).toContainText("by home-meta");

  // ADR-197: one page of rooms is not a directory. No search, sort or tile menus.
  await expect(home.locator(".home-toolbar")).toHaveCount(0);
  await expect(tile.getByRole("button", { name: "Choose emoji" })).toHaveCount(0);

  // A second page brings the directory and its tile menus back.
  for (let index = 1; index <= 24; index += 1) {
    const created = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
      data: { title: `Meta page ${String(index).padStart(2, "0")}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  await page.reload();
  await expect(home.locator(".home-toolbar")).toBeVisible();

  const first = home.locator(".home-tile").first();
  await first.getByRole("button", { name: "Choose emoji" }).click();
  await page.getByRole("button", { name: "🚀", exact: true }).click();
  await expect(first.locator(".home-tile-icon")).toHaveText("🚀");

  await page.reload();
  await expect(home.locator(".home-tile").first().locator(".home-tile-icon")).toHaveText("🚀");
});

test("trashes a board and restores it from the home", async ({ page }) => {
  await freshBoard(page, "home-trash", { title: "Trash board" });

  // A one-page home has no tile menu, so the room's own menu moves it to the trash.
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: /Move to trash/ }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();

  const home = page.locator(".home");
  await expect(home.locator(".home-tile").filter({ hasText: "Trash board" })).toHaveCount(0);
  await home.getByRole("button", { name: "Trash", exact: true }).click();
  const trashed = home.locator(".home-tile").filter({ hasText: "Trash board" });
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(trashed).toHaveCount(0);

  await home.getByRole("button", { name: "Rooms", exact: true }).click();
  await expect(home.locator(".home-tile").filter({ hasText: "Trash board" })).toBeVisible();
});

test("the home header toggles theme and language in place", async ({ page }) => {
  await freshBoard(page, "home-prefs");
  await page.getByRole("button", { name: "All rooms" }).click();

  const home = page.locator(".home");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await home.getByRole("button", { name: /Theme: light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await home.getByRole("button", { name: /Language: English/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("sorts board tiles and pages them twenty-four at a time", async ({ page }) => {
  const account = await freshBoard(page, "home-pages", { title: "Base board" });
  for (let index = 1; index <= 25; index += 1) {
    const created = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
      data: { title: `Page board ${String(index).padStart(2, "0")}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }

  await page.getByRole("button", { name: "All rooms" }).click();
  const home = page.locator(".home");
  await expect(home.locator(".home-tile")).toHaveCount(24);
  await expect(home.getByRole("button", { name: "Page 2" })).toBeVisible();

  await home.getByRole("button", { name: "Page 2" }).click();
  await expect(home.locator(".home-tile")).toHaveCount(2);

  await home.getByLabel("Sort by").selectOption("name");
  // Newest-first is the default direction; name descending starts with the last page.
  await expect(home.locator(".home-tile").first()).toContainText("Page board 25");
  await home.getByRole("button", { name: "Descending" }).click();
  await expect(home.locator(".home-tile").first()).toContainText("Base board");
});
