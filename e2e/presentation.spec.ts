import { test, expect } from "@playwright/test";
import { addSticky, PASSWORD, freshBoard, startPresentation } from "./helpers";

test("starts, advances and stops a presentation, restoring the camera", async ({ page }) => {
  await freshBoard(page, "presentation");
  await startPresentation(page);
  // Capture the camera after the template has settled and the panel is open: that is
  // the view the presenter expects back when the show stops.
  const before = await page.evaluate(
    () => (window as unknown as { __remo: { camera: unknown } }).__remo.camera,
  );

  const panel = page.locator(".presentation-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".presentation-list li")).toHaveCount(2);
  await panel.getByRole("button", { name: "Start presentation", exact: true }).click();

  const bar = page.locator(".present-bar");
  await expect(bar).toContainText("1");
  await expect(bar).toContainText("2");
  await bar.getByRole("button", { name: "Next slide" }).click();
  await expect(bar).toContainText("2");
  await bar.getByRole("button", { name: "Stop" }).click();
  await expect(bar).toHaveCount(0);

  const after = await page.evaluate(
    () => (window as unknown as { __remo: { camera: unknown } }).__remo.camera,
  );
  expect(after).toEqual(before);
});

test("names any object and puts it into the presentation", async ({ page }) => {
  const account = await freshBoard(page, "present-object");
  const id = await addSticky(page);

  const inspector = page.locator(".inspector");
  await inspector.getByLabel("Name").fill("Intro note");
  await page.keyboard.press("Enter");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(inspector.locator(".object-id")).toHaveText(id);

  // The projection catches up shortly after the write; search reads props.name.
  await page.waitForTimeout(2_500);
  const found = await page.request.get(
    `/api/search?q=Intro%20note&room=${encodeURIComponent(account.boardId)}`,
  );
  const hits = (await found.json()) as { hits: Array<{ id: string; snippet: string }> };
  expect(hits.hits[0]).toMatchObject({ id, snippet: "Intro note" });

  await startPresentation(page);
  const panel = page.locator(".presentation-panel");
  const available = panel.locator(".presentation-available li", { hasText: "Intro note" });
  await expect(available).toBeVisible();
  await available.getByRole("button", { name: "Add", exact: true }).click();

  // The two template frames were slides already; the note joins at the end.
  const slides = panel.locator(".presentation-list li");
  await expect(slides).toHaveCount(3);
  await expect(slides.nth(2)).toContainText("Intro note");
  await slides.nth(2).getByRole("button", { name: "Move up" }).click();
  await expect(slides.nth(1)).toContainText("Intro note");
});

test("a second session of one account cannot start another presentation", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "present-two", { user: "Sess" });
  await startPresentation(page);
  await page
    .locator(".presentation-panel")
    .getByRole("button", { name: "Start presentation", exact: true })
    .click();
  await expect(page.locator(".present-bar")).toBeVisible();

  const second = await browser.newContext();
  const other = await second.newPage();
  try {
    const login = await other.request.post("/api/auth/login", {
      data: { email: account.email, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    await other.goto(`/?room=${account.boardId}&lang=en`);
    await expect(other.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
    // The second session sees the live presentation before it tries to start its own.
    await expect(other.locator(".present-join")).toContainText("Sess");

    await startPresentation(other);
    await other
      .locator(".presentation-panel")
      .getByRole("button", { name: "Start presentation", exact: true })
      .click();
    await expect(other.locator(".canvas-notice")).toContainText("already running");
    await expect(other.locator(".present-bar")).toHaveCount(0);
  } finally {
    await second.close();
  }
});
