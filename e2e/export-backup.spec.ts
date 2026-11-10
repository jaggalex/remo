import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  addComment,
  addSticky,
  freshBoard,
  openBoard,
  openBoardMenu,
  openComments,
  register,
  seedConnector,
  seedNote,
  seedObject,
} from "./helpers";

test("exports a PNG and downloads and restores a backup with a Cyrillic filename", async ({ page }) => {
  const title = "План «Ёж»";
  const account = await register(page, "export", { title });
  await openBoard(page, account.boardId, { template: "empty" });
  await addSticky(page);
  await openComments(page);
  await addComment(page, "Reviewed before export");
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.locator(".comments-list li")).toHaveCount(0);
  await page.locator(".comments-panel header button").click();

  // A real download, not a mocked canvas: the browser renderer is part of the product.
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page.locator(".export-dialog .export-choice", { hasText: "Whole room" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".export-dialog .share-button").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });

  const dialog = page.locator(".export-dialog");
  await dialog.getByRole("radio", { name: /Room backup/ }).click();
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    dialog.locator(".share-button").click(),
  ]);
  expect(backup.suggestedFilename()).toBe("план-ёж.remo-backup.json");
  const contents = await readFile(await backup.path());
  const bundle = JSON.parse(contents.toString());
  expect(bundle.manifest).toMatchObject({ format: "remo.board.backup", title });
  expect(bundle.comments).toMatchObject([{
    resolvedAt: expect.any(String),
    comments: [{ body: "Reviewed before export" }],
  }]);

  await dialog.locator(".export-import input[type=file]").setInputFiles({
    name: backup.suggestedFilename(),
    mimeType: "application/json",
    buffer: contents,
  });
  await expect(page.locator(".export-import-confirm")).toContainText("Replace the whole room");
  await page.getByRole("button", { name: "Replace the room" }).click();
  await expect(page.locator(".canvas-notice")).toContainText("restored from the backup");
});

test("exports a selection with the line between the selected objects", async ({ page }) => {
  const account = await register(page, "export-selection-line");
  const left = await seedNote(page, account.boardId, { x: -150, y: 0 });
  const right = await seedNote(page, account.boardId, { x: 150, y: 0 });
  const line = await seedConnector(page, account.boardId, left, right);
  await openBoard(page, account.boardId);
  // The board fits itself to the seeded content after load; take the camera once it
  // settles, as gestures.spec.ts does, or the marquee lands on a stale projection.
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);

  // A marquee over the pair: the line comes with it (ADR-138).
  const view = await page.evaluate(() => {
    const probe = (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } })
      .__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
  const toClient = (world: { x: number; y: number }) => ({
    x: view.rect.left + view.rect.width / 2 + (world.x - view.camera.x) * view.camera.zoom,
    y: view.rect.top + view.rect.height / 2 + (world.y - view.camera.y) * view.camera.zoom,
  });
  // Fitted viewport shows ~±255 world units; keep the marquee inside it.
  const corner = toClient({ x: -226, y: -100 });
  const opposite = toClient({ x: 226, y: 100 });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(opposite.x, opposite.y, { steps: 12 });
  await page.mouse.up();

  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toEqual(expect.arrayContaining([left, right, line]));

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page.locator(".export-dialog .export-choice", { hasText: "Selection" }).click();
  await page.locator(".export-dialog .export-choice", { hasText: "PDF" }).click();
  // Two notes and the line: a scope of three objects means the line is in the picture.
  await expect(page.locator(".export-dialog .export-note")).toContainText("3 objects");

  const downloadPromise = page.waitForEvent("download");
  await page.locator(".export-dialog .share-button").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });
});

test("exports a PNG with comment pins and the legend", async ({ page }) => {
  await freshBoard(page, "export-comments");
  await addSticky(page);
  await openComments(page);
  await addComment(page, "Please review this");
  await page.locator(".comments-panel header button").click();

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page.locator(".export-dialog .export-choice", { hasText: "Whole room" }).click();
  await expect(page.locator(".export-comments input")).toBeChecked();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".export-dialog .share-button").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });
});


test("exports a table grid and carries its layout in the backup", async ({ page }) => {
  const account = await register(page, "export-table");
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
  await page.waitForFunction(
    (id) =>
      (window as unknown as { __remo?: { widgets?: Array<{ id: string }> } }).__remo?.widgets?.some(
        (widget) => widget.id === id,
      ),
    frameId,
  );
  const point = await page.evaluate((id) => {
    const probe = (window as unknown as {
      __remo: { widgets: Array<{ id: string; x: number; y: number; height: number }>; camera: { x: number; y: number; zoom: number } };
    }).__remo;
    const frame = probe.widgets.find((widget) => widget.id === id)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (frame.x - probe.camera.x) * probe.camera.zoom,
      y:
        rect.top +
        rect.height / 2 +
        (frame.y - frame.height / 2 + 24 - probe.camera.y) * probe.camera.zoom,
    };
  }, frameId);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    (id) =>
      (window as unknown as { __remo?: { selectedIds?: string[] } }).__remo?.selectedIds?.includes(
        id,
      ),
    frameId,
  );
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.locator(".section-panel").getByRole("radio", { name: "Table", exact: true }).click();
  await expect(page.locator(".section-axis-row")).toHaveCount(3);

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page.locator(".export-dialog .export-choice", { hasText: "Whole room" }).click();
  const pngPromise = page.waitForEvent("download");
  await page.locator(".export-dialog .share-button").click();
  const png = await pngPromise;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const pngBytes = await readFile(await png.path());
  expect(pngBytes.length).toBeGreaterThan(1000);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });

  const dialog = page.locator(".export-dialog");
  await dialog.getByRole("radio", { name: /Room backup/ }).click();
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    dialog.locator(".share-button").click(),
  ]);
  const bundle = JSON.parse((await readFile(await backup.path())).toString());
  expect(bundle.widgets[frameId].layout).toMatchObject({ kind: "table" });
  expect(bundle.widgets[noteId].cell).toEqual(expect.objectContaining({ rowId: expect.any(String) }));
});
