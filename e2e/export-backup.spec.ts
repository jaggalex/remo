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
} from "./helpers";

test("exports a PNG and restores the board from the same backup", async ({ page }) => {
  const account = await freshBoard(page, "export");
  await addSticky(page);

  const backup = await page.request.get(`/api/boards/${account.boardId}/backup`);
  expect(backup.ok()).toBeTruthy();
  const bundle = await backup.json();
  expect(bundle.manifest.format).toBe("remo.board.backup");

  // A real download, not a mocked canvas: the browser renderer is part of the product.
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page.locator(".export-dialog .export-choice", { hasText: "Whole room" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".export-dialog .share-button").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });

  const input = page.locator(".export-import input[type=file]");
  await input.setInputFiles({
    name: "board.remo-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bundle)),
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
