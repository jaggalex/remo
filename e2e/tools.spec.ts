import { expect, test, type Page } from "@playwright/test";
import { addSticky, freshBoard } from "./helpers";

/**
 * The tool rail (ADR-119): creation left, description in the top bar.
 *
 * Every case checks the document, not a pixel: a button "worked" only if the board
 * gained the object the tool promises.
 */
test("the rail creates every object type and the top bar only describes the board", async ({
  page,
}) => {
  await freshBoard(page, "tools");

  const rail = page.getByRole("toolbar", { name: "Tools" });
  await expect(rail).toBeVisible();
  // The old creation group and the glyph shapes are gone from the header.
  await expect(
    page.locator(".topbar").getByRole("button", { name: "Sticky note", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("button", { name: "Rectangle" })).toHaveCount(0);

  const types = () =>
    page.evaluate(
      () =>
        (window as unknown as { __remo: { widgets: Array<{ type: string }> } }).__remo.widgets.map(
          (widget) => widget.type,
        ),
    );

  // Sticky: one click, ready to type.
  await rail.getByRole("button", { name: "Sticky note", exact: true }).click();
  await expect(page.locator(".inline-editor")).toBeVisible();
  await page.locator(".inline-editor").fill("Rail note");
  await page.keyboard.press("Escape");
  expect(await types()).toContain("sticky_note");

  // Text and a shape from the keyboard: the rail's keys and its buttons share one action.
  await page.keyboard.press("t");
  await expect(page.locator(".inline-editor")).toBeVisible();
  await page.locator(".inline-editor").fill("Rail text");
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await page.keyboard.press("f");
  expect(await types()).toContain("text");
  expect(await types()).toContain("shape");
  expect(await types()).toContain("frame");

  // The default template has a kanban, so the card tool has a cell to aim at.
  const cards = (list: string[]) => list.filter((type) => type === "card").length;
  const beforeCard = cards(await types());
  await page.keyboard.press("c");
  expect(cards(await types())).toBe(beforeCard + 1);

  // History lives on the rail now.
  await page.getByRole("button", { name: "Undo (⌘Z)" }).click();
  expect(cards(await types())).toBe(beforeCard);
  await page.getByRole("button", { name: "Redo (⇧⌘Z)" }).click();
  expect(cards(await types())).toBe(beforeCard + 1);
});

test("the rail's colour and shape flyouts create the chosen sample", async ({ page }) => {
  await freshBoard(page, "tools-flyout");
  const rail = page.getByRole("toolbar", { name: "Tools" });

  await rail.getByRole("button", { name: "Sticky note colours" }).click();
  const swatches = page.locator(".tool-flyout-swatches .tool-swatch");
  // The rail is the window's fill grid: seven tonal columns × 100/300 (ADR-127, ADR-139).
  await expect(swatches).toHaveCount(14);
  await expect(swatches.nth(1)).toHaveAttribute("data-hex", "#ece2c8");
  await expect(swatches.nth(1)).toHaveClass(/is-default/);
  await swatches.nth(1).click();

  const fills = () =>
    page.evaluate(() =>
      (window as unknown as { __remo: { widgets: Array<{ type: string; style: { fillColor?: string } | null }> } })
        .__remo.widgets.filter((widget) => widget.type === "sticky_note")
        .map((widget) => widget.style?.fillColor ?? ""),
    );
  await expect.poll(fills).toHaveLength(1);
  expect((await fills())[0]).toMatch(/^#/);

  await rail.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name: "Ellipse" }).click();
  const kinds = await page.evaluate(() =>
    (window as unknown as { __remo: { widgets: Array<{ type: string; shapeKind?: string }> } })
      .__remo.widgets.filter((widget) => widget.type === "shape")
      .map((widget) => widget.shapeKind),
  );
  expect(kinds).toContain("ellipse");
});

test("the connector tool explains itself until two objects are selected", async ({
  page,
}) => {
  await freshBoard(page, "tools-connect");
  const rail = page.getByRole("toolbar", { name: "Tools" });
  const connector = rail.getByRole("button", { name: "Connector" });
  // A tool that can still explain itself is not dimmed (§10.2, Р1): it keeps the primary
  // colour and answers with a sentence, so nothing on the rail reads as broken.
  await expect(connector).toBeEnabled();
  await connector.click();
  await expect(page.locator(".canvas-notice")).toContainText("Select two objects");
});

/** World point → client point, the same inverse the canvas handlers use. */
async function geometry(page: Page) {
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

test("two selected objects become a connector from the rail", async ({ page }) => {
  await freshBoard(page, "tools-connect-two");
  await addSticky(page);
  await addSticky(page);
  const centers = await page.evaluate(() =>
    (
      window as unknown as {
        __remo: { widgets: Array<{ id: string; type: string; x: number; y: number }> };
      }
    ).__remo.widgets
      .filter((widget) => widget.type === "sticky_note")
      .map(({ id, x, y }) => ({ id, x, y })),
  );
  const view = await geometry(page);
  const toClient = (point: { x: number; y: number }) => ({
    x: view.rect.left + view.rect.width / 2 + (point.x - view.camera.x) * view.camera.zoom,
    y: view.rect.top + view.rect.height / 2 + (point.y - view.camera.y) * view.camera.zoom,
  });

  // The two notes overlap a little (the cascade offsets by 40), so click an uncovered
  // edge of each instead of a centre: one plain click and one Shift-click.
  const boxes = await page.evaluate(() =>
    (
      window as unknown as {
        __remo: {
          widgets: Array<{ type: string; x: number; y: number; width: number; height: number }>;
        };
      }
    ).__remo.widgets
      .filter((widget) => widget.type === "sticky_note")
      .map(({ x, y, width, height }) => ({
        left: x - width / 2,
        top: y - height / 2,
        right: x + width / 2,
        bottom: y + height / 2,
      })),
  );
  const first = toClient({
    x: boxes[0]!.left + 6,
    y: (boxes[0]!.top + boxes[0]!.bottom) / 2,
  });
  const second = toClient({
    x: boxes[1]!.right - 6,
    y: (boxes[1]!.top + boxes[1]!.bottom) / 2,
  });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");

  const connector = page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Connector" });
  await expect(connector).toBeEnabled();
  await connector.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __remo: { widgets: Array<{ type: string }> } }
          ).__remo.widgets.filter((widget) => widget.type === "connector").length,
      ),
    )
    .toBe(1);
});

test("the comment tool starts the placement mode of the comments panel", async ({ page }) => {
  await freshBoard(page, "tools-comment");
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Comment" }).click();
  await expect(page.locator(".comment-placement")).toBeVisible();
  await expect(page.locator(".comment-placement-hint")).toContainText("Click an object");
  await page.keyboard.press("Escape");
  await expect(page.locator(".comment-placement")).toHaveCount(0);
});
