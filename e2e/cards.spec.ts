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

  // The filter belongs to the room: it is in the panel with nothing selected (ADR-236),
  // and what it finds becomes the selection.
  const selected = () =>
    page.evaluate(() => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds.length);
  await page.keyboard.press("Escape");
  await expect.poll(selected).toBe(0);
  const filter = page.locator(".card-filter");
  await filter.locator("select").first().selectOption({ index: 1 });
  await filter.getByRole("button", { name: "Select cards" }).click();
  await expect.poll(selected).toBe(1);
  await expect(filter).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect.poll(selected).toBe(0);
  await filter.locator("select").first().selectOption({ index: 1 });
  await filter.locator("select").nth(1).selectOption("none");
  await filter.getByRole("button", { name: "Select cards" }).click();
  await expect.poll(selected).toBe(1);
});

test("the empty-cell plus adds a card and focuses its editor", async ({ page }) => {
  await freshBoard(page, "kanban-plus");
  const point = await page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{
          padding: number;
          columns: Array<{ id: string; left: number }>;
          lanes: Array<{ id: string; centerY: number }>;
          placements: Array<{ columnId: string; swimlaneId: string }>;
        }>;
      };
    };
    const layout = probe.__remo.layouts.find(
      (entry) => entry.columns.length > 0 && entry.lanes.length > 0,
    )!;
    const occupied = new Set(
      layout.placements.map((placement) => `${placement.columnId}|${placement.swimlaneId}`),
    );
    const column = layout.columns.find((candidate) =>
      layout.lanes.some((lane) => !occupied.has(`${candidate.id}|${lane.id}`)),
    )!;
    const lane = layout.lanes.find((candidate) => !occupied.has(`${column.id}|${candidate.id}`))!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    const x = column.left + layout.padding + 16;
    const y = lane.centerY;
    return {
      x: rect.left + rect.width / 2 + (x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  });

  const camera = () =>
    page.evaluate(() => (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } }).__remo.camera);
  const before = await camera();
  await page.mouse.click(point.x, point.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  // The view stays where the person clicked: the card was in sight, so nothing pans.
  // A new card is stored at (0, 0), and reading that used to pan to the room's middle.
  await page.waitForTimeout(200);
  expect(await camera()).toEqual(before);
  // The editor opens where the plus was, and its edge is its only frame: no focus ring.
  const box = (await editor.boundingBox())!;
  expect(Math.abs(box.x - point.x)).toBeLessThan(40);
  expect(await editor.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  await page.keyboard.type("New card");
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as {
            __remo: { widgets: Array<{ type: string; text: string }> };
          }).__remo.widgets.some(
            (widget) => widget.type === "card" && widget.text === "New card",
          ),
      ),
    )
    .toBe(true);
});

test("a full cell makes its lane and the kanban taller instead of overlapping (ADR-240)", async ({ page }) => {
  await freshBoard(page, "kanban-full-cell");
  type Probe = {
    __remo: {
      camera: { x: number; y: number; zoom: number };
      widgets: Array<{ id: string; type: string; height: number }>;
      layouts: Array<{
        id: string;
        padding: number;
        laneStrip: number;
        columns: Array<{ id: string; left: number; width: number }>;
        lanes: Array<{ id: string; top: number; height: number }>;
        placements: Array<{ swimlaneId: string; y: number; height: number }>;
      }>;
    };
  };
  const read = () =>
    page.evaluate(() => {
      const probe = (window as unknown as Probe).__remo;
      const layout = probe.layouts.find((entry) => entry.lanes.length > 1)!;
      const kanban = probe.widgets.find((widget) => widget.id === layout.id)!;
      return { layout, kanbanHeight: kanban.height, camera: probe.camera };
    });

  const before = await read();
  // The template's lanes have titles, so the first column sits beside their strip.
  expect(before.layout.laneStrip).toBeGreaterThan(0);

  // Six cards into one cell, each by a double-click in the empty space under the others.
  for (let i = 0; i < 6; i += 1) {
    const point = await page.evaluate(() => {
      const probe = (window as unknown as Probe).__remo;
      const layout = probe.layouts.find((entry) => entry.lanes.length > 1)!;
      const column = layout.columns[0]!;
      const lane = layout.lanes[0]!;
      const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
      const x = column.left + column.width / 2;
      const y = lane.top + lane.height - 8;
      return {
        x: canvas.left + canvas.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
        y: canvas.top + canvas.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
      };
    });
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.locator(".inline-editor")).toBeFocused();
    await page.keyboard.type(`Card ${i}`);
    await page.keyboard.press("Escape");
    await expect(page.locator(".inline-editor")).toHaveCount(0);
    // Clear the selection too: a selected card shows its "continue" handles below it,
    // exactly where the next double-click goes.
    await page.keyboard.press("Escape");
  }

  const after = await read();
  const [first, second] = after.layout.lanes;
  // Lanes follow one another; every card stays inside its own lane.
  expect(second!.top).toBeCloseTo(first!.top + first!.height, 3);
  for (const placement of after.layout.placements) {
    const lane = after.layout.lanes.find((entry) => entry.id === placement.swimlaneId)!;
    expect(placement.y - placement.height / 2).toBeGreaterThanOrEqual(lane.top - 0.5);
    expect(placement.y + placement.height / 2).toBeLessThanOrEqual(lane.top + lane.height + 0.5);
  }
  // The kanban grew to hold them.
  expect(after.kanbanHeight).toBeGreaterThan(before.kanbanHeight);
  // And the section around it grew with it, so it still holds the kanban (ADR-243).
  const held = await page.evaluate(() => {
    const widgets = (window as unknown as {
      __remo: { widgets: Array<{ id: string; type: string; parentId: string | null; y: number; height: number }> };
    }).__remo.widgets;
    const kanban = widgets.find((widget) => widget.type === "kanban")!;
    const section = widgets.find((widget) => widget.id === kanban.parentId);
    return section
      ? { kanbanBottom: kanban.y + kanban.height / 2, sectionBottom: section.y + section.height / 2 }
      : null;
  });
  expect(held, "the template puts the kanban in a section").not.toBeNull();
  expect(held!.sectionBottom).toBeGreaterThanOrEqual(held!.kanbanBottom);
});

test("a card dragged above another in its cell takes its place", async ({ page }) => {
  await freshBoard(page, "kanban-reorder");
  type Placement = { cardId: string; columnId: string; swimlaneId: string; x: number; y: number; height: number };
  const cellCards = () =>
    page.evaluate(() => {
      const probe = (window as unknown as {
        __remo: { layouts: Array<{ placements: Placement[] }> };
      }).__remo;
      const placements = probe.layouts.find((layout) => layout.placements.length > 1)!.placements;
      const first = placements[0]!;
      return placements
        .filter((p) => p.columnId === first.columnId && p.swimlaneId === first.swimlaneId)
        .sort((a, b) => a.y - b.y);
    });
  const toClient = (point: { x: number; y: number }) =>
    page.evaluate((world) => {
      const probe = (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } }).__remo;
      const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 + (world.x - probe.camera.x) * probe.camera.zoom,
        y: rect.top + rect.height / 2 + (world.y - probe.camera.y) * probe.camera.zoom,
      };
    }, point);

  const before = await cellCards();
  expect(before.length).toBeGreaterThanOrEqual(2);
  const [top, second] = before;
  const from = await toClient({ x: second!.x, y: second!.y });
  // Into the upper half of the first card: the drop line goes above it.
  const to = await toClient({ x: top!.x, y: top!.y - top!.height / 4 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await cellCards()).map((p) => p.cardId))
    .toEqual([second!.cardId, top!.cardId, ...before.slice(2).map((p) => p.cardId)]);

  // One undo puts the order back.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await cellCards()).map((p) => p.cardId)).toEqual(before.map((p) => p.cardId));
});

test("a column's stripe takes a colour from its menu", async ({ page }) => {
  await freshBoard(page, "kanban-stripe");
  const header = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{ id: string; top: number; headerHeight: number; columns: Array<{ id: string; centerX: number }> }>;
      };
    }).__remo;
    const layout = probe.layouts.find((entry) => entry.columns.length > 0)!;
    const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
    const world = { x: layout.columns[0]!.centerX, y: layout.top + layout.headerHeight * 0.42 };
    return {
      x: rect.left + rect.width / 2 + (world.x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (world.y - probe.camera.y) * probe.camera.zoom,
      kanbanId: layout.id,
      columnId: layout.columns[0]!.id,
    };
  });
  await page.mouse.click(header.x, header.y, { button: "right" });
  const stripe = page.getByRole("group", { name: "Stripe colour" });
  await expect(stripe.getByRole("menuitemradio")).toHaveCount(14);
  await stripe.getByRole("menuitemradio", { name: "Deep blue" }).click();

  await expect
    .poll(() =>
      page.evaluate(
        ({ kanbanId, columnId }) =>
          (window as unknown as {
            __remo: { layouts: Array<{ id: string; columns: Array<{ id: string; accent: string }> }> };
          }).__remo.layouts
            .find((layout) => layout.id === kanbanId)
            ?.columns.find((column) => column.id === columnId)?.accent ?? null,
        { kanbanId: header.kanbanId, columnId: header.columnId },
      ),
    )
    .toBe("#1a6ad8");

  // The menu shows the colour it has now.
  await page.mouse.click(header.x, header.y, { button: "right" });
  await expect(
    page.getByRole("group", { name: "Stripe colour" }).getByRole("menuitemradio", { name: "Deep blue" }),
  ).toHaveAttribute("aria-checked", "true");
});

/** World → client for the canvas, the same inverse the handlers use. */
async function kanbanTitles(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{
          id: string;
          left: number;
          top: number;
          headerHeight: number;
          padding: number;
          columns: Array<{ id: string; title: string; left: number; width: number; centerX: number }>;
          lanes: Array<{ id: string; title: string; top: number; height: number; centerY: number }>;
        }>;
      };
    }).__remo;
    const layout = probe.layouts.find((entry) => entry.columns.length > 1 && entry.lanes.length > 1)!;
    const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
    const toClient = (x: number, y: number) => ({
      x: rect.left + rect.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
    });
    const titleY = layout.top + layout.headerHeight * 0.42;
    return {
      columns: layout.columns.map((c) => ({ id: c.id, title: c.title, at: toClient(c.left + layout.padding + 8, titleY), right: toClient(c.left + c.width - 4, titleY) })),
      lanes: layout.lanes.map((l) => ({ id: l.id, title: l.title, at: toClient(layout.left + layout.padding + 8, l.top + 30), bottom: toClient(layout.left + layout.padding + 8, l.top + l.height - 6) })),
    };
  });
}

test("a column is renamed on the kanban, by double click and from its menu (ADR-244)", async ({ page }) => {
  await freshBoard(page, "kanban-rename");
  const before = await kanbanTitles(page);
  const first = before.columns[0]!;

  await page.mouse.dblclick(first.at.x, first.at.y);
  const field = page.locator(".kanban-title-editor");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(first.title);
  await field.fill("Ideas");
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect.poll(async () => (await kanbanTitles(page)).columns[0]!.title).toBe("Ideas");

  // Escape keeps the title.
  await page.mouse.dblclick(first.at.x, first.at.y);
  await field.fill("Discarded");
  await field.press("Escape");
  await expect.poll(async () => (await kanbanTitles(page)).columns[0]!.title).toBe("Ideas");

  // The menu opens the same field on the kanban, not one of its own.
  await page.mouse.click(first.at.x, first.at.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Rename column" }).click();
  await expect(field).toBeFocused();
  await field.fill("Later");
  await field.press("Enter");
  await expect.poll(async () => (await kanbanTitles(page)).columns[0]!.title).toBe("Later");
});

test("columns and lanes are reordered by dragging their titles (ADR-244)", async ({ page }) => {
  await freshBoard(page, "kanban-reorder-axes");
  const before = await kanbanTitles(page);
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  };

  // The first column's title, dropped past the second column's middle.
  await drag(before.columns[0]!.at, before.columns[1]!.right);
  await expect
    .poll(async () => (await kanbanTitles(page)).columns.map((c) => c.id))
    .toEqual([before.columns[1]!.id, before.columns[0]!.id, ...before.columns.slice(2).map((c) => c.id)]);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await kanbanTitles(page)).columns.map((c) => c.id)).toEqual(before.columns.map((c) => c.id));

  // The first lane's title, dropped at the bottom of the second lane.
  await drag(before.lanes[0]!.at, before.lanes[1]!.bottom);
  await expect
    .poll(async () => (await kanbanTitles(page)).lanes.map((l) => l.id))
    .toEqual([before.lanes[1]!.id, before.lanes[0]!.id, ...before.lanes.slice(2).map((l) => l.id)]);

  // The rest of the header band still moves the kanban, not a column.
  const kanbanX = () =>
    page.evaluate(
      () => (window as unknown as { __remo: { widgets: Array<{ type: string; x: number }> } }).__remo.widgets.find((w) => w.type === "kanban")!.x,
    );
  const x0 = await kanbanX();
  const band = before.columns[0]!.right;
  await drag(band, { x: band.x + 60, y: band.y });
  await expect.poll(kanbanX).not.toBe(x0);
});
