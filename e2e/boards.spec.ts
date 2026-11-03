import { test, expect } from "@playwright/test";
import { addSticky, freshBoard, openBoard, openBoardMenu, register } from "./helpers";

test("creates a board from the board list and opens the chosen template", async ({ page }) => {
  await freshBoard(page, "create");

  await page.getByRole("button", { name: "All boards" }).click();
  await page.getByRole("button", { name: "New board" }).click();
  await page.locator(".new-board-dialog input").fill("M0 launch");
  await page.locator(".new-board-dialog select").selectOption("kanban-framework");
  await page.locator(".new-board-dialog .primary-button").click();

  await expect(page).toHaveURL(/room=m0-launch/);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Board menu: M0 launch/ })).toBeVisible();
  await expect(page.locator(".counts li", { hasText: "Kanban" })).toContainText(/\d+/);
});

test("a new sticky takes the first keystroke and an untouched one disappears", async ({
  page,
}) => {
  await freshBoard(page, "sticky-focus");

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.type("First thought");
  await expect(editor).toContainText("First thought");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await expect(page.locator(".inline-editor")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await expect(page.locator(".counts li", { hasText: "Sticky note" })).toContainText("1");
});

test("copies a deep link to the selected object", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const account = await freshBoard(page, "copy-link");

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await page.locator(".inline-editor").fill("Linked note");
  await page.keyboard.press("Escape");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await page.getByRole("button", { name: "Copy link" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`room=${account.boardId}`);
  expect(copied).toContain("select=");
});

test("an empty board stays empty and a rename reaches the board list", async ({ page }) => {
  await freshBoard(page, "empty");

  await page.getByRole("button", { name: "All boards" }).click();
  await page.getByRole("button", { name: "New board" }).click();
  await page.locator(".new-board-dialog input").fill("Empty launch");
  await page.locator(".new-board-dialog select").selectOption("empty");
  await page.locator(".new-board-dialog .primary-button").click();

  await expect(page).toHaveURL(/room=empty-launch/);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.locator(".counts li")).toHaveCount(0);

  const boardId = new URL(page.url()).searchParams.get("room")!;
  // The name is a menu, and renaming is its first item (spec §10, Ш1).
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.locator(".board-title").fill("Renamed launch");
  await page.locator(".board-title").press("Enter");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  // The board list reads the SQL projection, which is written after the save ack.
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/boards");
        const data = (await response.json()) as {
          boards: Array<{ id: string; title: string | null }>;
        };
        return data.boards.find((board) => board.id === boardId)?.title;
      },
      { timeout: 20_000 },
    )
    .toBe("Renamed launch");

  await page.getByRole("button", { name: "All boards" }).click();
  // The topbar button is also called "Board menu: Renamed launch"; the list row is the
  // one that proves the stored name reached the directory.
  await expect(
    page.locator(".boards-panel").getByRole("button", { name: /Renamed launch/ }),
  ).toBeVisible();
});

test("a board with a non-ASCII name is one room, not a percent-encoded twin", async ({
  page,
}) => {
  // The socket path carries the room percent-encoded. y-websocket used to name the room
  // from that raw path, so a board called «Запуск продукта» got a second room
  // `%D0%97…`: the socket wrote there, and the board's own projection stayed empty
  // while a phantom row held the widgets (ADR-148).
  const account = await register(page, "cyrillic", { title: "Запуск продукта" });
  const room = account.boardId;
  expect(room.startsWith("запуск-продукта")).toBe(true);

  await openBoard(page, encodeURIComponent(room));
  const stickyId = await addSticky(page);
  // The read API is the projection of the board this page names. Before the fix the
  // widget was only under the encoded room, so this stayed empty.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/boards/${encodeURIComponent(room)}/widgets`,
        );
        const data = (await response.json()) as { widgets?: Array<{ id: string }> };
        return data.widgets?.some((widget) => widget.id === stickyId) ?? false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  const ids = await page.evaluate(
    () =>
      (window as unknown as { __remo: { widgets: Array<{ id: string }> } }).__remo.widgets.map(
        (widget) => widget.id,
      ),
  );
  expect(ids).toContain(stickyId);
});

test("finds a board by its name in the board panel", async ({ page }) => {
  const account = await freshBoard(page, "title-search", { title: "Quarterly planning" });
  await page.getByRole("button", { name: "All boards" }).click();
  await page.locator(".boards-search").fill("Quarterly");
  const section = page.locator(".boards-section").filter({ hasText: "Boards by title" });
  await expect(section).toContainText(account.boardId);
});

test("opening a named board without a template keeps its name and stays empty", async ({
  page,
}) => {
  // A board created through the API has a name in the row and nothing in the document.
  // Opening it must not treat the empty document title as "this board has no name":
  // that made a reload seed the default template over the board (S5a).
  const account = await register(page, "named-no-template", { title: "Quarterly planning" });
  await openBoard(page, account.boardId);
  await expect(
    page.getByRole("button", { name: /^Board menu: Quarterly planning/ }),
  ).toBeVisible();
  await expect(page.locator(".counts li")).toHaveCount(0);

  // The projection is refreshed 1.5 s after the room opens. Wait past it, then read the
  // stored name the app will see on reload.
  await page.waitForTimeout(2_500);
  const readTitle = async () => {
    const response = await page.request.get("/api/boards");
    const data = (await response.json()) as {
      boards: Array<{ id: string; title: string | null }>;
    };
    return data.boards.find((board) => board.id === account.boardId)?.title;
  };
  expect(await readTitle()).toBe("Quarterly planning");

  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: /^Board menu: Quarterly planning/ }),
  ).toBeVisible();
  await expect(page.locator(".counts li")).toHaveCount(0);
});

test("a copy of a board takes its stored name", async ({ page }) => {
  const account = await register(page, "copy-name", { title: "Quarterly planning" });
  await openBoard(page, account.boardId);
  // Same projection pass as above: it used to clear the row title, so the copy fell
  // back to "Untitled (copy)".
  await page.waitForTimeout(2_500);

  const response = await page.request.post(`/api/boards/${account.boardId}/duplicate`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { board: { title: string } };
  expect(body.board.title).toBe("Quarterly planning (copy)");
});
