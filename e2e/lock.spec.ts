import { test, expect } from "@playwright/test";
import { freshBoard, PASSWORD, waitForBoardEditor, type Account } from "./helpers";

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
