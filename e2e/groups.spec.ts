import { test, expect, type Page } from "@playwright/test";
import { openBoard, register, savedAfterEdit, seedNote, watchSave } from "./helpers";

interface Point {
  x: number;
  y: number;
}

interface Sticky {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function view(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as {
      __remo: { camera: { x: number; y: number; zoom: number } };
    };
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.__remo.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

function client(
  geometry: Awaited<ReturnType<typeof view>>,
  world: Point,
): Point {
  return {
    x:
      geometry.rect.left +
      geometry.rect.width / 2 +
      (world.x - geometry.camera.x) * geometry.camera.zoom,
    y:
      geometry.rect.top +
      geometry.rect.height / 2 +
      (world.y - geometry.camera.y) * geometry.camera.zoom,
  };
}

async function stickies(page: Page): Promise<Sticky[]> {
  return page.evaluate(() => {
    const probe = window as unknown as {
      __remo: { widgets: Array<Sticky & { type: string }> };
    };
    return probe.__remo.widgets
      .filter((widget) => widget.type === "sticky_note")
      .map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
  });
}

test("a named group keeps its label after reload", async ({ page }) => {
  const account = await register(page, "group-name");
  const firstId = await seedNote(page, account.boardId, { x: -200, y: 0 });
  const secondId = await seedNote(page, account.boardId, { x: 200, y: 0 });
  await openBoard(page, account.boardId);
  await expect
    .poll(async () => (await stickies(page)).length)
    .toBeGreaterThanOrEqual(2);

  const notes = (await stickies(page)).filter(
    (note) => note.id === firstId || note.id === secondId,
  );
  expect(notes.length).toBe(2);

  const geometry = await view(page);
  const a = notes.find((note) => note.id === firstId)!;
  const b = notes.find((note) => note.id === secondId)!;
  // The notes are seeded far apart on an empty board, so a click on each centre
  // selects the pair without meeting the continuation targets on their edges (ADR-195).
  const aPoint = client(geometry, { x: a.x, y: a.y });
  const bPoint = client(geometry, { x: b.x, y: b.y });
  await page.mouse.click(aPoint.x, aPoint.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(bPoint.x, bPoint.y);
  await page.keyboard.up("Shift");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds.length,
      ),
    )
    .toBe(2);

  // Grouping lives on the multi-selection bar in front of the selection (ADR-120);
  // the inspector's button is the same command from the side panel.
  await page.locator(".arrange-bar").getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const field = page.locator(".group-name-field input");
  await watchSave(page);
  await expect(field).toBeVisible();
  await field.fill("Onboarding");
  await field.press("Enter");
  await savedAfterEdit(page);

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __remo: { widgets: Array<{ type: string }> } }).__remo.widgets.filter(
            (widget) => widget.type === "sticky_note",
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(2);

  const after = await stickies(page);
  const target = client(await view(page), { x: after[0]!.x, y: after[0]!.y });
  await page.mouse.click(target.x, target.y);

  await expect(page.locator(".selection-badge")).toContainText("Onboarding");
});
