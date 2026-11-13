import { test, expect } from "@playwright/test";
import { freshBoard, PASSWORD, waitForBoardEditor, type Account } from "./helpers";

interface View {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

async function view(page: import("@playwright/test").Page): Promise<View> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __remo: { camera: View["camera"] } }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

/** World point → client point; `x`/`y` are the widget's centre. */
function toClient(at: View, world: { x: number; y: number }) {
  return {
    x: at.rect.left + at.rect.width / 2 + (world.x - at.camera.x) * at.camera.zoom,
    y: at.rect.top + at.rect.height / 2 + (world.y - at.camera.y) * at.camera.zoom,
  };
}

async function box(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((widgetId) => {
    const probe = (window as unknown as {
      __remo: { widgets: Array<{ id: string; x: number; y: number; width: number; height: number }> };
    }).__remo;
    const widget = probe.widgets.find((entry) => entry.id === widgetId);
    if (!widget) throw new Error(`no widget ${widgetId}`);
    return { x: widget.x, y: widget.y, width: widget.width, height: widget.height };
  }, id);
}

test("the author releases the lock, another editor is refused, copies are unlocked", async ({
  page,
  browser,
}) => {
  const account: Account = await freshBoard(page, "lock", { user: "Owner" });
  const origin = new URL(page.url()).origin;

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await page.locator(".inline-editor").fill("Locked note");
  await page.keyboard.press("Escape");
  const widgetId = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );

  await page.keyboard.press("Meta+Shift+l");
  await expect(page.locator(".badge-lock")).toHaveCount(1);
  await expect(page.locator(".badge-lock")).toHaveAttribute("title", /Owner/);

  // ADR-210: the lock protects content and size, not placement — the object travels.
  const before = await box(page, widgetId);
  const at = await view(page);
  const centre = toClient(at, before);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 90, centre.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const moved = await box(page, widgetId);
  expect(Math.abs(moved.x - before.x - 90 / at.camera.zoom)).toBeLessThan(30);
  expect(Math.abs(moved.y - before.y - 60 / at.camera.zoom)).toBeLessThan(30);
  expect(moved.width).toBe(before.width);
  expect(moved.height).toBe(before.height);
  await expect(page.locator(".badge-lock")).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  const undone = await box(page, widgetId);
  expect(Math.round(undone.x)).toBe(Math.round(before.x));
  expect(Math.round(undone.y)).toBe(Math.round(before.y));

  // A duplicate is a new decision: it must not inherit the lock (ADR-107).
  await page.keyboard.press("Meta+d");
  await expect(page.locator(".badge-lock")).toHaveCount(0);

  const second = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const email = `e2e-lock-editor-${Date.now()}@example.com`;
  const registered = await second.request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: "Editor" },
  });
  const editor = (await registered.json()) as { user: { id: string } };
  const invite = await page.request.post(`/api/orgs/${account.orgId}/invitations`, {
    data: { email },
  });
  const invited = (await invite.json()) as { url: string };
  await second.request.post("/api/invitations/accept", {
    data: { token: new URL(invited.url).searchParams.get("invite") },
  });
  await page.request.post(`/api/boards/${account.boardId}/grants`, {
    data: { subjectType: "user", subjectId: editor.user.id, role: "editor" },
  });

  const editorPage = await second.newPage();
  await editorPage.goto(
    `${origin}/?room=${account.boardId}&lang=en&user=Editor&select=${widgetId}`,
  );
  await waitForBoardEditor(editorPage);
  await expect(editorPage.locator(".badge-lock")).toHaveCount(1);

  // Another editor may not release it; the refusal names the author.
  await editorPage.keyboard.press("Meta+Shift+l");
  await expect(editorPage.locator(".canvas-notice")).toContainText("Owner locked this object");
  await expect(editorPage.locator(".badge-lock")).toHaveCount(1);

  // The author can; the second page sees the change over the document socket.
  await page.goto(`${origin}/?room=${account.boardId}&lang=en&user=Owner&select=${widgetId}`);
  await waitForBoardEditor(page);
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  )).toEqual([widgetId]);
  await expect(page.locator(".badge-lock")).toHaveCount(1);
  await page.keyboard.press("Meta+Shift+l");
  await expect(page.locator(".badge-lock")).toHaveCount(0);
  await expect(editorPage.locator(".badge-lock")).toHaveCount(0, { timeout: 10_000 });

  await second.close();
});
