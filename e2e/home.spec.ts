import { test, expect } from "@playwright/test";
import { freshBoard } from "./helpers";

test("home shows board tiles with metadata and keeps an emoji", async ({ page }) => {
  await freshBoard(page, "home-meta", { title: "Meta board" });
  await page.getByRole("button", { name: "All boards" }).click();

  const home = page.locator(".home");
  await expect(home.locator(".org-badge.personal").first()).toBeVisible();
  const tile = home.locator(".home-tile").filter({ hasText: "Meta board" });
  await expect(tile).toContainText("Created");
  await expect(tile).toContainText("Updated");
  await expect(tile).toContainText("by home-meta");

  await tile.getByRole("button", { name: "Choose emoji" }).click();
  await page.getByRole("button", { name: "🚀", exact: true }).click();
  await expect(tile.locator(".home-tile-icon")).toHaveText("🚀");

  await page.reload();
  const reloaded = page.locator(".home-tile").filter({ hasText: "Meta board" });
  await expect(reloaded.locator(".home-tile-icon")).toHaveText("🚀");
});

test("trashes a board and restores it from the home", async ({ page }) => {
  await freshBoard(page, "home-trash", { title: "Trash board" });
  await page.getByRole("button", { name: "All boards" }).click();

  const home = page.locator(".home");
  const tile = home.locator(".home-tile").filter({ hasText: "Trash board" });
  await tile.hover();
  await tile.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  await expect(tile).toHaveCount(0);

  await home.getByRole("button", { name: "Trash", exact: true }).click();
  const trashed = home.locator(".home-tile").filter({ hasText: "Trash board" });
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(trashed).toHaveCount(0);

  await home.getByRole("button", { name: "Boards", exact: true }).click();
  await expect(home.locator(".home-tile").filter({ hasText: "Trash board" })).toBeVisible();
});

test("sorts board tiles and pages them twenty-four at a time", async ({ page }) => {
  const account = await freshBoard(page, "home-pages", { title: "Base board" });
  for (let index = 1; index <= 25; index += 1) {
    const created = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
      data: { title: `Page board ${String(index).padStart(2, "0")}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }

  await page.getByRole("button", { name: "All boards" }).click();
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
