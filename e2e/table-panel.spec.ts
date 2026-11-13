import { expect, test, type Page } from "@playwright/test";
import { layoutTable, type Widget } from "@remo/model";
import {
  applyDefaultTableLayout,
  openBoard,
  PASSWORD,
  register,
  seedNote,
  seedObject,
  startPresentation,
} from "./helpers";

interface ProbeWidget {
  id: string;
  type: string;
  title?: string | null;
  text?: string | null;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  cell?: { rowId: string; columnId: string } | null;
  layout?: {
    columns?: Array<{ id: string; title: string; size?: string | number }>;
    rows?: Array<{ id: string; title: string; size?: string | number }>;
    spans?: Array<{ rowId: string; columnId: string; rowSpan: number; columnSpan: number }>;
    active?: boolean;
    appearance?: {
      borders?: Record<string, unknown>;
      paddings?: Record<string, unknown>;
    };
  } | null;
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
  await applyDefaultTableLayout(page);
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
  await applyDefaultTableLayout(page);
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
  await applyDefaultTableLayout(page);
  const columnGroup = panel.locator(".section-axis-group").first();
  await expect(columnGroup.locator(".section-axis-row")).toHaveCount(2);

  await columnGroup.locator(".section-axis-row").first().click();
  await panel.getByRole("button", { name: "Delete column", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete column");
  await expect(dialog).toContainText("The column holds 1 object");
  await dialog.getByRole("button", { name: /Move right/ }).click();

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
  await applyDefaultTableLayout(page);
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
    .getByRole("menuitem", { name: /^Size/ })
    .click();
  const sizeDialog = page.getByRole("dialog").filter({ hasText: "Width of column" });
  await expect(sizeDialog).toBeVisible();
  await sizeDialog.getByRole("radio", { name: "Wide", exact: true }).click();
  await expect(panel.locator(".axis-size-anchor").getByRole("button")).toBeVisible();
  await page.keyboard.press("Escape");

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
  await dialog.getByRole("button", { name: /Move right/ }).click();
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
  await expect(live).toContainText("Table 2 × 1.");
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

test("deletes an empty axis without asking about zero objects", async ({ page }) => {
  const { panel } = await openTable(page, "table-empty-axis");
  const rowGroup = panel.locator(".section-axis-group").nth(1);
  await expect(rowGroup.locator(".section-axis-row")).toHaveCount(1);

  await panel.getByRole("button", { name: "Row", exact: true }).click();
  await expect(rowGroup.locator(".section-axis-row")).toHaveCount(2);

  const rowHeader = page.getByRole("button", { name: "Rows: Row 2" });
  if ((await rowHeader.getAttribute("aria-pressed")) !== "true") await rowHeader.click();
  await rowHeader.click();
  await page
    .getByRole("menu", { name: /Rows: Row 2/ })
    .getByRole("menuitem", { name: "Delete row", exact: true })
    .click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowGroup.locator(".section-axis-row")).toHaveCount(1);
});


test("auto size can be turned off and back on", async ({ page }) => {
  const { frameId, noteId } = await openTable(page, "table-auto-size");
  await page.getByRole("button", { name: "Columns: Column 1" }).click();
  const panel = page.locator(".section-panel");
  await panel.locator(".axis-size-anchor").getByRole("button").click();
  const sizeDialog = page.getByRole("dialog").filter({ hasText: "Width of column" });
  await expect(sizeDialog).toBeVisible();
  await sizeDialog.getByText("Manual", { exact: true }).click();
  await page.keyboard.press("Escape");

  const frozen = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!
    .columns![0]!.size;
  expect(typeof frozen).toBe("number");

  const note = (await widgets(page)).find((widget) => widget.id === noteId)!;
  const point = await screenPoint(page, { x: note.x, y: note.y });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Delete");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.columns![0]!.size;
    })
    .toBe(frozen);

  let firstHeader = page.getByRole("button", { name: "Columns: Column 1" });
  if ((await firstHeader.getAttribute("aria-pressed")) !== "true") await firstHeader.click();
  await firstHeader.click();
  await page
    .getByRole("menu", { name: /Columns: Column 1/ })
    .getByRole("menuitem", { name: /^Size/ })
    .click();
  await page
    .getByRole("dialog").filter({ hasText: "Width of column" })
    .getByText("Auto", { exact: true })
    .click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.columns![0]!.size;
    })
    .toBeUndefined();
});


/** The screen point at the centre of one cell, from the same geometry the canvas uses. */
async function cellPoint(page: Page, frameId: string, row: number, column: number) {
  const all = await widgets(page);
  const frame = all.find((widget) => widget.id === frameId)!;
  const grid = layoutTable(frame as unknown as Widget, all as unknown as Widget[])!;
  const rowEntry = grid.rows[row]!;
  const columnEntry = grid.columns[column]!;
  return screenPoint(page, {
    x: columnEntry.x + columnEntry.width / 2,
    y: rowEntry.y + rowEntry.height / 2,
  });
}

test("selects a range, merges it and splits it again", async ({ page }) => {
  const { frameId, panel } = await openTable(page, "table-merge");
  await panel
    .locator(".section-axis-add")
    .getByRole("button", { name: "Row", exact: true })
    .click();

  const first = await cellPoint(page, frameId, 1, 0);
  await page.mouse.click(first.x, first.y);
  const second = await cellPoint(page, frameId, 1, 1);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");

  const bar = page.locator(".table-range-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Merge", exact: true }).click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.spans ?? [];
    })
    .toEqual([{ rowId: expect.any(String), columnId: expect.any(String), rowSpan: 1, columnSpan: 2 }]);

  await page.mouse.click(first.x, first.y);
  await expect(bar.getByRole("button", { name: "Split", exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "Split", exact: true }).click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.spans;
    })
    .toBeUndefined();
});

test("the size popover owns Delete and does not delete the section", async ({ page }) => {
  const { frameId, panel } = await openTable(page, "table-size-guard");
  await page.getByRole("button", { name: "Columns: Column 1" }).click();
  await panel.locator(".axis-size-anchor").getByRole("button").click();
  await expect(page.getByRole("dialog").filter({ hasText: "Width of column" })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await widgets(page)).some((widget) => widget.id === frameId))
    .toBe(true);
});

test("an object inside a cell keeps its own selection", async ({ page }) => {
  const { noteId } = await openTable(page, "table-cell-object");
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
});

test("merge is one undo step", async ({ page }) => {
  const { frameId, panel } = await openTable(page, "table-merge-undo");
  await panel
    .locator(".section-axis-add")
    .getByRole("button", { name: "Row", exact: true })
    .click();
  const first = await cellPoint(page, frameId, 1, 0);
  const second = await cellPoint(page, frameId, 1, 1);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await page.locator(".table-range-bar").getByRole("button", { name: "Merge" }).click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return (layout.spans ?? []).length;
    })
    .toBe(1);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.spans;
    })
    .toBeUndefined();
});

test("the block size switch freezes and releases every axis", async ({ page }) => {
  const { frameId, panel } = await openTable(page, "table-block-size");
  await panel
    .locator(".section-axis-add")
    .getByRole("button", { name: "Row", exact: true })
    .click();
  const first = await cellPoint(page, frameId, 1, 0);
  const second = await cellPoint(page, frameId, 1, 1);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await page.locator(".table-range-bar").getByRole("button", { name: "Merge" }).click();

  const merged = await cellPoint(page, frameId, 1, 0);
  await page.mouse.click(merged.x, merged.y);
  const group = panel.locator(".section-group").filter({ hasText: "Block size" });
  const box = group.getByRole("checkbox");
  await expect(box).toBeVisible();
  await box.click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return [typeof layout.columns![0]!.size, typeof layout.columns![1]!.size];
    })
    .toEqual(["number", "number"]);
  await box.click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return [layout.columns![0]!.size, layout.columns![1]!.size];
    })
    .toEqual([undefined, undefined]);
});


test("the section title edits in place and the badge switches the view", async ({ page }) => {
  const { frameId } = await openTable(page, "table-title");
  const title = page.getByRole("button", { name: "Rename section" });
  await expect(title).toContainText("Section");
  await title.focus();
  await page.keyboard.press("F2");
  const input = page.locator(".section-title-input");
  await expect(input).toBeVisible();
  await input.fill("Stages");
  await input.press("Enter");
  await expect
    .poll(async () => (await widgets(page)).find((widget) => widget.id === frameId)!.text)
    .toBe("Stages");
  await expect(page.getByRole("button", { name: "Rename section" })).toContainText("Stages");

  await page.getByRole("button", { name: "Section view: Table" }).click();
  await page
    .getByRole("menu", { name: "Section view" })
    .getByRole("menuitemcheckbox", { name: "Section", exact: true })
    .click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout;
      return layout?.active;
    })
    .toBe(false);
});

test("removing a table asks in the panel and keeps the objects", async ({ page }) => {
  const { frameId, panel } = await openTable(page, "table-remove");
  await panel.getByRole("button", { name: "Remove table", exact: true }).click();
  const dialog = page.getByRole("alertdialog").filter({ hasText: "Remove the table?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout;
      return layout?.active;
    })
    .not.toBe(false);

  await panel.getByRole("button", { name: "Remove table", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .filter({ hasText: "Remove the table?" })
    .getByRole("button", { name: "Remove table", exact: true })
    .click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout;
      return layout?.active;
    })
    .toBe(false);
});

test("turning a section with material into a table asks how to lay it out", async ({ page }) => {
  const account = await register(page, "table-layout-dialog");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });
  const first = await seedNote(page, account.boardId, { x: -100, y: 0 }, undefined, "One", frameId);
  const second = await seedNote(page, account.boardId, { x: 100, y: 0 }, undefined, "Two", frameId);
  const third = await seedNote(page, account.boardId, { x: 300, y: 0 }, undefined, "Three", frameId);

  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await waitForWidget(page, frameId);
  const frame = (await widgets(page)).find((widget) => widget.id === frameId)!;
  const point = await screenPoint(page, { x: frame.x, y: frame.y - frame.height / 2 + 24 });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const panel = page.locator(".section-panel");
  await panel.getByRole("radio", { name: "Table", exact: true }).click();

  const dialog = page.locator(".section-layout-card");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".section-layout-preview")).toBeVisible();
  await dialog.getByText("Lay out by current position", { exact: true }).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();

  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout;
      return layout?.columns?.length;
    })
    .toBe(2);
  const cells = await Promise.all(
    [first, second, third].map(async (id) =>
      (await widgets(page)).find((widget) => widget.id === id)?.cell?.columnId,
    ),
  );
  const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
  expect(cells).toEqual([
    layout.columns![0]!.id,
    layout.columns![0]!.id,
    layout.columns![1]!.id,
  ]);
});

test("cancelling the layout dialog leaves the section free", async ({ page }) => {
  const account = await register(page, "table-layout-cancel");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });
  await seedNote(page, account.boardId, { x: 0, y: 0 }, undefined, "One", frameId);
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await waitForWidget(page, frameId);
  const frame = (await widgets(page)).find((widget) => widget.id === frameId)!;
  const point = await screenPoint(page, { x: frame.x, y: frame.y - frame.height / 2 + 24 });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page
    .locator(".section-panel")
    .getByRole("radio", { name: "Table", exact: true })
    .click();
  const dialog = page.locator(".section-layout-card");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await widgets(page)).find((widget) => widget.id === frameId)!.layout,
  ).toBeNull();
});


test("borders and padding are edited in the table appearance group", async ({ page }) => {
  const { frameId, panel } = await openTable(page, "table-borders");
  await panel.getByRole("button", { name: "Table appearance", exact: true }).click();
  await panel.getByRole("button", { name: /Borders/, exact: false }).click();
  await panel.getByRole("radio", { name: "2 px", exact: true }).click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.appearance?.borders?.table;
    })
    .toMatchObject({ width: 2, style: "solid" });

  await panel.getByRole("button", { name: /Cell padding/, exact: false }).click();
  await panel.getByRole("radio", { name: "Large", exact: true }).click();
  await expect
    .poll(async () => {
      const layout = (await widgets(page)).find((widget) => widget.id === frameId)!.layout!;
      return layout.appearance?.paddings?.table;
    })
    .toBe(32);
});
