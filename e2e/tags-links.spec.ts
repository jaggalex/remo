import { test, expect } from "@playwright/test";
import { freshBoard, selectKanbanCard, openFold, register } from "./helpers";

test("a tag and a safe external link survive a reload", async ({ page }) => {
  await freshBoard(page, "tags-links");
  const cardId = await selectKanbanCard(page);

  // Tags and Name and link are folded rows (ADR-236): open them to edit.
  await openFold(page, "Tags");
  await openFold(page, "Name and link");
  const tags = page.locator(".tags-panel");
  await tags.locator(".tag-add input").fill("Priority");
  await tags.locator(".tag-add button").click();
  await expect(tags.locator(".tag-assign .tag-chip")).toHaveText("Priority");
  await tags.locator(".tag-assign input[type=checkbox]").first().check();
  // The folded row says what it holds without opening it.
  await expect(page.locator(".tags-fold .inspector-fold-value")).toHaveText("Priority");

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

  await openFold(page, "Name and link");
  const link = page.locator(".link-panel");
  await expect(link.locator("select option")).not.toHaveCount(0);
  await link.locator("select").selectOption({ index: 1 });
  await link.locator(".link-row button").nth(1).click();
  await expect(link.locator(".link-current")).toContainText("Object in this room");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await page.reload();
  await selectKanbanCard(page, cardId);
  await expect(page.locator(".link-panel .link-current")).toContainText(
    "Object in this room",
  );
});

test("the tags block fits the panel in Russian, the longer labels", async ({ page }) => {
  const account = await register(page, "tags-ru");
  await page.goto(`/?room=${account.boardId}&lang=ru&template=kanban-framework`);
  await expect(page.locator(".save-state")).toHaveText(/Сохранено/, { timeout: 20_000 });
  // The helpers speak English; here the card is selected by the room's deep link.
  const cardId = await page.waitForFunction(() =>
    (window as unknown as { __remo?: { layouts: Array<{ placements: Array<{ cardId: string }> }> } }).__remo?.layouts
      ?.find((layout) => layout.placements.length > 0)?.placements[0]?.cardId,
  ).then((handle) => handle.jsonValue() as Promise<string>);
  await page.goto(`/?room=${account.boardId}&lang=ru&select=${cardId}`);
  await page.getByRole("button", { name: "Свойства", exact: true }).click();
  await openFold(page, "Теги");
  const tags = page.locator(".tags-panel");
  await tags.locator(".tag-add input").fill("Важно");
  await tags.locator(".tag-add button").click();
  await expect(tags.locator(".tag-row")).toHaveCount(1);
  // Every control of the block ends inside the panel's content box: five controls in one
  // line used to run past it.
  const layout = await page.locator("aside.inspector").evaluate((panel) => {
    const style = getComputedStyle(panel);
    const right = panel.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const selector = ".rm-input, .rm-btn, .tag-chip";
    const controls = [...panel.querySelectorAll<HTMLElement>(`.tags-panel :is(${selector})`)];
    // Controls of one row must not lie on top of each other either.
    let overlaps = 0;
    for (const row of panel.querySelectorAll(".tags-panel :is(.tag-add, .tag-row)")) {
      const boxes = [...row.querySelectorAll<HTMLElement>(selector)].map((el) => el.getBoundingClientRect());
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const shared = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const tall = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (shared > 1 && tall > 1) overlaps += 1;
        }),
      );
    }
    return {
      past: Math.max(...controls.map((control) => Math.round(control.getBoundingClientRect().right - right))),
      overlaps,
    };
  });
  expect(layout.past, "the tags block fits the panel's width").toBeLessThanOrEqual(0);
  expect(layout.overlaps, "no two controls of a row overlap").toBe(0);
});
