import { test, expect, type Page } from "@playwright/test";
import { freshBoard } from "./helpers";

async function selectFirstCard(page: Page): Promise<string> {
  // After a reload the document arrives over the socket; the probe is empty until then.
  await page.waitForFunction(() => {
    const probe = window as unknown as {
      __remo?: { layouts: Array<{ placements: unknown[] }> };
    };
    return Boolean(probe.__remo?.layouts?.some((entry) => entry.placements.length > 0));
  });
  const point = await page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{ placements: Array<{ cardId: string; x: number; y: number }> }>;
      };
    };
    const layout = probe.__remo.layouts.find((entry) => entry.placements.length > 0)!;
    const placement = layout.placements[0]!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (placement.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (placement.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  });
  await page.mouse.click(point.x, point.y);
  return page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );
}

test("a tag and a safe external link survive a reload", async ({ page }) => {
  await freshBoard(page, "tags-links");
  const cardId = await selectFirstCard(page);

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
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await selectFirstCard(page);

  await expect(page.locator(".tags-panel .tag-assign .tag-chip")).toHaveText("Priority");
  await expect(page.locator(".link-panel .link-current")).toContainText("example.com");
});

test("an internal link points to another object", async ({ page }) => {
  await freshBoard(page, "internal-link");
  await selectFirstCard(page);

  const link = page.locator(".link-panel");
  await expect(link.locator("select option")).not.toHaveCount(0);
  await link.locator("select").selectOption({ index: 1 });
  await link.locator(".link-row button").nth(1).click();
  await expect(link.locator(".link-current")).toContainText("Object on this board");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await selectFirstCard(page);
  await expect(page.locator(".link-panel .link-current")).toContainText(
    "Object on this board",
  );
});
