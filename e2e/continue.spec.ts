import { expect, test, type Page } from "@playwright/test";
import { addSticky, freshBoard, openBoard, register, seedNote } from "./helpers";

interface ProbeWidget {
  id: string;
  type: string;
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

/** World point → client point, the inverse of the canvas transform. */
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

test("the edge + continues a note and the object bar no longer carries it", async ({ page }) => {
  await freshBoard(page, "continue", { template: "empty" });
  await addSticky(page);

  // Four real buttons, one on each side; the old object-bar popover is gone.
  await expect(page.getByRole("button", { name: "Continue to the right" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to the left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue above" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue below" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a connected note" })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue to the right" }).click();
  await expect(page.locator(".inline-editor")).toBeVisible();
  await page.locator(".inline-editor").fill("Second");
  await page.keyboard.press("Escape");

  const all = await widgets(page);
  expect(all.filter((widget) => widget.type === "sticky_note")).toHaveLength(2);
  expect(all.filter((widget) => widget.type === "connector")).toHaveLength(1);

  // The new note is selected, so the four buttons are back and the bar is clean.
  await expect(page.getByRole("button", { name: "Continue to the right" })).toBeVisible();
});

test("an occupied slot offers Connect and Create new", async ({ page }) => {
  const account = await freshBoard(page, "continue-connect", { template: "empty" });
  const sourceId = await addSticky(page);
  const source = (await widgets(page)).find((widget) => widget.id === sourceId)!;

  // Seed a neighbour in the right slot without a line: the slot is occupied, not linked.
  // The default gap is one and a fifth of the note's longer side (settings.notes).
  const gap = Math.max(72, Math.round(Math.max(source.width, source.height) * 1.2));
  await seedNote(
    page,
    account.boardId,
    { x: source.x + source.width + gap, y: source.y },
    { width: source.width, height: source.height },
    "Neighbour",
  );
  // The command is server-side; wait for the client to receive the seeded note.
  await expect
    .poll(async () => (await widgets(page)).filter((widget) => widget.type === "sticky_note").length)
    .toBe(2);

  await page.getByRole("button", { name: "Continue to the right" }).hover();
  const card = page.locator(".edge-continue-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Connect to the existing one");

  await card.getByRole("button", { name: "Connect", exact: true }).click();
  const all = await widgets(page);
  expect(all.filter((widget) => widget.type === "sticky_note")).toHaveLength(2);
  expect(all.filter((widget) => widget.type === "connector")).toHaveLength(1);
});

test("Create new in an occupied, already-linked slot places the copy beyond it", async ({
  page,
}) => {
  await freshBoard(page, "continue-create", { template: "empty" });
  const firstId = await addSticky(page);
  await page.getByRole("button", { name: "Continue to the right" }).click();
  await page.locator(".inline-editor").fill("Second");
  await page.keyboard.press("Escape");
  // Escape closes the editor; a second one clears the selection so Fit frames both
  // notes instead of only the new one.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fit" }).click();
  const first = (await widgets(page)).find((widget) => widget.id === firstId)!;
  const point = await screenPoint(page, { x: first.x, y: first.y });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Continue to the right" }).hover();

  const card = page.locator(".edge-continue-card");
  await expect(card).toContainText("Already connected");
  await card.getByRole("button", { name: "Create new", exact: true }).click();
  await expect(page.locator(".inline-editor")).toBeVisible();
  await page.keyboard.press("Escape");

  const all = await widgets(page);
  const notes = all.filter((widget) => widget.type === "sticky_note");
  expect(notes).toHaveLength(3);
  expect(all.filter((widget) => widget.type === "connector")).toHaveLength(2);
  // The third note is beyond the second, not stacked on it.
  const xs = notes.map((note) => note.x).sort((a, b) => a - b);
  expect(xs[2]! - xs[1]!).toBeGreaterThan(notes[0]!.width);
});

test("the edge plus is the port: it names its action and a drag from it draws a line (ADR-201)", async ({
  page,
}) => {
  const account = await register(page, "plus-port");
  const a = await seedNote(page, account.boardId, { x: -200, y: 0 }, undefined, "A");
  const b = await seedNote(page, account.boardId, { x: 260, y: 0 }, undefined, "B");
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  const all = () =>
    page.evaluate(
      () =>
        (window as unknown as {
          __remo: { widgets: Array<{ id: string; type: string; x: number; y: number; start?: string | null; end?: string | null }>; camera: { x: number; y: number; zoom: number } };
        }).__remo,
    );
  const toClient = async (x: number, y: number) => {
    const probe = await all();
    const rect = (await page.locator(".layer.overlay").boundingBox())!;
    return {
      x: rect.x + rect.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
      y: rect.y + rect.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
    };
  };
  const source = (await all()).widgets.find((widget) => widget.id === a)!;
  const at = await toClient(source.x, source.y);
  await page.mouse.click(at.x, at.y);

  // A free side names what Enter makes and that a drag draws a line.
  await page.getByRole("button", { name: "Continue below", exact: true }).hover();
  await expect(page.locator(".edge-continue-tip")).toContainText("drag for a line");

  const plus = page.getByRole("button", { name: "Continue to the right", exact: true });

  const target = (await all()).widgets.find((widget) => widget.id === b)!;
  const box = (await plus.boundingBox())!;
  const end = await toClient(target.x, target.y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await all()).widgets.some(
        (widget) => widget.type === "connector" && widget.start === a && widget.end === b,
      ),
    )
    .toBe(true);
  // No note was created by the click that followed the drag.
  expect((await all()).widgets.filter((widget) => widget.type === "sticky_note")).toHaveLength(2);
});
