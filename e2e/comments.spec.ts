import { test, expect, type Page } from "@playwright/test";
import { addComment, addSticky, freshBoard, openBoard, openComments, type Account } from "./helpers";

test("a comment thread survives a reload, has a pin, and resolve hides it", async ({ page }) => {
  await freshBoard(page, "comments");
  await openComments(page);
  await expect(page.locator(".comments-panel")).toBeVisible();
  await addComment(page, "First comment");
  // The thread is anchored to the centre of the view, so a pin marks that place.
  await expect(page.locator(".comment-pin")).toHaveCount(1);

  const reply = page.locator(".comment-reply textarea");
  await reply.fill("A reply");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".comments-thread")).toContainText("A reply");

  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator(".comments-list li")).toHaveCount(0);
  await expect(page.locator(".comment-pin")).toHaveCount(0);
  await page.locator(".comments-toggle input").check();
  await expect(page.locator(".comments-list li")).toHaveCount(1);
  await expect(page.locator(".comment-pin")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  // The resolved thread is still there, just hidden until asked for — pin included.
  await openComments(page);
  await page.locator(".comments-toggle input").check();
  await expect(page.locator(".comment-pin")).toHaveCount(1);
  await page.locator(".comment-pin").click();
  await expect(page.locator(".comments-thread")).toContainText("A reply");
});

test("a comment on one tab reaches another tab through the socket nudge", async ({ page }) => {
  const account: Account = await freshBoard(page, "comments-live");
  const second = await page.context().newPage();
  await openBoard(second, account.boardId);

  await openComments(page);
  await addComment(page, "Live comment");

  // No reload and no polling: the empty frame of type 11 makes the other tab reload.
  await expect(second.locator(".comment-pin")).toHaveCount(1, { timeout: 10_000 });
  await second.close();
});

test("a commenter on another account sees the pin and replies live", async ({ page, browser }) => {
  const account = await freshBoard(page, "comments-account");
  const origin = new URL(page.url()).origin;
  await openComments(page);
  await addComment(page, "From the owner");

  // A real second account, not a second tab: `commenter` holds board.comment only.
  const second = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const email = `e2e-commenter-${Date.now()}@example.com`;
  const registered = await second.request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "Commenter" },
  });
  const commenter = (await registered.json()) as { user: { id: string } };
  const invite = await page.request.post(`/api/orgs/${account.orgId}/invitations`, {
    data: { email },
  });
  const invited = (await invite.json()) as { url: string };
  await second.request.post("/api/invitations/accept", {
    data: { token: new URL(invited.url).searchParams.get("invite") },
  });
  await page.request.post(`/api/boards/${account.boardId}/grants`, {
    data: { subjectType: "user", subjectId: commenter.user.id, role: "commenter" },
  });

  const commenterPage = await second.newPage();
  await openBoard(commenterPage, account.boardId, { user: "Commenter" });
  await expect(commenterPage.locator(".comment-pin")).toHaveCount(1, { timeout: 10_000 });

  await commenterPage.locator(".comment-pin").click();
  await expect(commenterPage.locator(".comments-thread")).toContainText("From the owner");
  await commenterPage.locator(".comment-reply textarea").fill("From the commenter");
  await commenterPage.getByRole("button", { name: "Send" }).click();
  await expect(commenterPage.locator(".comments-thread")).toContainText("From the commenter");

  // The owner's open thread receives the reply without a reload or a poll.
  await expect(page.locator(".comments-thread")).toContainText("From the commenter", {
    timeout: 10_000,
  });
  await second.close();
});

/** World point → client point for the only note on an empty board. */
async function noteClientPoint(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        widgets: Array<{ type: string; x: number; y: number }>;
        camera: { x: number; y: number; zoom: number };
      };
    };
    const note = probe.__remo.widgets.find((widget) => widget.type === "sticky_note");
    if (!note) throw new Error("no note on the board");
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (note.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (note.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  });
}

test("a comment pin is under an open object panel and never takes its click", async ({ page }) => {
  await freshBoard(page, "comments-layers", { template: "empty" });
  await addSticky(page);

  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await expect(bar).toBeVisible();
  const firstBar = (await bar.boundingBox())!;
  // Deselect: the bar goes away, so a comment can be placed exactly where the bar will
  // return. The placement layer is the social layer, below every panel (ADR-139).
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  await openComments(page);
  await page.getByRole("button", { name: "New comment" }).click();
  // Anchored near the bottom of the bar's box: the pin's 28 px body then sits inside the
  // box the bar will occupy once the note is selected again.
  const anchor = { x: firstBar.x + firstBar.width / 2, y: firstBar.y + firstBar.height - 8 };
  await page.mouse.click(anchor.x, anchor.y);
  const composer = page.locator(".comment-composer textarea");
  await expect(composer).toBeVisible();
  await composer.fill("Pin under the panel");
  await page.locator(".comment-composer").getByRole("button", { name: "Create" }).click();
  const pin = page.locator(".comment-pin");
  await expect(pin).toHaveCount(1);

  // Select the note again: the bar returns over the pin's anchor.
  const note = await noteClientPoint(page);
  await page.mouse.click(note.x, note.y);
  await expect(bar).toBeVisible();

  // The higher layer owns the pixel: over the panel the hit target is the panel.
  const barBox = (await bar.boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return {
        pin: Boolean(element?.closest(".comment-pin")),
        panel: Boolean(element?.closest(".sticky-bar")),
      };
    },
    { x: barBox.x + barBox.width / 2, y: barBox.y + barBox.height / 2 },
  );
  expect(hit.panel).toBe(true);
  expect(hit.pin).toBe(false);

  // The layer ladder itself, not only this one overlap: social < panels.
  const layers = await page.evaluate(() => {
    const z = (selector: string) =>
      Number(getComputedStyle(document.querySelector(selector)!).zIndex);
    return { pins: z(".comment-pins"), panel: z(".sticky-bar") };
  });
  expect(layers.pins).toBeLessThan(layers.panel);
});
