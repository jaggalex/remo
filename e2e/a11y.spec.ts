import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addSticky,
  applyDefaultTableLayout,
  freshBoard,
  openAccount,
  openBoard,
  openBoardMenu,
  openFacilitation,
  openMore,
  register,
  seedNote,
  seedObject,
  selectKanbanCard,
  zoomInTo,
} from "./helpers";

/**
 * Accessibility is a gate, not a report (roadmap Q2.2).
 *
 * Only serious and critical findings fail the run: the product has known cosmetic
 * issues, but a control without a name or a contrast failure that hides text is a defect.
 * `include` narrows the scan to a modal surface: the board behind an aria-modal dialog is
 * inert, and its own findings belong to the board scenario.
 */
async function expectNoSerious(page: Page, screen: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  if (include) builder.include(include);
  const results = await builder.analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`),
    `${screen} has serious accessibility violations`,
  ).toEqual([]);
}

test("the board has no serious accessibility violations", async ({ page }) => {
  await freshBoard(page, "a11y-board");
  await expectNoSerious(page, "board");
});

test("the counter on the object has no serious accessibility violations", async ({ page }) => {
  const account = await freshBoard(page, "a11y-vote");
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);
  const chip = page.locator(".vote-chip").first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  // The compact counter of a fitted view is scanned too (ADR-235), then the full one with
  // both controls of the "my vote" shape: the one that takes a vote back and the one that
  // is off with a reason.
  await expect(chip).toHaveClass(/compact/);
  await expectNoSerious(page, "compact vote counter", ".vote-chip");
  await zoomInTo(page, 0.85);
  await expect(chip).not.toHaveClass(/compact/);
  await chip.getByRole("button", { name: /Vote for/ }).click();
  await expect(chip).toHaveClass(/mine/);
  await expect(chip.locator(".vote-chip-caption")).toHaveText("· yours");
  // Narrowed to the counter on purpose: a selected note also shows the old inspector,
  // whose unlabelled colour `<select>` is a known gap of that surface (spec §9, п.49),
  // not of this one.
  await expectNoSerious(page, "vote counter", ".vote-chip");
});

test("the four header menus have no serious accessibility violations", async ({ page }) => {
  await freshBoard(page, "a11y-menus");

  // Each surface is scanned while open: a menu is a role tree of its own.
  await openBoardMenu(page);
  await expectNoSerious(page, "board menu");
  await page.keyboard.press("Escape");

  await openFacilitation(page);
  await expectNoSerious(page, "facilitation menu");
  await page.keyboard.press("Escape");

  await openMore(page);
  await expectNoSerious(page, "more menu");
  await page.getByRole("menuitem", { name: "Templates…" }).click();
  await expectNoSerious(page, "templates popover");
  await page.keyboard.press("Escape");

  await openAccount(page);
  await expectNoSerious(page, "account menu");
});

test("dialogs have no serious accessibility violations", async ({ page }) => {
  await freshBoard(page, "a11y-dialogs");

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await expect(page.locator(".export-dialog")).toBeVisible();
  await expectNoSerious(page, "export dialog");
  await page.getByRole("dialog", { name: "Export" }).getByRole("button", { name: "Close", exact: true }).first().click();

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  const vote = page.getByRole("dialog", { name: "Voting session" });
  await expect(vote).toBeVisible();
  await expectNoSerious(page, "vote dialog");
  await vote.getByRole("button", { name: "Close" }).click();

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await expect(page.locator(".timer-dialog")).toBeVisible();
  await expectNoSerious(page, "timer dialog");
});

test("the colour window has no serious accessibility violations", async ({ page }) => {
  await freshBoard(page, "a11y-colour");
  const id = await addSticky(page);
  // Escape in the editor drops the selection; click the note to bring its bar back.
  const point = await page.evaluate((widgetId) => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ id: string; x: number; y: number }>;
      };
    };
    const widget = probe.__remo.widgets.find((entry) => entry.id === widgetId)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (widget.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (widget.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  }, id);
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: /^Sheet colour: / }).click();
  await expect(page.getByRole("dialog", { name: "Sheet colour" })).toBeVisible();
  await expectNoSerious(page, "colour window", ".rm-popover");
});

test("the named voters of an open session have no serious violations", async ({ page }) => {
  const account = await freshBoard(page, "a11y-vote-open", { user: "Alice" });
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 2, minutes: 10, anonymous: false },
  });
  const sessionId = (await created.json()).session.id as string;
  await page.request.post(`/api/vote-sessions/${sessionId}/votes`, { data: { objectId } });
  await page.request.post(`/api/vote-sessions/${sessionId}/end`);

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  const vote = page.getByRole("dialog", { name: "Voting session" });
  // ADR-126: the row is a button with aria-expanded, and the panel it opens is labelled.
  const row = vote.getByRole("button", { name: /Who voted/ });
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.click();
  await expect(vote.locator(".vote-voters")).toContainText("Alice");
  await expectNoSerious(page, "open vote results", ".rm-dialog");
});


test("a section table has no serious accessibility violations", async ({ page }) => {
  const account = await register(page, "a11y-table");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });
  await seedNote(page, account.boardId, { x: 0, y: 0 }, undefined, "Inside", frameId);
  await openBoard(page, account.boardId);
  await page.waitForFunction(
    (id) =>
      (window as unknown as { __remo?: { widgets?: Array<{ id: string }> } }).__remo?.widgets?.some(
        (widget) => widget.id === id,
      ),
    frameId,
  );
  const point = await page.evaluate((id) => {
    const probe = (window as unknown as {
      __remo: { widgets: Array<{ id: string; x: number; y: number; height: number }>; camera: { x: number; y: number; zoom: number } };
    }).__remo;
    const frame = probe.widgets.find((widget) => widget.id === id)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (frame.x - probe.camera.x) * probe.camera.zoom,
      y:
        rect.top +
        rect.height / 2 +
        (frame.y - frame.height / 2 + 24 - probe.camera.y) * probe.camera.zoom,
    };
  }, frameId);
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.locator(".section-panel").getByRole("radio", { name: "Table", exact: true }).click();
  await applyDefaultTableLayout(page);
  await expect(page.locator(".table-mirror table")).toHaveCount(1);
  await expectNoSerious(page, "section panel", ".section-panel");
  await expectNoSerious(page, "table mirror", ".table-mirror");
});

/**
 * A modal dialog is the @remo/ui Dialog (UX-DIALOG-01): focus moves in, Tab stays in,
 * Escape closes, focus returns to what opened it. Hand-made dialogs declared
 * `aria-modal` without doing any of this, so a keyboard user stayed on the canvas.
 */
test("modal dialogs keep the keyboard inside and return focus", async ({ page }) => {
  await freshBoard(page, "a11y-dialog-keys");
  const cases: Array<{ name: string; open: () => Promise<void>; opener: () => ReturnType<Page["locator"]> }> = [
    {
      name: "Export",
      open: async () => {
        await openBoardMenu(page);
        await page.getByRole("menuitem", { name: "Export…" }).click();
      },
      opener: () => page.getByRole("button", { name: /^Room menu:/ }),
    },
    {
      name: "Room settings",
      open: async () => {
        await openBoardMenu(page);
        await page.getByRole("menuitem", { name: "Room settings" }).click();
      },
      opener: () => page.getByRole("button", { name: /^Room menu:/ }),
    },
    {
      name: "Room access",
      open: () => page.getByRole("button", { name: "Share", exact: true }).click(),
      opener: () => page.getByRole("button", { name: "Share", exact: true }),
    },
  ];
  for (const { name, open, opener } of cases) {
    await open();
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();
    const inside = () => dialog.evaluate((el) => el.contains(document.activeElement));
    await expect.poll(inside, { message: `${name}: focus moves into the dialog` }).toBe(true);
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press("Tab");
      expect(await inside(), `${name}: Tab stays inside (step ${step + 1})`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener(), `${name}: focus returns to the opener`).toBeFocused();
  }
});

test("a tooltip waits, stays under the pointer and closes on Escape (WCAG 1.4.13)", async ({ page }) => {
  await freshBoard(page, "a11y-tooltip");
  const tool = page.getByRole("button", { name: "Text", exact: true });
  const tip = page.getByRole("tooltip").filter({ hasText: /^Text/ });
  const box = (await tool.boundingBox())!;

  // Hover: nothing at once, the tip after the delay (ADR-231: 500 ms).
  const start = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tip).toBeHidden();
  await expect(tip).toBeVisible();
  expect(Date.now() - start).toBeGreaterThanOrEqual(400);

  // Hoverable: crossing the gap onto the tip keeps it open.
  const tipBox = (await tip.boundingBox())!;
  await page.mouse.move(box.x + box.width + 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2, { steps: 4 });
  await page.waitForTimeout(200);
  await expect(tip).toBeVisible();

  // Dismissible without moving the pointer, and the tip lets clicks through.
  expect(await tip.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();

  // Leaving closes it; coming back opens it again.
  await page.mouse.move(box.x + 400, box.y + 200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tip).toBeVisible();
  await page.mouse.move(box.x + 400, box.y + 200);
  await expect(tip).toBeHidden();

  // Keyboard focus shows it at once, and Escape hides it with focus kept.
  // A key press first, so the browser treats the focus as keyboard focus (:focus-visible).
  await page.keyboard.press("Shift");
  await tool.focus();
  await expect(tool).toBeFocused();
  await expect(tip).toBeVisible({ timeout: 300 });
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(tool).toBeFocused();
});

test("header and zoom icons are named in their tooltips (ADR-232)", async ({ page }) => {
  await freshBoard(page, "a11y-header-icons");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  // Names stay what they were, so roles find the same controls.
  const more = page.getByRole("button", { name: "More", exact: true });
  const share = page.getByRole("button", { name: "Share", exact: true });
  const fit = page.getByRole("button", { name: "Fit", exact: true });
  for (const control of [more, share, fit]) {
    await expect(control).toBeVisible();
    await expect(control).not.toContainText(/\w/);
  }

  // Hover shows the name; focus shows it at once.
  await more.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: /^More$/ })).toBeVisible();
  await page.keyboard.press("Shift");
  await share.focus();
  await expect(page.getByRole("tooltip").filter({ hasText: /^Room access$/ })).toBeVisible({ timeout: 300 });
  await fit.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: /selection/ })).toBeVisible();

  // A calm save state is an icon: the word is in the live region but not drawn.
  const word = page.locator(".save-state .rm-sync > span");
  await expect(word).toHaveText(/saved/i);
  expect(await word.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
});

test("selection actions are named icons, and the rare ones sit behind More actions (ADR-233)", async ({ page }) => {
  await freshBoard(page, "a11y-selection-actions");
  await selectKanbanCard(page);
  const inspector = page.locator("aside.inspector");
  const actions = inspector.getByRole("group", { name: "Selection actions" });
  for (const name of ["Copy", "Copy link", "Cut", "Duplicate", "Delete"]) {
    await expect(actions.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(inspector.getByRole("button", { name: "Edit text", exact: true })).toBeVisible();

  const more = inspector.getByRole("button", { name: "More actions", exact: true });
  await more.click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu.getByRole("menuitem", { name: /^Nudge/ })).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: /^Info/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.click();
  await menu.getByRole("menuitem", { name: "Clear selection" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds.length))
    .toBe(0);
});
