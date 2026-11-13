import { expect, test, type Page } from "@playwright/test";
import { openBoard, register, seedNote } from "./helpers";

interface ProbeWidget {
  id: string;
  type: string;
  parentId: string | null;
  title?: string;
  text?: string;
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

test("gathers two notes into one section and undoes as one step", async ({ page }) => {
  const account = await register(page, "gather");
  const left = await seedNote(page, account.boardId, { x: -150, y: 0 }, undefined, "Left");
  const right = await seedNote(page, account.boardId, { x: 150, y: 0 }, undefined, "Right");
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));

  const all = await widgets(page);
  const first = all.find((widget) => widget.id === left)!;
  const second = all.find((widget) => widget.id === right)!;
  const firstPoint = await screenPoint(page, { x: first.x, y: first.y });
  const secondPoint = await screenPoint(page, { x: second.x, y: second.y });

  await page.mouse.click(firstPoint.x, firstPoint.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.keyboard.up("Shift");

  // Pointing at the action shows the future section before anything is created.
  const action = page.getByRole("button", { name: "Gather into section" });
  await action.hover();
  await expect(page.locator(".gather-preview")).toBeVisible();
  expect((await widgets(page)).some((widget) => widget.type === "frame")).toBe(false);

  await action.click();
  await expect(page.locator(".gather-preview")).toHaveCount(0);
  const framed = await widgets(page);
  const frame = framed.find((widget) => widget.type === "frame")!;
  expect(frame).toBeDefined();
  expect(frame.text).toBe("Section");
  expect(framed.find((widget) => widget.id === left)!.parentId).toBe(frame.id);
  expect(framed.find((widget) => widget.id === right)!.parentId).toBe(frame.id);
  // The section panel opens with the new section; its View control is the way to
  // turn the gathered material into a table (ADR-196).
  await expect(page.locator(".section-panel")).toBeVisible();
  await expect(
    page.locator(".section-panel").getByRole("radio", { name: "Table", exact: true }),
  ).toBeVisible();

  await page.keyboard.press("Meta+z");
  const undone = await widgets(page);
  expect(undone.some((widget) => widget.type === "frame")).toBe(false);
  expect(undone.find((widget) => widget.id === left)!.parentId).toBeNull();
  expect(undone.find((widget) => widget.id === right)!.parentId).toBeNull();
});
