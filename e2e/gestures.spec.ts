import { expect, test, type Page } from "@playwright/test";
import { addSticky, freshBoard, openBoard, register, seedConnector, seedNote } from "./helpers";

/**
 * The pointer state machine in a real browser (ADR-059).
 *
 * The canvas has no DOM nodes to target, so these scenarios drive the mouse through the
 * same events a person produces and read the result from the dev probe: what moved, what
 * got selected, what the resize did. A refactor of the gesture code has to keep this green.
 */
interface Geometry {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

/** `x`/`y` are the widget's centre: a box is x ± width/2 (see `boxOf`). */
interface ProbeWidget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __remo: { camera: Geometry["camera"] } }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

/** World point → client point, the inverse of what the handlers do. */
function toClient(geometry: Geometry, world: { x: number; y: number }) {
  return {
    x: geometry.rect.left + geometry.rect.width / 2 + (world.x - geometry.camera.x) * geometry.camera.zoom,
    y: geometry.rect.top + geometry.rect.height / 2 + (world.y - geometry.camera.y) * geometry.camera.zoom,
  };
}

/**
 * The note this scenario added.
 *
 * A fresh board is seeded from a template, so `widgets[0]` is the template's frame, not
 * the note: the note is found by kind.
 */
async function note(page: Page): Promise<ProbeWidget> {
  const found = await page.evaluate(() => {
    const probe = (window as unknown as { __remo: { widgets: Array<ProbeWidget & { type: string }> } })
      .__remo;
    const sticky = probe.widgets.find((widget) => widget.type === "sticky_note");
    if (!sticky) throw new Error("no sticky note on the board");
    return {
      id: sticky.id,
      x: sticky.x,
      y: sticky.y,
      width: sticky.width,
      height: sticky.height,
    };
  });
  return found;
}

/** The one shape on the board, with the fields a resize must leave alone. */
interface ProbeShape extends ProbeWidget {
  text?: string;
  shapeKind?: string;
  style?: { fontSize?: number; fillColor?: string; strokeColor?: string };
}

async function shape(page: Page): Promise<ProbeShape> {
  const found = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: { widgets: Array<Record<string, unknown> & { type: string }> };
    }).__remo;
    const one = probe.widgets.find((widget) => widget.type === "shape");
    if (!one) throw new Error("no shape on the board");
    return {
      id: one.id as string,
      x: one.x as number,
      y: one.y as number,
      width: one.width as number,
      height: one.height as number,
      text: one.text as string | undefined,
      shapeKind: one.shapeKind as string | undefined,
      style: one.style as ProbeShape["style"],
    };
  });
  return found;
}

test("dragging a note moves it, and undo puts it back", async ({ page }) => {
  await freshBoard(page, "gesture-drag");
  await addSticky(page);

  const before = await note(page);
  const view = await geometry(page);
  const centre = toClient(view, { x: before.x, y: before.y });

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 120, centre.y + 80, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const moved = await note(page);
  const zoom = view.camera.zoom;
  // Alignment guides may snap the drop by a few world units, so the move is "about"
  // the drag rather than exact to the pixel.
  expect(Math.abs(moved.x - before.x - 120 / zoom)).toBeLessThan(30);
  expect(Math.abs(moved.y - before.y - 80 / zoom)).toBeLessThan(30);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  const undone = await note(page);
  expect(Math.round(undone.x)).toBe(Math.round(before.x));
  expect(Math.round(undone.y)).toBe(Math.round(before.y));
});

test("a marquee selects the note it covers", async ({ page }) => {
  await freshBoard(page, "gesture-marquee");
  await addSticky(page);

  const target = await note(page);
  const view = await geometry(page);
  const corner = toClient(view, {
    x: target.x - target.width / 2 - 120,
    y: target.y - target.height / 2 - 120,
  });
  const opposite = toClient(view, {
    x: target.x + target.width / 2 + 120,
    y: target.y + target.height / 2 + 120,
  });

  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(opposite.x, opposite.y, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator(".selection-badge")).toBeVisible();
  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toContain(target.id);
});

test("a marquee takes the line between the notes it covers", async ({ page }) => {
  const account = await register(page, "gesture-marquee-line");
  const left = await seedNote(page, account.boardId, { x: -150, y: 0 });
  const right = await seedNote(page, account.boardId, { x: 150, y: 0 });
  const line = await seedConnector(page, account.boardId, left, right);
  await openBoard(page, account.boardId);
  // The board fits itself to the seeded content after load; take the camera once it settles.
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);

  const view = await geometry(page);
  // A rectangle with a margin of 60 world units around both notes: it crosses the line
  // twice without covering either end on its own.
  // Keep the rectangle inside the fitted viewport: the auto-fit shows ~±255 world units,
  // and a corner beyond that would land outside the canvas.
  const corner = toClient(view, { x: -226, y: -100 });
  const opposite = toClient(view, { x: 245, y: 105 });

  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(opposite.x, opposite.y, { steps: 12 });
  await page.mouse.up();

  // Both notes and the line: a line joins a selection only with both ends (ADR-138).
  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toEqual(expect.arrayContaining([left, right, line]));

  // One object alone does not carry the line: clear, click a note, and the line stays out.
  // Above both notes but still inside the canvas: at this zoom the old point landed
  // under the top bar, where a click never reaches the pointer handlers.
  const empty = toClient(view, { x: 0, y: -100 });
  await page.mouse.click(empty.x, empty.y);
  const centre = toClient(view, { x: -150, y: 0 });
  await page.mouse.click(centre.x, centre.y);
  const alone = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(alone).toEqual([left]);
});

test("resizing from the corner grows the note", async ({ page }) => {
  await freshBoard(page, "gesture-resize");
  await addSticky(page);

  const before = await note(page);
  const view = await geometry(page);
  const centre = toClient(view, { x: before.x, y: before.y });
  await page.mouse.click(centre.x, centre.y);
  await expect(page.locator(".selection-badge")).toBeVisible();

  const corner = toClient(view, {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const after = await note(page);
  const zoom = view.camera.zoom;
  expect(after.width).toBeGreaterThan(before.width + 40 / zoom);
  expect(after.height).toBeGreaterThan(before.height + 20 / zoom);
});

test("a shape resizes like a note, its text reflows and one undo puts it back (ADR-145)", async ({
  page,
}) => {
  await freshBoard(page, "gesture-shape-resize");
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();

  const before = await shape(page);
  const view = await geometry(page);
  const centre = toClient(view, { x: before.x, y: before.y });

  // A shape holds text like a note; give it some before the box changes.
  await page.mouse.dblclick(centre.x, centre.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Shape label");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  // Select it alone, so the four corner handles appear (kindOf().resizable).
  await page.mouse.click(centre.x, centre.y);
  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toEqual([before.id]);

  const current = await shape(page);
  const gap = 7 / view.camera.zoom;
  const se = toClient(view, {
    x: current.x + current.width / 2 + gap,
    y: current.y + current.height / 2 + gap,
  });
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(se.x + 140 / view.camera.zoom, se.y + 90 / view.camera.zoom, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const grown = await shape(page);
  expect(grown.width).toBeGreaterThan(current.width + 100);
  expect(grown.height).toBeGreaterThan(current.height + 60);
  // The box is the only thing that changed: the text is still there and still Auto
  // (no written font size), and the shape keeps its kind and style.
  expect(grown.text).toBe("Shape label");
  expect(grown.shapeKind).toBe(current.shapeKind);
  expect(grown.style).toEqual(current.style);
  expect(grown.style?.fontSize).toBeUndefined();

  // The box selection, handles and ports all read is the new one: a point just below
  // the old bottom edge is inside the grown shape and now selects it.
  const reach = toClient(view, {
    x: current.x,
    y: current.y + current.height / 2 + 15,
  });
  await page.mouse.click(reach.x, reach.y);
  const stillSelected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(stillSelected).toEqual([before.id]);

  // One gesture, one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  const undone = await shape(page);
  expect(undone).toMatchObject({
    x: current.x,
    y: current.y,
    width: current.width,
    height: current.height,
    text: "Shape label",
  });
});

test("a frame resizes around its contents and shrinks before releasing them (ADR-141)", async ({
  page,
}) => {
  const account = await register(page, "gesture-frame-resize");
  // Two far notes make the initial fit zoom out, so the 640 × 420 frame the rail
  // creates is fully inside the viewport and every corner is reachable.
  await seedNote(page, account.boardId, { x: -1000, y: 0 });
  await seedNote(page, account.boardId, { x: 1000, y: 0 });
  const childId = await seedNote(page, account.boardId, { x: 0, y: 0 });
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);

  // A frame from the rail lands near the middle of the view.
  await page.getByRole("toolbar", { name: "Tools" })
    .getByRole("button", { name: "Frame", exact: true })
    .click();
  const frameId = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );

  interface ProbeWidget {
    id: string;
    type: string;
    parentId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  const widget = (id: string) =>
    page.evaluate((wanted) => {
      const list = (window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets;
      return list.find((entry) => entry.id === wanted) ?? null;
    }, id);

  const frameBefore = (await widget(frameId))!;
  const view = await geometry(page);
  const child = (await widget(childId))!;

  // Drop the note into the frame: membership follows the centre (ADR-110).
  const from = toClient(view, { x: child.x, y: child.y });
  const to = toClient(view, { x: frameBefore.x, y: frameBefore.y });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  expect((await widget(childId))!.parentId).toBe(frameId);
  // Its place after the drop is the baseline the resize must not disturb.
  const placed = (await widget(childId))!;

  // Select the frame itself on an empty point of its plate. The bottom-left stays
  // clear of the floating bar above the selected note (and of its own handles).
  const inside = toClient(view, {
    x: frameBefore.x - frameBefore.width / 2 + 30,
    y: frameBefore.y + frameBefore.height / 2 - 30,
  });
  await page.mouse.click(inside.x, inside.y);
  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toEqual([frameId]);

  const gap = 7 / view.camera.zoom;
  const se = toClient(view, {
    x: frameBefore.x + frameBefore.width / 2 + gap,
    y: frameBefore.y + frameBefore.height / 2 + gap,
  });
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(
    se.x + 200 / view.camera.zoom,
    se.y + 140 / view.camera.zoom,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const grown = (await widget(frameId))!;
  const childAfterGrow = (await widget(childId))!;
  expect(grown.width).toBeGreaterThan(frameBefore.width + 150);
  expect(grown.height).toBeGreaterThan(frameBefore.height + 100);
  // The child keeps its size and place; only the frame's box changed.
  expect(childAfterGrow).toMatchObject({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    parentId: frameId,
  });

  // Shrink past the child's centre: it is released, still without moving.
  const grownSe = toClient(view, {
    x: grown.x + grown.width / 2 + gap,
    y: grown.y + grown.height / 2 + gap,
  });
  const release = toClient(view, { x: placed.x - 20, y: grown.y + grown.height / 2 + gap });
  await page.mouse.move(grownSe.x, grownSe.y);
  await page.mouse.down();
  await page.mouse.move(release.x, release.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const shrunk = (await widget(frameId))!;
  expect(shrunk.width).toBeLessThan(grown.width);
  expect((await widget(childId))!).toMatchObject({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    parentId: null,
  });

  // One gesture, one undo step: the box and the release go back together.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  expect(await widget(frameId)).toMatchObject({
    x: grown.x,
    y: grown.y,
    width: grown.width,
    height: grown.height,
  });
  expect(await widget(childId)).toMatchObject({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    parentId: frameId,
  });
});

test("double-click opens the note for editing", async ({ page }) => {
  await freshBoard(page, "gesture-edit");
  await addSticky(page);

  const target = await note(page);
  const view = await geometry(page);
  const centre = toClient(view, { x: target.x, y: target.y });

  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.locator(".inline-editor")).toBeVisible();
});

/**
 * A selection of many objects resizes as one box (ADR-211).
 *
 * Three notes, one gesture: every centre is mapped through the same factor, so the
 * gaps keep their proportion, and one undo brings all three back.
 */
test("a block of notes resizes as one box (ADR-211)", async ({ page }) => {
  const account = await register(page, "gesture-block-resize");
  await seedNote(page, account.boardId, { x: -320, y: 0 });
  await seedNote(page, account.boardId, { x: 0, y: 0 });
  await seedNote(page, account.boardId, { x: 320, y: 0 });
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);

  interface NoteBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  const notes = () =>
    page.evaluate(() => {
      const list = (window as unknown as {
        __remo: { widgets: Array<NoteBox & { type: string }> };
      }).__remo.widgets;
      return list
        .filter((widget) => widget.type === "sticky_note")
        .map((widget) => ({
          id: widget.id,
          x: widget.x,
          y: widget.y,
          width: widget.width,
          height: widget.height,
        }));
    });

  const before = await notes();
  expect(before).toHaveLength(3);
  const view = await geometry(page);

  await page.mouse.click(...Object.values(toClient(view, before[0]!)) as [number, number]);
  await page.keyboard.down("Shift");
  for (const note of before.slice(1)) {
    const point = toClient(view, note);
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.up("Shift");

  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toHaveLength(3);
  // The badge names the composition of the block (ADR-211): total and how many scale.
  await expect(page.locator(".selection-badge")).toContainText("3 objects");
  await expect(page.locator(".selection-badge")).toContainText("3 change size");

  const right = Math.max(...before.map((note) => note.x + note.width / 2));
  const bottom = Math.max(...before.map((note) => note.y + note.height / 2));
  const gap = 7 / view.camera.zoom;
  const corner = toClient(view, { x: right + gap, y: bottom + gap });

  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 120, corner.y + 80, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const after = await notes();
  for (const [index, note] of before.entries()) {
    expect(after[index]!.width).toBeGreaterThan(note.width);
    expect(after[index]!.height).toBeGreaterThan(note.height);
  }

  // The gap between the first two notes grows with the same factor, not by a fixed
  // amount: a block keeps its proportions.
  const gapBefore =
    before[1]!.x - before[1]!.width / 2 - (before[0]!.x + before[0]!.width / 2);
  const gapAfter = after[1]!.x - after[1]!.width / 2 - (after[0]!.x + after[0]!.width / 2);
  expect(gapAfter).toBeGreaterThan(gapBefore);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  const undone = await notes();
  for (const [index, note] of before.entries()) {
    expect(Math.round(undone[index]!.width)).toBe(Math.round(note.width));
    expect(Math.round(undone[index]!.x)).toBe(Math.round(note.x));
  }

  // Shrink far past the minimum: the block stops and names the limit beside the pointer.
  const current = await notes();
  const cRight = Math.max(...current.map((note) => note.x + note.width / 2));
  const cBottom = Math.max(...current.map((note) => note.y + note.height / 2));
  const stopCorner = toClient(view, { x: cRight + gap, y: cBottom + gap });
  await page.mouse.move(stopCorner.x, stopCorner.y);
  await page.mouse.down();
  await page.mouse.move(stopCorner.x - 600, stopCorner.y - 600, { steps: 10 });
  await expect(page.locator(".canvas-limit")).toBeVisible();
  await expect(page.locator(".canvas-limit")).toContainText("Size limit");
  await page.mouse.up();
  await expect(page.locator(".canvas-limit")).toHaveCount(0);
});

/**
 * Modifiers a resize carries (ADR-212).
 *
 * Shift keeps the proportion and Alt anchors the centre; both are read from the
 * pointer event during the gesture, not from a mode.
 */
test("Shift keeps the note's proportion (ADR-212)", async ({ page }) => {
  const account = await register(page, "gesture-shift-ratio");
  await seedNote(page, account.boardId, { x: 0, y: 0 });
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);

  const before = await note(page);
  const view = await geometry(page);
  const gap = 7 / view.camera.zoom;
  const corner = toClient(view, {
    x: before.x + before.width / 2 + gap,
    y: before.y + before.height / 2 + gap,
  });

  const centre = toClient(view, before);
  await page.mouse.click(centre.x, centre.y);

  await page.mouse.move(corner.x, corner.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(corner.x + 120, corner.y + 20, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await note(page)).width).toBeGreaterThan(before.width);

  const after = await note(page);
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);
});

test("Alt resizes around the centre (ADR-212)", async ({ page }) => {
  const account = await register(page, "gesture-alt-centre");
  await seedNote(page, account.boardId, { x: 0, y: 0 });
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);

  const before = await note(page);
  const view = await geometry(page);
  const gap = 7 / view.camera.zoom;
  const corner = toClient(view, {
    x: before.x + before.width / 2 + gap,
    y: before.y + before.height / 2 + gap,
  });

  const centre = toClient(view, before);
  await page.mouse.click(centre.x, centre.y);

  await page.mouse.move(corner.x, corner.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(corner.x + 80, corner.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await note(page)).width).toBeGreaterThan(before.width);

  const after = await note(page);
  expect(after.height).toBeGreaterThan(before.height);
  // The centre is the anchor: a pixel of rounding is allowed, a drift is not.
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
});

/**
 * A shape grows down when its text no longer fits at the readable floor (ADR-214).
 *
 * The width is the person's decision and stays; the height follows the text until the
 * 1280 px cap. The growth rides the keystroke, so one undo restores both.
 */
test("a shape grows down for its text (ADR-214)", async ({ page }) => {
  await freshBoard(page, "gesture-shape-grow");
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();

  // A tolerant read: the probe is refreshed on every render, and a poll must not fail
  // because it looked during a re-render.
  const box = () =>
    page.evaluate(() => {
      const probe = (window as unknown as {
        __remo?: { widgets: Array<{ type: string; width: number; height: number }> };
      }).__remo;
      const one = probe?.widgets.find((widget) => widget.type === "shape");
      return one ? { width: one.width, height: one.height } : null;
    });

  const before = await box();
  if (!before) throw new Error("the shape was not created");
  const view = await geometry(page);
  const at = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo?: { widgets: Array<{ type: string; x: number; y: number }> };
    }).__remo;
    const one = probe?.widgets.find((widget) => widget.type === "shape");
    return one ? { x: one.x, y: one.y } : null;
  });
  if (!at) throw new Error("the shape has no position");
  const point = toClient(view, at);
  await page.mouse.dblclick(point.x, point.y);

  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill(
    "Очень длинная подпись шейпа, которая заведомо не помещается в исходный прямоугольник. ".repeat(14),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);

  await expect.poll(async () => (await box())?.height ?? 0).toBeGreaterThan(before.height);
  const grown = await box();
  if (!grown) throw new Error("the shape disappeared");
  expect(grown.width).toBe(before.width);
  expect(grown.height).toBeLessThanOrEqual(1280);
  expect(grown.height).toBeGreaterThan(before.height + 40);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await box())?.height ?? 0).toBeLessThan(grown.height);
});
