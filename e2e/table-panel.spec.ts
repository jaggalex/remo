import { expect, test, type Page } from "@playwright/test";
import { openBoard, register, seedNote, seedObject } from "./helpers";

interface ProbeWidget {
  id: string;
  type: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function widgets(page: Page): Promise<ProbeWidget[]> {
  return page.evaluate(
    () => (window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets,
  );
}

async function waitForWidget(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await widgets(page)).some((widget) => widget.id === id))
    .toBe(true);
}

async function screenPoint(page: Page, world: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const probe = (window as unknown as {
      __remo: { camera: { x: number; y: number; zoom: number } };
    }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
    };
  }, world);
}

test("turns a section into a table and deletes it without its objects", async ({ page }) => {
  const account = await register(page, "table-panel");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });
  const noteId = await seedNote(
    page,
    account.boardId,
    { x: 0, y: 0 },
    undefined,
    "Inside",
    frameId,
  );

  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await waitForWidget(page, frameId);
  const frame = (await widgets(page)).find((widget) => widget.id === frameId)!;
  const point = await screenPoint(page, { x: frame.x, y: frame.y - frame.height / 2 + 24 });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([frameId]);

  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const panel = page.locator(".section-panel");
  await expect(panel).toBeVisible();

  await panel.getByRole("radio", { name: "Table", exact: true }).click();
  const columnGroup = panel.locator(".section-axis-group").first();
  const rowGroup = panel.locator(".section-axis-group").nth(1);
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(2);
  await expect(rowGroup.locator(".section-axis-row")).toHaveCount(1);

  await panel.getByRole("button", { name: "Column", exact: true }).click();
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(3);

  await panel.getByRole("button", { name: "Delete section", exact: true }).click();
  const after = await widgets(page);
  expect(after.find((widget) => widget.id === frameId)).toBeUndefined();
  expect(after.find((widget) => widget.id === noteId)!.parentId).toBeNull();

  await page.keyboard.press("Meta+z");
  const restored = await widgets(page);
  expect(restored.find((widget) => widget.id === frameId)).toBeDefined();
  expect(restored.find((widget) => widget.id === noteId)!.parentId).toBe(frameId);
});

test("deleting an axis with objects asks and moves them to a neighbour", async ({ page }) => {
  const account = await register(page, "table-axis-delete");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });
  const noteId = await seedNote(
    page,
    account.boardId,
    { x: 0, y: 0 },
    undefined,
    "Inside",
    frameId,
  );

  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await waitForWidget(page, frameId);
  const frame = (await widgets(page)).find((widget) => widget.id === frameId)!;
  const point = await screenPoint(page, { x: frame.x, y: frame.y - frame.height / 2 + 24 });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([frameId]);

  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const panel = page.locator(".section-panel");
  await panel.getByRole("radio", { name: "Table", exact: true }).click();
  const columnGroup = panel.locator(".section-axis-group").first();
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(2);

  await columnGroup.locator(".section-axis-row").first().click();
  await panel.getByRole("button", { name: "Delete column", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete column");
  await expect(dialog).toContainText("The column holds 1 object");
  await dialog.getByRole("button", { name: /Move to the column on the right/ }).click();

  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(1);
  await expect(columnGroup.locator(".section-axis-row").first()).toHaveAttribute(
    "aria-label",
    /1 object/,
  );
  expect((await widgets(page)).find((widget) => widget.id === noteId)!.parentId).toBe(frameId);

  await page.keyboard.press("Meta+z");
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(2);
});

test("a table header edits its title and opens the axis menu", async ({ page }) => {
  const account = await register(page, "table-header");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });
  const noteId = await seedNote(
    page,
    account.boardId,
    { x: 0, y: 0 },
    undefined,
    "Inside",
    frameId,
  );

  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await waitForWidget(page, frameId);
  const frame = (await widgets(page)).find((widget) => widget.id === frameId)!;
  const point = await screenPoint(page, { x: frame.x, y: frame.y - frame.height / 2 + 24 });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([frameId]);

  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const panel = page.locator(".section-panel");
  await panel.getByRole("radio", { name: "Table", exact: true }).click();
  const columnGroup = panel.locator(".section-axis-group").first();
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(2);

  const firstHeader = page.getByRole("button", { name: "Columns: Column 1" });
  await firstHeader.click();
  await expect(panel.getByLabel("Axis name")).toHaveValue("Column 1");

  await firstHeader.dblclick();
  const editor = page.locator(".table-header-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Now");
  await editor.press("Enter");
  await expect(page.getByRole("button", { name: "Columns: Now" })).toBeVisible();
  await expect(columnGroup.locator(".section-axis-row").first()).toContainText("Now");

  let nowHeader = page.getByRole("button", { name: "Columns: Now" });
  if ((await nowHeader.getAttribute("aria-pressed")) !== "true") await nowHeader.click();
  await nowHeader.click();
  const menu = page.getByRole("menu", { name: /Columns: Now/ });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Insert column right", exact: true }).click();
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(3);

  nowHeader = page.getByRole("button", { name: "Columns: Now" });
  if ((await nowHeader.getAttribute("aria-pressed")) !== "true") await nowHeader.click();
  await nowHeader.click();
  await page
    .getByRole("menu", { name: /Columns: Now/ })
    .getByRole("menuitemcheckbox", { name: "Wide", exact: true })
    .click();
  await expect(panel.getByRole("radio", { name: "Wide", exact: true })).toBeChecked();

  await nowHeader.click();
  await page
    .getByRole("menu", { name: /Columns: Now/ })
    .getByRole("menuitemcheckbox", { name: "Vertical header", exact: true })
    .click();
  await expect(panel.getByRole("checkbox", { name: "Vertical header" })).toBeChecked();

  await nowHeader.click();
  await page
    .getByRole("menu", { name: /Columns: Now/ })
    .getByRole("menuitem", { name: "Delete column", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("The column holds 1 object");
  await dialog.getByRole("button", { name: /Move to the column on the right/ }).click();
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(2);
  expect((await widgets(page)).find((widget) => widget.id === noteId)!.parentId).toBe(frameId);
});


