import { expect, test, type Page } from "@playwright/test";
import { openBoard, register, seedNote } from "./helpers";

/**
 * A port click asks what belongs in the slot the copy would take (ADR-137).
 *
 * The board is seeded through the command API before the browser opens it, so the
 * scenario starts from exact coordinates instead of dragging notes into place. The
 * geometry is read back from the dev probe, the same way the gesture scenarios do.
 */

interface ProbeWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  start: string | null;
  end: string | null;
}

interface View {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

async function view(page: Page): Promise<View> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __remo: { camera: View["camera"] } }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

function toClient(current: View, world: { x: number; y: number }) {
  return {
    x: current.rect.left + current.rect.width / 2 + (world.x - current.camera.x) * current.camera.zoom,
    y: current.rect.top + current.rect.height / 2 + (world.y - current.camera.y) * current.camera.zoom,
  };
}

async function widgets(page: Page): Promise<ProbeWidget[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __remo: {
            widgets: Array<{
              id: string;
              type: string;
              x: number;
              y: number;
              width: number;
              height: number;
              start: string | null;
              end: string | null;
            }>;
          };
        }
      ).__remo.widgets.map((widget) => ({ ...widget })),
  );
}

async function widget(page: Page, id: string): Promise<ProbeWidget> {
  // Save status can settle before the loaded document reaches the canvas probe.
  let found: ProbeWidget | undefined;
  await expect.poll(async () => {
    found = (await widgets(page)).find((entry) => entry.id === id);
    return found;
  }, { message: `seeded widget ${id} reaches the canvas` }).toBeDefined();
  if (!found) throw new Error(`no widget ${id}`);
  return found;
}

async function select(page: Page, target: ProbeWidget): Promise<void> {
  const current = await view(page);
  const point = toClient(current, { x: target.x, y: target.y });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toContain(target.id);
}

/**
 * Click the port of a selected note: since ADR-201 it is the edge "+" itself, one control
 * per side that continues on click and draws a line on drag.
 */
async function clickPort(
  page: Page,
  _target: ProbeWidget,
  side: "left" | "right" | "top" | "bottom",
): Promise<void> {
  const name =
    side === "left"
      ? "Continue to the left"
      : side === "right"
        ? "Continue to the right"
        : side === "top"
          ? "Continue above"
          : "Continue below";
  await page.getByRole("button", { name, exact: true }).click();
}

async function selectedType(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const probe = window as unknown as {
      __remo: { selectedIds: string[]; widgets: Array<{ id: string; type: string }> };
    };
    const id = probe.__remo.selectedIds[0];
    return probe.__remo.widgets.find((widget) => widget.id === id)?.type ?? null;
  });
}

test("a port click into an empty slot grows the copy", async ({ page }) => {
  const account = await register(page, "port-clone");
  const only = await seedNote(page, account.boardId, { x: 0, y: 0 });
  await openBoard(page, account.boardId);

  const source = await widget(page, only);
  await select(page, source);
  await clickPort(page, source, "right");

  await expect.poll(async () => (await widgets(page)).length).toBe(3); // note + copy + line
  const rows = await widgets(page);
  expect(rows.filter((row) => row.type === "sticky_note")).toHaveLength(2);
  expect(rows.filter((row) => row.type === "connector")).toHaveLength(1);
});

test("a port click into a taken slot joins the objects instead of copying", async ({ page }) => {
  const account = await register(page, "port-connect");
  const sourceId = await seedNote(page, account.boardId, { x: 0, y: 0 });
  // Default gap for a 160×180 note is max(72, round(180 × 1.2)) = 216, so the copy's
  // centre is 160 + 216 to the right.
  const targetId = await seedNote(page, account.boardId, { x: 376, y: 0 });
  await openBoard(page, account.boardId);

  const source = await widget(page, sourceId);
  await select(page, source);
  await clickPort(page, source, "right");

  await expect.poll(async () => (await widgets(page)).filter((row) => row.type === "connector").length).toBe(1);
  const rows = await widgets(page);
  expect(rows.filter((row) => row.type === "sticky_note")).toHaveLength(2);
  const line = rows.find((row) => row.type === "connector")!;
  expect(line.start).toBe(sourceId);
  expect(line.end).toBe(targetId);
  // The new line is selected; no copy was made and no camera move is needed.
  expect(await selectedType(page)).toBe("connector");

  // A second click on the same port adds nothing: the pair already has a line.
  const again = await widget(page, sourceId);
  await select(page, again);
  await clickPort(page, again, "right");
  await expect.poll(async () => (await widgets(page)).filter((row) => row.type === "connector").length).toBe(1);
  expect((await widgets(page)).filter((row) => row.type === "sticky_note")).toHaveLength(2);
});

test("undo removes the connector the port click made in one step", async ({ page }) => {
  const account = await register(page, "port-undo");
  const sourceId = await seedNote(page, account.boardId, { x: 0, y: 0 });
  await seedNote(page, account.boardId, { x: 376, y: 0 });
  await openBoard(page, account.boardId);

  const source = await widget(page, sourceId);
  await select(page, source);
  await clickPort(page, source, "right");
  await expect.poll(async () => (await widgets(page)).filter((row) => row.type === "connector").length).toBe(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await widgets(page)).filter((row) => row.type === "connector").length).toBe(0);
  expect((await widgets(page)).filter((row) => row.type === "sticky_note")).toHaveLength(2);
});
