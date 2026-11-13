import { test, expect } from "@playwright/test";
import { freshBoard } from "./helpers";

test("theme switches in the board and survives in help", async ({ page }) => {
  await freshBoard(page, "theme");

  // Theme and language are the last two controls in the header (ADR-194); a new
  // account starts light, and the account menu no longer carries the choice.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Theme: light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/help/en/comments.thread");
  await expect(page.locator(".theme-toggle-button")).toHaveAttribute("title", /dark/i);
  await page.locator(".theme-toggle-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
