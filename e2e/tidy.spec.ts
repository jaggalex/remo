import { expect, test, type Page } from "@playwright/test";
import { openBoard, register, seedObject, seedNote } from "./helpers";

/**
 * "Tidy up" (ADR-143): a selection becomes even columns, one local transaction, one
 * ⌘Z. The deterministic engine is the same with or without a provider; the fake model
 * in `apps/sync/ai-fake.mjs` supplies labels for the "by meaning" scenario.
 */

interface ProbeWidget {
  id: string;
  type: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface Geometry {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: { camera: Geometry["camera"] };
    }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

function toClient(current: Geometry, world: { x: number; y: number }) {
  return {
    x: current.rect.left + current.rect.width / 2 + (world.x - current.camera.x) * current.camera.zoom,
    y: current.rect.top + current.rect.height / 2 + (world.y - current.camera.y) * current.camera.zoom,
  };
}

async function widgets(page: Page): Promise<ProbeWidget[]> {
  return page.evaluate(
    () => (window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets,
  );
}

async function enableAgents(page: Page, orgId: string, boardId: string): Promise<string> {
  const policy = await page.request.put(`/api/orgs/${orgId}/agent-policy`, {
    data: { agentsEnabled: true },
  });
  expect(policy.ok(), await policy.text()).toBeTruthy();
  const created = await page.request.post(`/api/orgs/${orgId}/agents`, {
    data: { name: "Planner" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const enabled = await page.request.put(`/api/boards/${boardId}/agents`, {
    data: { enabled: true },
  });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();
  return ((await created.json()) as { agent: { id: string } }).agent.id;
}

/** Click the first object, then Shift-click the rest: a marquee can start on a note. */
async function selectAll(page: Page): Promise<void> {
  const rows = await widgets(page);
  expect(rows.length).toBeGreaterThan(0);
  const current = await geometry(page);
  const first = toClient(current, { x: rows[0].x, y: rows[0].y });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  for (const row of rows.slice(1)) {
    const point = toClient(current, { x: row.x, y: row.y });
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.up("Shift");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds.length,
      ),
    )
    .toBe(rows.length);
}

async function openTidyFromBar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Tidy up", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tidy up selection" })).toBeVisible();
}

async function runTidy(page: Page): Promise<void> {
  const tidy = page.getByRole("dialog", { name: "Tidy up selection" });
  await tidy.getByRole("button", { name: "Tidy up", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Agent plan" })).toBeVisible({
    timeout: 20_000,
  });
}

test("five scattered notes become one even column and ⌘Z returns them", async ({ page }) => {
  const account = await register(page, "tidy-columns");
  const scattered = [
    { x: -600, y: 300, text: "US-5: ship" },
    { x: 0, y: -200, text: "US-2: cart" },
    { x: 700, y: 500, text: "US-10: refund" },
    { x: -300, y: -500, text: "US-1: browse" },
    { x: 400, y: 0, text: "US-3: pay" },
  ];
  for (const item of scattered) {
    await seedNote(page, account.boardId, { x: item.x, y: item.y }, undefined, item.text);
  }
  await openBoard(page, account.boardId);
  await enableAgents(page, account.orgId, account.boardId);
  const before = await widgets(page);
  expect(before).toHaveLength(5);

  await selectAll(page);
  await openTidyFromBar(page);
  await runTidy(page);

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toContainText("Moves: 5");
  await expect(plan).toContainText("Blocks: US");
  await plan.getByRole("button", { name: "Apply" }).click();
  await expect(plan).toContainText("One ⌘Z puts every object back.");
  await plan.getByRole("button", { name: "Show on room" }).click();

  const after = await widgets(page);
  expect(after).toHaveLength(6);
  const frame = after.find((widget) => widget.type === "frame");
  expect(frame).toBeTruthy();
  const notes = after
    .filter((widget) => widget.type === "sticky_note")
    .sort((a, b) => a.y - b.y);
  expect(notes).toHaveLength(5);
  // One column: every note shares the same centre x, and the reading order is natural.
  const xs = notes.map((note) => note.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5);
  expect(notes.map((note) => note.text)).toEqual([
    "US-1: browse",
    "US-2: cart",
    "US-3: pay",
    "US-5: ship",
    "US-10: refund",
  ]);
  expect(notes.every((note) => note.parentId === frame!.id)).toBe(true);

  // One transaction, one undo: the frame and every move go back together.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await widgets(page)).length).toBe(5);
  const restored = await widgets(page);
  for (const original of before) {
    expect(restored.find((widget) => widget.id === original.id)).toMatchObject({
      x: original.x,
      y: original.y,
    });
  }
});

test("a selected frame is laid out inside itself and the frame does not move", async ({
  page,
}) => {
  const account = await register(page, "tidy-frame");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 900,
    height: 900,
    title: "Lane",
  });
  for (const [index, x] of [-250, 0, 250].entries()) {
    await seedNote(
      page,
      account.boardId,
      { x, y: index * 140 - 120 },
      undefined,
      `US-${index + 1}`,
      frameId,
    );
  }
  await openBoard(page, account.boardId);
  await enableAgents(page, account.orgId, account.boardId);
  await expect.poll(async () => (await widgets(page)).length).toBe(4);

  const current = await geometry(page);
  const titlePoint = toClient(current, { x: 0, y: -430 });
  await page.mouse.click(titlePoint.x, titlePoint.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Tidy up", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tidy up selection" })).toBeVisible();
  await runTidy(page);

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toContainText("Moves: 3");
  await expect(plan).toContainText("new blocks: 0");
  await plan.getByRole("button", { name: "Apply" }).click();
  await plan.getByRole("button", { name: "Show on room" }).click();

  const after = await widgets(page);
  const frame = after.find((widget) => widget.id === frameId)!;
  expect(frame).toMatchObject({ x: 0, y: 0, width: 900, height: 900 });
  const notes = after.filter((widget) => widget.type === "sticky_note");
  expect(notes).toHaveLength(3);
  for (const note of notes) {
    expect(note.parentId).toBe(frameId);
    expect(Math.abs(note.x)).toBeLessThan(900 / 2 - 80);
    expect(Math.abs(note.y)).toBeLessThan(900 / 2 - 90);
  }
});

test("a model may name the blocks, and the person reads them before applying", async ({
  page,
}) => {
  const account = await register(page, "tidy-meaning");
  const texts = ["FAKE_TIDY_LABELS checkout", "pay by card", "refund flow", "ship it"];
  for (const [index, text] of texts.entries()) {
    await seedNote(page, account.boardId, { x: index * 260 - 400, y: (index % 2) * 200 }, undefined, text);
  }
  await openBoard(page, account.boardId);
  await enableAgents(page, account.orgId, account.boardId);

  await selectAll(page);
  await openTidyFromBar(page);
  const tidy = page.getByRole("dialog", { name: "Tidy up selection" });
  await tidy.getByRole("button", { name: "By meaning" }).click();
  await tidy.getByRole("button", { name: "Tidy up", exact: true }).click();

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("Blocks: Billing, Flow");
  await expect(plan.getByRole("button", { name: "By meaning" })).toHaveClass(
    /rm-btn-primary/,
  );
  // Switching the reading keeps the labels and recomputes only the geometry.
  await plan.getByRole("button", { name: "Grid" }).click();
  await expect(plan).toContainText("Moves: 4");
  await expect.poll(async () => (await widgets(page)).some((widget) => widget.type === "frame")).toBe(false);
});

test("a selection over the ceiling is refused, not previewed", async ({ page }) => {
  const account = await register(page, "tidy-ceiling");
  const ids: string[] = [];
  for (let index = 0; index < 201; index += 1) {
    ids.push(
      await seedNote(
        page,
        account.boardId,
        { x: (index % 20) * 200, y: Math.floor(index / 20) * 200 },
        undefined,
        `Object ${index}`,
      ),
    );
  }
  await openBoard(page, account.boardId);
  const agentId = await enableAgents(page, account.orgId, account.boardId);

  const created = await page.request.post(`/api/boards/${account.boardId}/agent-tasks`, {
    data: {
      agentId,
      intent: "Упорядочить выделение",
      skillSlug: "tidy-selection",
      selectionIds: ids,
      budget: { maxTokens: 4_000, maxActions: 900, maxCostUsd: 1 },
    },
  });
  expect(created.status(), await created.text()).toBe(202);
  const task = (await created.json()) as { task: { id: string } };

  await expect
    .poll(
      async () => {
        const row = await page.request.get(`/api/agent-tasks/${task.task.id}`);
        return row.ok() ? ((await row.json()) as { task: { status: string } }).task.status : "";
      },
      { timeout: 30_000 },
    )
    .toBe("failed");
  const row = await page.request.get(`/api/agent-tasks/${task.task.id}`);
  const body = (await row.json()) as { task: { error: string } };
  expect(body.task.error).toContain("PLAN_TOO_LARGE");
  const plan = await page.request.get(`/api/agent-tasks/${task.task.id}/plan`);
  expect(plan.status()).toBe(404);
});
