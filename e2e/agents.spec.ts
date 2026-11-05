import { expect, test, type Page } from "@playwright/test";
import { addSticky, agentBoard, openBoard, openMore } from "./helpers";

/**
 * The plan preview (ADR-142, M2b): a brief and a file become a plan, the person applies
 * it in one transaction, ⌘Z takes the whole structure back, and a second visit never
 * duplicates it.
 *
 * The model is the deterministic `REMO_AI_FAKE=plan` seam in `apps/sync/ai-fake.mjs`,
 * switched on by the Playwright sync server only.
 */

const BUDGET = { maxTokens: 6_000, maxActions: 60, maxCostUsd: 1 };

async function openAgents(page: Page): Promise<void> {
  // Scoped to the header: a selected object adds its own "More" to the arrange bar.
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Ask AI…" }).click();
  await expect(
    page.getByRole("dialog", { name: "AI agents on this room" }),
  ).toBeVisible();
}

async function chooseBrief(page: Page): Promise<void> {
  await page
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption({ label: "Planner" });
  await page
    .getByRole("combobox", { name: "Skill", exact: true })
    .selectOption("brief-to-board");
}

/** A CSV whose flattened text passes the 20 000-character cap, so truncation is real. */
function longBriefCsv(): string {
  const rows = Array.from({ length: 2_000 }, (_, index) => `Story ${index},M`).join("\n");
  return `story,size\n${rows}\n`;
}

test("the plan skill is the default and the diagram stays in the list", async ({ page }) => {
  await agentBoard(page, "agents-default-skill");
  await openAgents(page);

  const skill = page.getByRole("combobox", { name: "Skill", exact: true });
  await expect(skill).toHaveValue("brief-to-board");
  await expect(skill.locator('option[value="diagram"]')).toHaveCount(1);
  // "Auto" is always offered; a skill that needs a selection is not (ADR-143).
  await expect(skill.locator('option[value=""]')).toHaveCount(1);
  await expect(skill.locator('option[value="cards"]')).toHaveCount(0);
  await expect(skill.locator('option[value="tidy-selection"]')).toHaveCount(0);
});

test("the selection is the source, with its size in characters, and can be removed", async ({
  page,
}) => {
  await agentBoard(page, "agents-source");
  await addSticky(page);
  await openAgents(page);

  const skill = page.getByRole("combobox", { name: "Skill", exact: true });
  await expect(skill.locator('option[value="cards"]')).toHaveCount(1);
  await expect(skill.locator('option[value="tidy-selection"]')).toHaveCount(1);

  const source = page.locator(".agent-source");
  await expect(source).toContainText("Selected: 1 objects");
  await expect(source).toContainText("Text: 4 characters");
  await expect(source).toContainText("groups: 0");
  await expect(source.getByRole("button", { name: "Selection only" })).toBeVisible();
  await source.getByRole("button", { name: "Remove" }).click();
  await expect(source).toContainText("No selection is used");
  await expect(skill.locator('option[value="tidy-selection"]')).toHaveCount(0);
});

test("a brief with a file becomes a plan, applies once and undoes in one step", async ({
  page,
}) => {
  const board = await agentBoard(page, "agents-brief");
  await openAgents(page);
  await chooseBrief(page);

  await page
    .getByLabel("What should it draw?")
    .fill("Собери US-карту для оформления заказа");
  await page.locator('input[type="file"]').setInputFiles({
    name: "stories.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(longBriefCsv(), "utf8"),
  });
  await expect(page.locator(".agent-file-chip")).toContainText("stories.csv");
  await expect(page.locator(".agent-file-chip")).toContainText(".csv");

  await page.getByRole("button", { name: "Ask the agent" }).click();

  // Polling turns "plan ready" into the preview; nothing has touched the board yet.
  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("Objects: 10 · connectors: 0 · actions: 10");
  await expect(plan).toContainText("2 frames");
  await expect(plan).toContainText("4 sticky notes");
  await expect(plan).toContainText("The file was cut");
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(0);

  // The miniature is geometry only, and its description is the same sentence a person
  // reads under it: the counts and the bounds of the plan.
  const map = plan.getByRole("img", { name: /bounds/ });
  await expect(map).toBeVisible();
  const mapLabel = await map.getAttribute("aria-label");
  expect(mapLabel).toContain("10 objects");
  expect(mapLabel).toContain("0 connectors");
  expect(mapLabel).toMatch(/bounds \d+ × \d+/);
  await expect(plan.locator(".agent-plan-map-caption")).toHaveText(mapLabel!);
  await expect(plan.locator(".agent-plan-map-svg rect")).toHaveCount(10);

  // Two clicks in one tick are one apply: the second is refused by the ref guard.
  await plan.getByRole("button", { name: "Apply" }).evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(plan).toContainText(
    "The objects are on the room. One ⌘Z removes the whole structure.",
  );
  await expect(plan.getByRole("button", { name: "Show on room" })).toBeVisible();
  await expect(plan.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(10);

  // The result is selected as a frame.
  const frames = await page.evaluate(() =>
    window.__remo.selectedIds.filter(
      (id) => window.__remo.widgets.find((widget) => widget.id === id)?.type === "frame",
    ),
  );
  expect(frames).toHaveLength(2);

  await plan.getByRole("button", { name: "Show on room" }).click();
  await expect(plan).toHaveCount(0);

  // A second visit shows the applied plan and no Apply button: nothing is duplicated.
  await openAgents(page);
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("Applied");
  await expect(plan.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await expect(plan.getByRole("button", { name: "Show on room" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(10);

  await plan.getByRole("button", { name: "Show on room" }).click();
  await expect(plan).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(0);
});

test("a plan applied in one tab is not written again from a second tab", async ({
  page,
  context,
}) => {
  const board = await agentBoard(page, "agents-two-tabs");
  await openAgents(page);
  await chooseBrief(page);
  await page
    .getByLabel("What should it draw?")
    .fill("Собери US-карту для оформления заказа");
  await page.getByRole("button", { name: "Ask the agent" }).click();

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });

  // The same task is opened in a second tab of the same account before anything is
  // applied. Both dialogs hold a proposed plan; only one may write it.
  const second = await context.newPage();
  await openBoard(second, board.boardId);
  await openAgents(second);
  const secondPlan = second.getByRole("dialog", { name: "Agent plan" });
  await expect(secondPlan).toBeVisible({ timeout: 20_000 });

  await plan.getByRole("button", { name: "Apply" }).click();
  await expect(plan.getByRole("button", { name: "Show on room" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(10);

  // The first approval is already recorded: this tab must show the result, not write
  // the same ten objects a second time.
  await secondPlan.getByRole("button", { name: "Apply" }).click();
  await expect(secondPlan).toContainText("Another tab has already applied this plan");
  await expect(secondPlan.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await expect(secondPlan.getByRole("button", { name: "Show on room" })).toBeVisible();
  await expect(secondPlan.locator(".agent-plan-undo-hint")).toHaveCount(0);
  await expect.poll(() => second.evaluate(() => window.__remo.widgets.length)).toBe(10);

  await second.close();
});

test("a plan with a connector draws a line, applies it and undoes it in one step", async ({
  page,
}) => {
  await agentBoard(page, "agents-connector");
  await openAgents(page);
  await chooseBrief(page);

  // The fixture in `apps/sync/ai-fake.mjs` returns two notes and one line; the map is
  // geometry only, so a line appears only when both ends are planned objects.
  await page
    .getByLabel("What should it draw?")
    .fill("Соедини две заметки FAKE_PLAN_CONNECTED");
  await page.getByRole("button", { name: "Ask the agent" }).click();

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("Objects: 2 · connectors: 1 · actions: 3");
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(0);

  await expect(plan.locator(".agent-plan-map-svg rect")).toHaveCount(2);
  await expect(plan.locator(".agent-plan-map-svg line")).toHaveCount(1);
  const line = plan.locator(".agent-plan-map-svg line");
  const from = await line.getAttribute("x1");
  const to = await line.getAttribute("x2");
  expect(Number(to)).toBeGreaterThan(Number(from));

  await plan.getByRole("button", { name: "Apply" }).click();
  await expect(plan).toContainText(
    "The objects are on the room. One ⌘Z removes the whole structure.",
  );
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(3);

  const created = await page.evaluate(() => {
    const widgets = window.__remo.widgets;
    const typeOf = (id: string | null) =>
      widgets.find((widget) => widget.id === id)?.type ?? null;
    const xOf = (id: string | null) =>
      widgets.find((widget) => widget.id === id)?.x ?? null;
    const lines = widgets.filter((widget) => widget.type === "connector");
    return {
      notes: widgets.filter((widget) => widget.type === "sticky_note").length,
      lines: lines.map((connector) => ({
        startType: typeOf(connector.start),
        endType: typeOf(connector.end),
        startX: xOf(connector.start),
        endX: xOf(connector.end),
        arrow: connector.arrow,
      })),
    };
  });
  expect(created.notes).toBe(2);
  expect(created.lines).toHaveLength(1);
  // The line joins the two notes left to right, exactly as the plan said.
  expect(created.lines[0]).toMatchObject({
    startType: "sticky_note",
    endType: "sticky_note",
    arrow: "end",
  });
  expect(created.lines[0]!.startX!).toBeLessThan(created.lines[0]!.endX!);

  await plan.getByRole("button", { name: "Show on room" }).click();
  await expect(plan).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(0);
});

test("an out-of-bounds plan is readable but cannot be applied", async ({ page }) => {
  await agentBoard(page, "agents-oob");
  await openAgents(page);
  await chooseBrief(page);

  // The fixture in `apps/sync/ai-fake.mjs` returns a valid plan whose far box reaches
  // past the coordinate limit: the server stores it, the estimate warns, the person
  // sees what is wrong and cannot approve it.
  await page
    .getByLabel("What should it draw?")
    .fill("Собери карту FAKE_PLAN_OUT_OF_BOUNDS");
  await page.getByRole("button", { name: "Ask the agent" }).click();

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("PLAN_OUT_OF_BOUNDS");
  await expect(plan.locator(".agent-plan-warning-list .is-critical")).toHaveCount(1);
  await expect(plan.getByRole("alert")).toContainText("Apply is blocked");
  await expect(plan.getByRole("button", { name: "Apply" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(0);

  await plan.getByRole("button", { name: "Reject" }).click();
  await expect(plan).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(0);
});

test("the attach field refuses a wrong type and an oversized file in words", async ({
  page,
}) => {
  await agentBoard(page, "agents-file");
  await openAgents(page);
  await chooseBrief(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: "brief.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7", "utf8"),
  });
  await expect(page.locator(".agent-file [role=alert]")).toContainText(
    "Attach a .md, .txt or .csv file",
  );
  await expect(page.getByRole("button", { name: "Ask the agent" })).toBeDisabled();
  await expect(page.locator(".agent-file-limits")).toContainText("100 000 bytes");

  await page.locator('input[type="file"]').setInputFiles({
    name: "huge.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(100_001, "a"),
  });
  await expect(page.locator(".agent-file [role=alert]")).toContainText(
    "larger than 100 000 bytes",
  );
  await expect(page.locator(".agent-file-chip")).toHaveCount(0);
});

test("a viewer cannot read or approve a plan, and a stranger cannot see it", async ({
  page,
  browser,
}) => {
  const board = await agentBoard(page, "agents-access");
  const created = await page.request.post(`/api/boards/${board.boardId}/agent-tasks`, {
    data: {
      agentId: board.agentId,
      intent: "Собери US-карту",
      skillSlug: "brief-to-board",
      budget: BUDGET,
    },
  });
  expect(created.status(), await created.text()).toBe(202);
  const task = (await created.json()) as { task: { id: string } };

  await expect
    .poll(
      async () =>
        (await page.request.get(`/api/agent-tasks/${task.task.id}/plan`)).status(),
      { timeout: 20_000 },
    )
    .toBe(200);

  const viewer = await browser.newPage();
  const email = `e2e-viewer-${Date.now()}@example.com`;
  const registered = await viewer.request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "Viewer" },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const viewerUser = (await registered.json()) as { user: { id: string } };
  const invitation = await page.request.post(`/api/orgs/${board.orgId}/invitations`, {
    data: { email },
  });
  expect(invitation.ok(), await invitation.text()).toBeTruthy();
  const invited = (await invitation.json()) as { url: string };
  await viewer.request.post("/api/invitations/accept", {
    data: { token: new URL(invited.url).searchParams.get("invite") },
  });
  await page.request.post(`/api/boards/${board.boardId}/grants`, {
    data: { subjectType: "user", subjectId: viewerUser.user.id, role: "viewer" },
  });

  const read = await viewer.request.get(`/api/agent-tasks/${task.task.id}/plan`);
  expect(read.status()).toBe(403);
  const approve = await viewer.request.post(
    `/api/agent-tasks/${task.task.id}/plan/approve`,
  );
  expect(approve.status()).toBe(403);

  await openBoard(viewer, board.boardId, { user: "Viewer" });
  await openMore(viewer);
  await expect(viewer.getByRole("menuitem", { name: "Ask AI…" })).toHaveCount(0);

  const stranger = await browser.newPage();
  const outsider = await stranger.request.post("/api/auth/register", {
    data: {
      email: `e2e-outsider-${Date.now()}@example.com`,
      password: "e2e-password-123",
      name: "Outsider",
    },
  });
  expect(outsider.status(), await outsider.text()).toBe(201);
  const hidden = await stranger.request.get(`/api/agent-tasks/${task.task.id}/plan`);
  expect(hidden.status()).toBe(404);

  await viewer.close();
  await stranger.close();
});
