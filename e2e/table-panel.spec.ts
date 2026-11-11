import { expect, test, type Page } from "@playwright/test";
import { openBoard, PASSWORD, register, seedNote, seedObject, startPresentation } from "./helpers";

interface ProbeWidget {
  id: string;
  type: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  cell?: { rowId: string; columnId: string } | null;
  layout?: { columns?: Array<{ id: string; title: string }> } | null;
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

/** A frame with one note inside, opened as a two-column table. */
async function openTable(page: Page, tag: string, second = false) {
  const account = await register(page, tag);
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
  const secondId = second
    ? await seedNote(page, account.boardId, { x: 200, y: 0 }, { width: 80, height: 80 }, "Second", frameId)
    : null;
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
  await expect(panel.locator(".section-axis-row")).toHaveCount(3);
  return { account, frameId, noteId, secondId, panel };
}

/**
 * Move a second note into "Column 2 × Row 1" with the cell command in the panel, so the
 * table has two filled cells: an empty cell is not a presentation step (ADR-201).
 */
async function fillColumnTwo(page: Page, noteId: string, frameId: string) {
  const note = (await widgets(page)).find((widget) => widget.id === noteId)!;
  const point = await screenPoint(page, { x: note.x, y: note.y });
  await page.mouse.click(point.x, point.y);
  const cellPanel = page.locator(".table-cell-panel");
  await expect(cellPanel).toBeVisible();
  await cellPanel.locator("select").selectOption({ label: "Column 2 × Row 1" });
  await cellPanel.getByRole("button", { name: "Move", exact: true }).click();
  await expect
    .poll(async () => {
      const all = await widgets(page);
      const section = all.find((widget) => widget.id === frameId)!;
      return all.find((widget) => widget.id === noteId)?.cell?.columnId === section.layout?.columns?.[1]?.id;
    })
    .toBe(true);
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




test("drops an object into another cell and undoes it in one step", async ({ page }) => {
  const { frameId, noteId } = await openTable(page, "table-drop-cell");
  const mirror = page.locator(".table-mirror table");
  await expect(mirror).toHaveCount(1);
  await expect(mirror.getByRole("columnheader", { name: "Column 1" })).toHaveCount(1);
  await expect(mirror.getByRole("columnheader", { name: "Column 2" })).toHaveCount(1);
  await expect(mirror.getByRole("rowheader", { name: "Row 1" })).toHaveCount(1);
  await expect(mirror.getByRole("cell", { name: /Inside/ })).toHaveCount(1);
  const live = page.locator(".table-mirror[role='status']");
  await expect(live).toContainText("Selected column");
  await page.getByRole("button", { name: "Columns: Column 1" }).click();
  await expect(live).toContainText("Column 1");

  const before = (await widgets(page)).find((widget) => widget.id === noteId)!;
  const header = page.getByRole("button", { name: "Columns: Column 2" });
  const box = (await header.boundingBox())!;
  const from = await screenPoint(page, { x: before.x, y: before.y });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Just under the header: inside the first row at any zoom (the row is as tall as the note).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 12, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const all = await widgets(page);
      const frame = all.find((widget) => widget.id === frameId)!;
      const note = all.find((widget) => widget.id === noteId)!;
      return note.cell?.columnId === frame.layout?.columns?.[1]?.id;
    })
    .toBe(true);

  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const all = await widgets(page);
      const frame = all.find((widget) => widget.id === frameId)!;
      const note = all.find((widget) => widget.id === noteId)!;
      return note.cell?.columnId === frame.layout?.columns?.[0]?.id;
    })
    .toBe(true);
});

test("moves a selected object to a named cell from the panel", async ({ page }) => {
  const { frameId, noteId } = await openTable(page, "table-move-cell");
  const note = (await widgets(page)).find((widget) => widget.id === noteId)!;
  const point = await screenPoint(page, { x: note.x, y: note.y });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([noteId]);

  const cellPanel = page.locator(".table-cell-panel");
  await expect(cellPanel).toBeVisible();
  await cellPanel.locator("select").selectOption({ label: "Column 2 × Row 1" });
  await cellPanel.getByRole("button", { name: "Move", exact: true }).click();

  await expect
    .poll(async () => {
      const all = await widgets(page);
      const frame = all.find((widget) => widget.id === frameId)!;
      const moved = all.find((widget) => widget.id === noteId)!;
      return moved.cell?.columnId === frame.layout?.columns?.[1]?.id;
    })
    .toBe(true);
  await expect(cellPanel.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
});


test("presents a table cell by cell in row order", async ({ page }) => {
  const { frameId, secondId } = await openTable(page, "table-present", true);
  await fillColumnTwo(page, secondId!, frameId);
  await startPresentation(page);
  const panel = page.locator(".presentation-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Start presentation", exact: true }).click();

  const bar = page.locator(".present-bar");
  await expect(bar).toContainText("Slide 1 of 2");
  await expect(bar).toContainText("Column 1 × Row 1");
  await expect(page.locator(".present-cell-focus")).toBeVisible();

  // PageDown pages the presenter's steps; the arrow keys keep panning (ADR-108).
  await page.keyboard.press("PageDown");
  await expect(bar).toContainText("Slide 2 of 2");
  await expect(bar).toContainText("Column 2 × Row 1");
  await expect(page.locator(".present-cell-focus")).toBeVisible();
  await page.keyboard.press("PageUp");
  await expect(bar).toContainText("Slide 1 of 2");

  await bar.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".present-bar")).toHaveCount(0);
  await expect(page.locator(".present-cell-focus")).toHaveCount(0);
});


test("a follower follows the presented cell step", async ({ page, browser }) => {
  const { account, frameId, secondId } = await openTable(page, "table-follow", true);
  await fillColumnTwo(page, secondId!, frameId);
  await startPresentation(page);
  await page
    .locator(".presentation-panel")
    .getByRole("button", { name: "Start presentation", exact: true })
    .click();
  const bar = page.locator(".present-bar");
  await bar.getByRole("button", { name: "Next slide" }).click();
  await expect(bar).toContainText("Column 2 × Row 1");

  const second = await browser.newContext();
  const other = await second.newPage();
  try {
    const login = await other.request.post("/api/auth/login", {
      data: { email: account.email, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    await other.goto(`/?room=${account.boardId}&lang=en`);
    await expect(other.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
    const join = other.locator(".present-join");
    await expect(join).toBeVisible();
    await join.getByRole("button", { name: "Watch", exact: true }).click();
    await expect(other.locator(".present-follow")).toContainText("Column 2 × Row 1");
    await expect(other.locator(".present-cell-focus")).toBeVisible();
  } finally {
    await second.close();
  }
});

test("the section is its table and the table grows from its own edges (ADR-201)", async ({
  page,
}) => {
  const { frameId } = await openTable(page, "table-edges");
  const section = async () => (await widgets(page)).find((widget) => widget.id === frameId)!;
  const before = await section();
  const corner = { x: before.x - before.width / 2, y: before.y - before.height / 2 };

  // "+ Column" at the right edge adds an axis; the section grows from the same corner.
  await page.getByRole("button", { name: "Add a column at the right" }).click();
  await expect.poll(async () => (await section()).width).toBeGreaterThan(before.width);
  const grown = await section();
  expect(grown.x - grown.width / 2).toBeCloseTo(corner.x, 5);
  expect(grown.y - grown.height / 2).toBeCloseTo(corner.y, 5);

  await page.getByRole("button", { name: "Add a row at the bottom" }).click();
  await expect.poll(async () => (await section()).height).toBeGreaterThan(grown.height);

  // A "+" between two headers inserts a column in the middle.
  await page.getByRole("button", { name: /Insert a column between/ }).first().click();
  await expect
    .poll(async () => (await section()).layout?.columns?.length)
    .toBe(4);

  // The note never leaves its cell: it is inside the section, right of the row headers.
  const note = (await widgets(page)).find((widget) => widget.parentId === frameId)!;
  const box = await section();
  expect(note.x - note.width / 2).toBeGreaterThanOrEqual(box.x - box.width / 2 + 128);
  expect(note.x + note.width / 2).toBeLessThanOrEqual(box.x + box.width / 2);
});

test("a header boundary sets a manual width and a double click returns to Auto", async ({
  page,
}) => {
  const { frameId } = await openTable(page, "table-resize");
  const column = () =>
    widgets(page).then(
      (all) =>
        (all.find((widget) => widget.id === frameId)!.layout as {
          columns: Array<{ id: string; size?: unknown }>;
        }).columns[1]!,
    );
  const handle = page.getByRole("separator", { name: /Width of column/ }).nth(1);
  await handle.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => typeof (await column()).size).toBe("number");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator(".table-resize-value")).toContainText("px");
  await page.mouse.up();
  await handle.dblclick();
  await expect.poll(async () => (await column()).size).toBeUndefined();
});
