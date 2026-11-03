import { test, expect } from "@playwright/test";
import { freshBoard, openAccount } from "./helpers";

test("theme switches in the board and survives in help", async ({ page }) => {
  await freshBoard(page, "theme");

  // The board's theme lives in the account menu (spec §10, Ш5); the help portal keeps
  // the one-button cycle, which the second half of this scenario checks.
  await openAccount(page);
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/help/en/comments.thread");
  await expect(page.locator(".theme-toggle-button")).toHaveAttribute("title", /dark/i);
  await page.locator(".theme-toggle-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
