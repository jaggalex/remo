import { expect, test } from "@playwright/test";
import { addSticky, freshBoard, openBoard, openFacilitation } from "./helpers";

test("the shared timer counts down, pauses and resumes", async ({ page }) => {
  await freshBoard(page, "timer");
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await page.getByRole("button", { name: "5 min", exact: true }).click();

  // The countdown is a hint on the menu row: the header names the state in words.
  await openFacilitation(page);
  const timerRow = page.getByRole("menuitem", { name: /Timer/ });
  await expect(timerRow).toContainText("05:00");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1_500);
  await openFacilitation(page);
  await expect(page.getByRole("menuitem", { name: /Timer/ })).not.toContainText("05:00");

  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".timer-face")).toContainText("Paused by");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator(".timer-face")).toContainText("Set by");
});

test("the board timer repaints while nothing else changes", async ({ page }) => {
  await freshBoard(page, "timer-paint");
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await page.getByRole("button", { name: "5 min", exact: true }).click();

  // The header already re-renders once a second; the canvas has its own painter.
  // Without a clock dependency the board card stays at the value it had at the last
  // gesture, which is exactly what the screenshot showed.
  const before = await page.evaluate(
    () =>
      (window as unknown as { __remo: { perf: () => { board: number } } }).__remo.perf()
        .board,
  );
  await page.waitForTimeout(2_200);
  const after = await page.evaluate(
    () =>
      (window as unknown as { __remo: { perf: () => { board: number } } }).__remo.perf()
        .board,
  );
  expect(after).toBeGreaterThan(before);
});

test("the server caps votes and publishes the tally", async ({ page }) => {
  const account = await freshBoard(page, "vote");
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  const panel = page.getByRole("dialog", { name: "Voting session" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("2 votes per person");
  // §9.14: the panel manages the session; votes are cast on the object (ADR-117).
  await expect(panel.getByRole("button", { name: /Vote for/ })).toHaveCount(0);
  await expect(page.locator(".vote-board-bar")).toContainText("you have 2 of 2");

  // The panel is a dialog over the board: to vote, close it and use the object itself.
  await panel.getByRole("button", { name: "Close" }).click();
  await page.locator(".vote-chip").first().getByRole("button", { name: /Vote for/ }).click();
  await expect(page.locator(".vote-board-bar")).toContainText("you have 1 of 2");

  const textCount = async () =>
    Number(await page.locator(".counts li", { hasText: "Text" }).locator("b").innerText());
  const textBefore = await textCount();

  // The line above the board opens the panel; «Завершить сейчас…» is one act with a
  // question, not a neighbour of «+1 min».
  await page.locator(".vote-board-bar").click();
  await panel.getByRole("button", { name: "End now…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("End voting for everyone?");
  await confirm.getByRole("button", { name: "End voting" }).click();

  await expect(page.locator(".vote-board-bar")).toContainText("Voting is over");
  await panel.getByRole("button", { name: "Publish on the board" }).click();
  await expect(panel.getByText("Published", { exact: true })).toBeVisible();
  // Publishing is a server command, and the result object arrives over the socket.
  await expect.poll(textCount, { timeout: 15_000 }).toBe(textBefore + 1);

  const sessions = await page.request.get(`/api/boards/${account.boardId}/vote-sessions`);
  const body = await sessions.json();
  expect(body.sessions[0].publishedAt).toBeTruthy();
});

test("the tally refreshes on its own, without touching the board", async ({ page }) => {
  const account = await freshBoard(page, "vote-live");
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ["obj-a", "obj-b"], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  const sessionId = (await created.json()).session.id as string;

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  await expect(page.locator(".vote-board-bar")).toContainText("you have 2 of 2");
  await expect(page.locator(".vote-list li")).toHaveCount(2);

  // A vote arrives from another screen. Nobody moves the camera or the board: the
  // panel has to poll, because a vote is not a document change (ADR-074).
  const voted = await page.request.post(`/api/vote-sessions/${sessionId}/votes`, {
    data: { objectId: "obj-a" },
  });
  expect(voted.ok()).toBeTruthy();

  await expect
    .poll(async () => page.locator(".vote-list li").first().locator(".vote-count").innerText(), {
      timeout: 8_000,
    })
    .toBe("1");
  await expect(page.locator(".vote-board-bar")).toContainText("you have 1 of 2");
});

test("votes are cast on the object itself and stop when the session ends", async ({ page }) => {
  const account = await freshBoard(page, "vote-board");
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.ok()).toBeTruthy();
  const sessionId = (await created.json()).session.id as string;

  // The counter lives on the object, so "where do I vote" needs no dialog.
  const chip = page.locator(".vote-chip").first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await chip.getByRole("button", { name: /Vote for/ }).click();
  await expect(chip.locator(".vote-chip-count")).toHaveText("1");
  await expect(chip).toHaveClass(/mine/);
  await expect(page.locator(".vote-board-bar")).toContainText("you have 1 of 2");

  // The same chip takes the vote back.
  await chip.getByRole("button", { name: /Take back/ }).click();
  await expect(chip.locator(".vote-chip-count")).toHaveText("0");

  // Ending the session removes the controls at once: no vote against a closed tally.
  // The number stays on the object, marked as the final total (ТЗ §4.3).
  const ended = await page.request.post(`/api/vote-sessions/${sessionId}/end`);
  expect(ended.ok()).toBeTruthy();
  await expect(page.locator(".vote-chip-button")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".vote-chip")).toContainText("total");
  await expect(page.locator(".vote-board-bar")).toContainText("Voting is over");
});

test("a session stops offering votes the moment its deadline passes", async ({ page }) => {
  const account = await freshBoard(page, "vote-deadline");
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: {
      objectIds: [objectId],
      votesPerSubject: 2,
      minutes: null,
      anonymous: true,
      endsAt: new Date(Date.now() + 4_000).toISOString(),
    },
  });
  expect(created.ok()).toBeTruthy();

  await expect(page.locator(".vote-chip")).toHaveCount(1, { timeout: 10_000 });
  // The clock is the record: no facilitator press, no reload, no camera move.
  await expect(page.locator(".vote-chip-button")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".vote-board-bar")).toContainText("Voting is over");
});

test("an open vote names who voted once it ends", async ({ page }) => {
  const account = await freshBoard(page, "vote-open", { user: "Alice" });
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 2, minutes: 10, anonymous: false },
  });
  expect(created.status()).toBe(201);
  const sessionId = (await created.json()).session.id as string;

  // Consent in words before the first vote, no names while the count is live.
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  const panel = page.getByRole("dialog", { name: "Voting session" });
  await expect(panel).toContainText("This is an open vote");
  await expect(panel.locator(".vote-voters")).toHaveCount(0);
  await panel.getByRole("button", { name: "Close" }).click();
  await page.locator(".vote-chip").first().getByRole("button", { name: /Vote for/ }).click();
  await expect(page.locator(".vote-board-bar")).toContainText("voters are visible");

  await page.request.post(`/api/vote-sessions/${sessionId}/end`);
  await page.locator(".vote-board-bar").click();
  const row = panel.getByRole("button", { name: /Who voted/ });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // The summary names the same person once, with what they spent and how widely.
  await expect(panel.locator(".vote-summary")).toContainText("Alice");

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(panel.locator(".vote-voters")).toContainText("Alice");
  await expect(panel.locator(".vote-voters")).toContainText("1 vote");
  // The published card is what travels: places and votes, never names.
  await expect(panel.locator(".vote-preview-card")).not.toContainText("Alice");
});

test("a vote started while the timer runs follows the timer", async ({ page }) => {
  await freshBoard(page, "vote-timer");
  await addSticky(page);
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await page.getByRole("button", { name: "5 min", exact: true }).click();

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  await expect(page.locator(".vote-timer-note")).toContainText("ends with the timer");
  // One clock: the session takes the timer's deadline, it does not get a second one.
  await expect(page.getByRole("radio", { name: /With the timer/ })).toBeChecked();
});

test("one person follows another, and the followed person can stop it", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "follow", { user: "Alice" });
  const state = await page.context().storageState();
  const other = await browser.newContext({ storageState: state, locale: "en-US" });
  const bob = await other.newPage();
  await openBoard(bob, account.boardId, { user: "Bob" });

  await expect(page.locator(".peer")).toHaveCount(2);
  await bob.locator(".peer:not(.self)").click();
  await expect(bob.locator(".follow-pill")).toContainText("Following Alice");
  await expect(page.locator(".follow-counter")).toContainText("1");

  await page.locator(".follow-counter").click();
  await page.getByRole("button", { name: "Stop everyone" }).click();
  await expect(bob.locator(".follow-pill")).toHaveCount(0);
  await expect(bob.locator(".canvas-notice")).toContainText("stopped your follow");

  await other.close();
});

test("the counter sits inside its object, never moves the board and names my vote", async ({
  page,
}) => {
  const account = await freshBoard(page, "vote-chip");
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 1, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);

  const chip = page.locator(".vote-chip").first();
  await expect(chip).toBeVisible();

  // §10.3: the same 8 px inside the object's bottom-right, in the object's own frame.
  const geometry = await page.evaluate((id) => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        viewport: { width: number; height: number };
        widgets: Array<{ id: string; x: number; y: number; width: number; height: number }>;
      };
    };
    const state = probe.__remo;
    const element = document.querySelector<HTMLElement>(".vote-chip")!;
    const rect = element.getBoundingClientRect();
    const wrap = document.querySelector<HTMLElement>(".canvas-wrap")!.getBoundingClientRect();
    const widget = state.widgets.find((row) => row.id === id)!;
    const { camera, viewport } = state;
    const right = (widget.x + widget.width / 2 - camera.x) * camera.zoom + viewport.width / 2;
    const bottom = (widget.y + widget.height / 2 - camera.y) * camera.zoom + viewport.height / 2;
    return {
      rightGap: right - (rect.left - wrap.left + rect.width),
      bottomGap: bottom - (rect.top - wrap.top + rect.height),
      height: rect.height,
      inside:
        rect.left >= wrap.left && rect.top >= wrap.top && rect.right <= wrap.right && rect.bottom <= wrap.bottom,
    };
  }, objectId);
  expect(geometry.height).toBe(32);
  expect(Math.abs(geometry.rightGap - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.bottomGap - 8)).toBeLessThanOrEqual(1);
  expect(geometry.inside, "the counter stays inside the canvas").toBe(true);

  // The sum and my own vote are two facts: the number stays the aggregate, the word says mine.
  const before = await page.evaluate(() => {
    const probe = window as unknown as {
      __remo: { camera: unknown; selectedIds: string[] };
    };
    return { camera: probe.__remo.camera, selected: probe.__remo.selectedIds };
  });
  await chip.getByRole("button", { name: /Vote for/ }).click();
  await expect(chip).toHaveClass(/mine/);
  await expect(chip.locator(".vote-chip-count")).toHaveText("1");
  await expect(chip.locator(".vote-chip-caption")).toHaveText("· yours");
  await expect(chip).toHaveAttribute("aria-label", "Votes for this object: 1. Your vote: 1");
  // The vote is cast on the object, not by moving the view or selecting something.
  const after = await page.evaluate(() => {
    const probe = window as unknown as {
      __remo: { camera: unknown; selectedIds: string[] };
    };
    return { camera: probe.__remo.camera, selected: probe.__remo.selectedIds };
  });
  expect(after.camera).toEqual(before.camera);
  expect(after.selected).toEqual(before.selected);

  // With the one vote spent, "+" stays in place, disabled, and says why.
  const plus = chip.getByRole("button", { name: /Vote for/ });
  await expect(plus).toBeDisabled();
  await expect(plus).toHaveAttribute("title", "You already voted for this object");
  await expect(chip.getByRole("button", { name: /Take back/ })).toBeEnabled();
});

test("a spent budget disables the plus on every other object", async ({ page }) => {
  const account = await freshBoard(page, "vote-budget");
  const ids = await page.evaluate(() =>
    (
      window as unknown as { __remo: { widgets: Array<{ id: string; type: string }> } }
    ).__remo.widgets
      .filter((widget) => widget.type === "card")
      .slice(0, 2)
      .map((widget) => widget.id),
  );
  expect(ids).toHaveLength(2);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ids, votesPerSubject: 1, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);

  const chips = page.locator(".vote-chip");
  await expect(chips).toHaveCount(2, { timeout: 10_000 });
  const first = chips.nth(0);
  const second = chips.nth(1);
  await expect(first.locator(".vote-chip-count")).toHaveText("0");
  await expect(second.locator(".vote-chip-count")).toHaveText("0");
  await expect(second.getByRole("button", { name: /Vote for/ })).toBeEnabled();

  await first.getByRole("button", { name: /Vote for/ }).click();
  await expect(first.locator(".vote-chip-count")).toHaveText("1");
  await expect(first).toHaveClass(/mine/);
  // Nothing left to give: the other object keeps its "+" but cannot use it.
  const other = second.getByRole("button", { name: /Vote for/ });
  await expect(other).toBeDisabled();
  await expect(other).toHaveAttribute("title", "No votes left");

  // Taking the vote back restores the budget everywhere.
  await first.getByRole("button", { name: /Take back/ }).click();
  await expect(first.locator(".vote-chip-count")).toHaveText("0");
  await expect(second.getByRole("button", { name: /Vote for/ })).toBeEnabled();
});

test("a touch screen gets a 44 px target and keeps the counter a compact pill", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "vote-touch", { user: "Alice" });
  const state = await page.context().storageState();
  const touch = await browser.newContext({
    storageState: state,
    locale: "en-US",
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await touch.newPage();
  await openBoard(tablet, account.boardId, { user: "Alice" });
  const ids = await tablet.evaluate(() =>
    (
      window as unknown as { __remo: { widgets: Array<{ id: string; type: string }> } }
    ).__remo.widgets
      .filter((widget) => widget.type === "card")
      .slice(0, 1)
      .map((widget) => widget.id),
  );
  const created = await tablet.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ids, votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);

  const chip = tablet.locator(".vote-chip").first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  const sizes = await chip.evaluate((element) => {
    const button = element.querySelector<HTMLElement>(".vote-chip-button")!;
    const pill = element.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    return { target: { width: target.width, height: target.height }, pill: { width: pill.width, height: pill.height } };
  });
  // Macro demand: a thumb needs 44 px, and the counter stays one compact line.
  expect(sizes.target.width).toBeGreaterThanOrEqual(44);
  expect(sizes.target.height).toBeGreaterThanOrEqual(44);
  expect(sizes.pill.height).toBe(44);
  expect(sizes.pill.width).toBeLessThan(220);

  await touch.close();
});

test("a vote chip stays under an open object panel", async ({ page }) => {
  const account = await freshBoard(page, "vote-layers", { template: "empty" });
  const objectId = await addSticky(page);
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: [objectId], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);

  const chip = page.locator(".vote-chip").first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await expect(bar).toBeVisible();

  // The counter is the social layer; the object panel is a panel. A panel always wins
  // (ADR-139), so the chip's "+" can never sit above the window a person is using.
  const layers = await page.evaluate(() => {
    const z = (selector: string) =>
      Number(getComputedStyle(document.querySelector(selector)!).zIndex);
    return { chip: z(".vote-chip"), panel: z(".sticky-bar") };
  });
  expect(layers.chip).toBeLessThan(layers.panel);
});
