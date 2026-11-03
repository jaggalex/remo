import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addSticky,
  freshBoard,
  openAccount,
  openBoardMenu,
  openFacilitation,
  openMore,
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
  // Both controls of the "my vote" shape are on screen: the one that takes a vote back
  // and the one that is off with a reason.
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
  await page.locator(".export-dialog .dialog-close").click();

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
