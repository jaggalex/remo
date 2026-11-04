import { test, expect } from "@playwright/test";
import { freshBoard, openAccount } from "./helpers";

test("creates an organisation and a team", async ({ page }) => {
  await freshBoard(page, "org-create");
  await openAccount(page);
  await page.getByRole("button", { name: "Organisation and people" }).click();
  await expect(page.locator(".org-dialog")).toBeVisible();

  await page.getByRole("button", { name: "+ New organisation" }).click();
  await page.locator(".org-create input").first().fill("Second workspace");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.locator(".org-dialog h2")).toHaveText("Second workspace");

  await page.locator(".org-teams input").fill("Design");
  await page.getByRole("button", { name: "+ Create team" }).click();
  await expect(page.locator(".org-team-list")).toContainText("Design");
});

test("renames the organisation and a team, then deletes the team", async ({ page }) => {
  await freshBoard(page, "org-edit");
  await openAccount(page);
  await page.getByRole("button", { name: "Organisation and people" }).click();
  await expect(page.locator(".org-dialog")).toBeVisible();

  await page.locator(".org-teams input").fill("Design");
  await page.getByRole("button", { name: "+ Create team" }).click();
  await expect(page.locator(".org-team-list")).toContainText("Design");

  await page.locator(".org-title").getByRole("button", { name: "Rename" }).click();
  await page.locator(".org-rename input").fill("Studio");
  await page.locator(".org-rename").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".org-dialog h2")).toHaveText("Studio");

  const row = page.locator(".org-team-row").filter({ hasText: "Design" });
  await row.getByRole("button", { name: "Rename" }).click();
  // The row no longer contains its name as text while it is an input.
  const editing = page.locator(".org-team-row").filter({ has: page.locator("input") });
  await editing.locator("input").fill("Product");
  await editing.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".org-team-list")).toContainText("Product");

  await page
    .locator(".org-team-row")
    .filter({ hasText: "Product" })
    .getByRole("button", { name: "Delete team" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete team" }).click();
  await expect(page.locator(".org-team-list")).not.toContainText("Product");
});
