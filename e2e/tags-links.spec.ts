import { test, expect } from "@playwright/test";
import { freshBoard, selectKanbanCard } from "./helpers";

test("a tag and a safe external link survive a reload", async ({ page }) => {
  await freshBoard(page, "tags-links");
  const cardId = await selectKanbanCard(page);

  const tags = page.locator(".tags-panel");
  await tags.locator(".tag-add input").fill("Priority");
  await tags.locator(".tag-add button").click();
  await expect(tags.locator(".tag-assign .tag-chip")).toHaveText("Priority");
  await tags.locator(".tag-assign input[type=checkbox]").first().check();

  const link = page.locator(".link-panel");
  await link.locator('input[type="url"]').fill("https://example.com");
  await link.locator(".link-row button").first().click();
  await expect(link.locator(".link-current")).toContainText("example.com");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await page.reload();
  await selectKanbanCard(page, cardId);

  await expect(page.locator(".tags-panel .tag-assign .tag-chip")).toHaveText("Priority");
  await expect(page.locator(".link-panel .link-current")).toContainText("example.com");
});

test("an internal link points to another object", async ({ page }) => {
  await freshBoard(page, "internal-link");
  const cardId = await selectKanbanCard(page);

  const link = page.locator(".link-panel");
  await expect(link.locator("select option")).not.toHaveCount(0);
  await link.locator("select").selectOption({ index: 1 });
  await link.locator(".link-row button").nth(1).click();
  await expect(link.locator(".link-current")).toContainText("Object on this room");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await page.reload();
  await selectKanbanCard(page, cardId);
  await expect(page.locator(".link-panel .link-current")).toContainText(
    "Object on this room",
  );
});
