import { test, expect } from "@playwright/test";
import { freshBoard, savedAfterEdit, selectKanbanCard, watchSave } from "./helpers";

test("a card keeps status, assignee and a date range", async ({ page }) => {
  const account = await freshBoard(page, "card-fields");
  const cardId = await selectKanbanCard(page);

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
  await selectKanbanCard(page, cardId);

  const restored = page.locator(".card-fields");
  await expect(restored.locator("select").first()).toHaveValue("in_progress");
  await expect(restored.locator("select").nth(1)).not.toHaveValue("");
  await expect(restored.locator('input[type="date"]').first()).toHaveValue("2026-10-30");
  await expect(restored.locator('input[type="date"]').nth(1)).toHaveValue("2026-10-31");
});

test("selects cards by assignee and due state", async ({ page }) => {
  await freshBoard(page, "card-filter");
  await selectKanbanCard(page);

  const fields = page.locator(".card-fields");
  await fields.locator("select").nth(1).selectOption({ index: 1 });
  await page.locator(".card-filter select").first().selectOption({ index: 1 });
  await page.locator(".card-filter").getByRole("button", { name: "Select cards" }).click();
  await expect(page.locator(".card-filter")).toContainText("Cards found: 1");

  await page.locator(".card-filter select").nth(1).selectOption("none");
  await page.locator(".card-filter").getByRole("button", { name: "Select cards" }).click();
  await expect(page.locator(".card-filter")).toContainText("Cards found: 1");
});
