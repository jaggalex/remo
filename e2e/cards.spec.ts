import { test, expect, type Page } from "@playwright/test";
import { freshBoard, savedAfterEdit, watchSave } from "./helpers";

/** Click a card in the seeded kanban through the dev probe, and return its id. */
async function selectCard(page: Page, cardId?: string): Promise<string> {
  // After a reload the document arrives over the socket; the probe is empty until then.
  await page.waitForFunction(() => {
    const probe = window as unknown as {
      __remo?: { layouts: Array<{ placements: unknown[] }> };
    };
    return Boolean(probe.__remo?.layouts?.some((entry) => entry.placements.length > 0));
  });
  const point = await page.evaluate((wanted) => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{
          placements: Array<{ cardId: string; x: number; y: number }>;
        }>;
      };
    };
    const layout = probe.__remo.layouts.find((entry) => entry.placements.length > 0)!;
    const placement = wanted
      ? layout.placements.find((entry) => entry.cardId === wanted)
      : layout.placements[0];
    if (!placement) return null;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (placement.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (placement.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  }, cardId);
  if (!point) throw new Error("card not found");
  await page.mouse.click(point.x, point.y);
  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );
  return selected;
}

test("a card keeps status, assignee and a date range", async ({ page }) => {
  const account = await freshBoard(page, "card-fields");
  const cardId = await selectCard(page);

  const inspector = page.locator(".card-fields");
  await expect(inspector).toBeVisible();
  await watchSave(page);

  await inspector.locator("select").first().selectOption("in_progress");
  const assignee = inspector.locator("select").nth(1);
  await expect(assignee.locator("option")).toHaveCount(2);
  await assignee.selectOption({ index: 1 });
  await inspector.locator('input[type="date"]').first().fill("2026-10-30");
  await inspector.locator('input[type="date"]').nth(1).fill("2026-10-31");
  await expect(inspector.locator("select").first()).toHaveValue("in_progress");
  await savedAfterEdit(page);
  // The projection is a server-side mirror; waiting for it proves the edit reached
  // the service before the reload, not only the local Yjs copy.
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/boards/${account.boardId}/widgets`);
      const data = (await response.json()) as {
        widgets?: Array<{ id: string; props?: { status?: string } }>;
      };
      return data.widgets?.find((widget) => widget.id === cardId)?.props?.status;
    })
    .toBe("in_progress");

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await selectCard(page, cardId);

  const restored = page.locator(".card-fields");
  await expect(restored.locator("select").first()).toHaveValue("in_progress");
  await expect(restored.locator("select").nth(1)).not.toHaveValue("");
  await expect(restored.locator('input[type="date"]').first()).toHaveValue("2026-10-30");
  await expect(restored.locator('input[type="date"]').nth(1)).toHaveValue("2026-10-31");
});

test("selects cards by assignee and due state", async ({ page }) => {
  await freshBoard(page, "card-filter");
  await selectCard(page);

  const fields = page.locator(".card-fields");
  await fields.locator("select").nth(1).selectOption({ index: 1 });
  await page.locator(".card-filter select").first().selectOption({ index: 1 });
  await page.locator(".card-filter").getByRole("button", { name: "Select cards" }).click();
  await expect(page.locator(".card-filter")).toContainText("Cards found: 1");

  await page.locator(".card-filter select").nth(1).selectOption("none");
  await page.locator(".card-filter").getByRole("button", { name: "Select cards" }).click();
  await expect(page.locator(".card-filter")).toContainText("Cards found: 1");
});
