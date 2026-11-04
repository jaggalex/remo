import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";

function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export interface Account {
  email: string;
  orgId: string;
  boardId: string;
}

/**
 * Register an account and create an empty board through the same API the app uses,
 * then open it in the browser with a known display name and language.
 *
 * Going through the API keeps the scenario about the product, not about typing into a
 * sign-up form before every test.
 */
export async function register(
  page: Page,
  tag: string,
  options: { user?: string; title?: string } = {},
): Promise<Account> {
  const email = uniqueEmail(tag);
  const registered = await page.request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: options.user ?? tag },
  });
  if (!registered.ok()) throw new Error(`register failed: ${await registered.text()}`);
  const body = (await registered.json()) as { org: { id: string } };

  const created = await page.request.post(`/api/orgs/${body.org.id}/boards`, {
    data: { title: options.title ?? `${tag} board` },
  });
  if (!created.ok()) throw new Error(`create board failed: ${await created.text()}`);
  const board = (await created.json()) as { board: { id: string } };

  return { email, orgId: body.org.id, boardId: board.board.id };
}

export async function openBoard(
  page: Page,
  boardId: string,
  options: { user?: string; lang?: "en" | "ru"; template?: string } = {},
): Promise<void> {
  const user = options.user ? `&user=${encodeURIComponent(options.user)}` : "";
  const template = options.template ? `&template=${encodeURIComponent(options.template)}` : "";
  await page.goto(`/?room=${boardId}&lang=${options.lang ?? "en"}${user}${template}`);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
}

/** Document sync can finish before the HTTP access decision enables editing. */
export async function waitForBoardEditor(page: Page): Promise<void> {
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled();
}

/** Select the requested kanban card, or the first card when none is specified. */
export async function selectKanbanCard(page: Page, cardId?: string): Promise<string> {
  await waitForBoardEditor(page);
  // After a reload the document arrives over the socket; the probe is empty until then.
  await page.waitForFunction((wanted) => {
    const probe = window as unknown as {
      __remo?: { layouts: Array<{ placements: Array<{ cardId: string }> }> };
    };
    return Boolean(probe.__remo?.layouts?.some((entry) =>
      entry.placements.some((placement) => !wanted || placement.cardId === wanted),
    ));
  }, cardId);
  const point = await page.evaluate((wanted) => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{ placements: Array<{ cardId: string; x: number; y: number }> }>;
      };
    };
    const placement = probe.__remo.layouts
      .flatMap((entry) => entry.placements)
      .find((entry) => !wanted || entry.cardId === wanted)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      id: placement.cardId,
      x: rect.left + rect.width / 2 + (placement.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (placement.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  }, cardId);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  )).toEqual([point.id]);
  return point.id;
}

/** A fresh account plus an open, empty board. */
export async function freshBoard(
  page: Page,
  tag: string,
  options: { user?: string; title?: string; template?: string } = {},
): Promise<Account> {
  const account = await register(page, tag, options);
  await openBoard(page, account.boardId, {
    user: options.user,
    template: options.template ?? "kanban-framework",
  });
  await waitForBoardEditor(page);
  return account;
}

export interface AgentBoard extends Account {
  agentId: string;
}

/**
 * An open board whose organisation and board allow agents, with one agent of its own.
 *
 * The plan scenarios need the same three switches every time; setting them through the
 * API keeps the test about the preview, not about clicking through the organisation
 * screen before it (ADR-142).
 */
export async function agentBoard(page: Page, tag: string): Promise<AgentBoard> {
  const account = await register(page, tag);
  await openBoard(page, account.boardId);

  const policy = await page.request.put(`/api/orgs/${account.orgId}/agent-policy`, {
    data: { agentsEnabled: true },
  });
  expect(policy.ok(), await policy.text()).toBeTruthy();
  const created = await page.request.post(`/api/orgs/${account.orgId}/agents`, {
    data: { name: "Planner" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { agent: { id: string } };
  const enabled = await page.request.put(`/api/boards/${account.boardId}/agents`, {
    data: { enabled: true },
  });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();

  return { ...account, agentId: body.agent.id };
}

/**
 * The four header menus (ADR-119). They are DS menus: opening one moves
 * focus inside, Escape closes it and returns focus to the trigger.
 */
export async function openBoardMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Board menu:/ }).click();
}

export async function openFacilitation(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Facilitation", exact: true }).click();
}

export async function openMore(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
}

export async function openAccount(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Account and interface/ }).click();
}

/**
 * Discussion and presentation live in the header, as icons (ADR-119,
 * П1). The name carries the unread count, so the locator matches the start of it.
 */
export async function openComments(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Discussion/ }).click();
}

export async function startPresentation(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
}

export async function addSticky(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  // A new sticky opens ready to type; an untouched one is removed on exit (M0).
  // Give the scenarios a real note so the next pointer gesture has something to hit.
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  const id = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );
  await editor.fill("Note");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await expect(page.locator(".counts li", { hasText: "Sticky note" })).toContainText(/\d+/);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  return id;
}

export async function enableLink(page: Page, boardId: string): Promise<void> {
  const response = await page.request.put(`/api/boards/${boardId}/link`, {
    data: { enabled: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/**
 * Watch the save counter, then wait until a new edit has been acknowledged.
 *
 * Waiting for `/saved/` alone can pass on the previous acknowledgement; the counter
 * proves that a later update existed and that the server confirmed it.
 */
export async function watchSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector(".save-state");
    if (!el) return;
    const state = window as unknown as { __saveMax?: number; __saveObserver?: MutationObserver };
    state.__saveMax = 0;
    state.__saveObserver?.disconnect();
    state.__saveObserver = new MutationObserver(() => {
      const pending = Number(el.getAttribute("data-pending") ?? "0");
      if (pending > (state.__saveMax ?? 0)) state.__saveMax = pending;
    });
    state.__saveObserver.observe(el, {
      attributes: true,
      attributeFilter: ["data-pending", "data-state"],
    });
  });
}

export async function savedAfterEdit(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => Number((window as unknown as { __saveMax?: number }).__saveMax ?? 0),
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });
  await expect(page.locator(".save-state")).toHaveAttribute("data-pending", "0");
}

/** Place a comment on an empty point of the board and submit the composer. */
export async function addComment(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "New comment" }).click();
  const canvas = page.locator(".layer.overlay");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not visible");
  await page.mouse.click(box.x + 40, box.y + box.height - 60);
  const composer = page.locator(".comment-composer textarea");
  await expect(composer).toBeVisible();
  await composer.fill(text);
  await page.locator(".comment-composer").getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".comments-thread")).toContainText(text);
}

let seedKey = 0;

function seedHeaders(): Record<string, string> {
  seedKey += 1;
  return { "Idempotency-Key": `e2e-seed-${Date.now()}-${seedKey}` };
}

/**
 * Create an object through the same command API the product uses, before the browser
 * opens the board.
 *
 * A scenario that needs exact coordinates (a marquee rectangle, a pair of notes and the
 * line between them) should not spend its first lines dragging objects into place.
 */
export async function seedObject(
  page: Page,
  boardId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const response = await page.request.post(`/api/boards/${boardId}/commands`, {
    headers: seedHeaders(),
    data: { command: "board.item.create", input },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { result: { id: string } };
  return body.result.id;
}

export async function seedNote(
  page: Page,
  boardId: string,
  at: { x: number; y: number },
  size = { width: 160, height: 180 },
  content = "",
  parentId?: string,
): Promise<string> {
  return seedObject(page, boardId, {
    type: "sticky_note",
    x: at.x,
    y: at.y,
    ...size,
    content,
    ...(parentId ? { parentId } : {}),
  });
}

/** A connector between two seeded objects; the line is derived from their boxes. */
export async function seedConnector(
  page: Page,
  boardId: string,
  from: string,
  to: string,
): Promise<string> {
  const response = await page.request.post(`/api/boards/${boardId}/commands`, {
    headers: seedHeaders(),
    data: { command: "board.connector.create", input: { from, to } },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { result: { id: string } };
  return body.result.id;
}
