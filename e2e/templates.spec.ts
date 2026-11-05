import { test, expect } from "@playwright/test";
import { openBoard, register, setAccountLanguage } from "./helpers";

type Probe = {
  __remo: {
    widgets: Array<{ type: string; text: string }>;
    layouts: Array<{
      columns: Array<{ title: string }>;
      lanes: Array<{ title: string }>;
    }>;
  };
};

test("seeds the template in the language of the account", async ({ page }) => {
  const account = await register(page, "template-ru");
  await setAccountLanguage(page, "ru");

  // The URL says English; the profile says Russian, and the profile wins.
  await page.goto(`/?room=${account.boardId}&lang=en&template=user-story-map-basic`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as Probe).__remo.widgets.some(
              (widget) => widget.text === "Карта истории",
            ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const texts = await page.evaluate(() =>
    (window as unknown as Probe).__remo.widgets.map((widget) => widget.text),
  );
  expect(texts).toContain("Персона");
  expect(texts).toContain("Для кого это?");
  expect(texts).not.toContain("Story map");
});

test("localizes the kanban recipe columns and swimlanes", async ({ page }) => {
  const account = await register(page, "template-kanban-ru");
  await setAccountLanguage(page, "ru");
  await page.goto(`/?room=${account.boardId}&lang=en&template=kanban-framework`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as Probe).__remo.layouts.some((layout) =>
              layout.columns.some((column) => column.title === "Бэклог"),
            ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const layout = await page.evaluate(
    () => (window as unknown as Probe).__remo.layouts.find((entry) => entry.columns.length > 0)!,
  );
  expect(layout.columns.map((column) => column.title)).toEqual(["Бэклог", "В работе", "Готово"]);
  expect(layout.lanes.map((lane) => lane.title)).toEqual(["Продукт", "Платформа"]);
});

test("keeps the English template for an English account", async ({ page }) => {
  const account = await register(page, "template-en");
  await setAccountLanguage(page, "en");
  await openBoard(page, account.boardId, { template: "user-story-map-basic", lang: "en" });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as Probe).__remo.widgets.some(
              (widget) => widget.text === "Story map",
            ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
});
