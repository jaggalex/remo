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
