import { test, expect } from "@playwright/test";
import {
  addSticky,
  enableLink,
  freshBoard,
  openAccount,
  openBoard,
  openBoardMenu,
  register,
} from "./helpers";

test("creates a board from the board list and opens the chosen template", async ({ page }) => {
  await freshBoard(page, "create");

  await page.getByRole("button", { name: "All rooms" }).click();
  await page.getByRole("button", { name: "New room" }).click();
  await page.locator(".new-board-dialog input").fill("M0 launch");
  await page.locator(".new-board-dialog select").selectOption("kanban-framework");
  await page.locator(".new-board-dialog .primary-button").click();

  await expect(page).toHaveURL(/room=m0-launch/);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Room menu: M0 launch/ })).toBeVisible();
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

  // ADR-197: the inspector starts closed; open it to reach the deep-link action.
  await page.getByRole("button", { name: "Properties" }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`room=${account.boardId}`);
  expect(copied).toContain("select=");
});

test("an empty board stays empty and a rename reaches the board list", async ({ page }) => {
  await freshBoard(page, "empty");

  await page.getByRole("button", { name: "All rooms" }).click();
  await page.getByRole("button", { name: "New room" }).click();
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

  await page.getByRole("button", { name: "All rooms" }).click();
  // The topbar button is also called "Room menu: Renamed launch"; the tile is the one
  // that proves the stored name reached the directory.
  await expect(
    page.locator(".home-tile").getByRole("button", { name: /Renamed launch/ }),
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
  await expect.poll(() => page.evaluate(
    () =>
      (window as unknown as { __remo: { widgets: Array<{ id: string }> } }).__remo.widgets.map(
        (widget) => widget.id,
      ),
  )).toContain(stickyId);
});

test("switches the organisation and leaves the previous board", async ({ page }) => {
  await freshBoard(page, "org-filter", { title: "First org board" });

  // A second organisation is created through the same screen people use.
  await openAccount(page);
  await page.getByRole("button", { name: "Organisation and people" }).click();
  await page.getByRole("button", { name: "+ New organisation" }).click();
  await page.locator(".org-create input").first().fill("Second team");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.locator(".org-dialog h2")).toHaveText("Second team");
  await page.locator(".org-dialog").getByRole("button", { name: "Close" }).click();

  // A board in that organisation, so the filter has something to switch between.
  await page.getByRole("button", { name: "All rooms" }).click();
  await page.getByRole("button", { name: "New room" }).click();
  const create = page.locator(".new-board-dialog");
  await create.locator("input").first().fill("Second org board");
  await create.getByLabel("Organisation").selectOption({ label: "Second team" });
  await create.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await page.getByRole("button", { name: "All rooms" }).click();
  const home = page.locator(".home");
  // Switch to the organisation that holds the new board. The board's own org is not
  // assumed here: the point is that the list follows the organisation context.
  await home.getByLabel("Organisation").selectOption({ label: "Second team" });
  await expect(home).toContainText("Second org board");
  await expect(home).not.toContainText("First org board");

  // Switching is a full context switch: the previous board is gone and the new list is
  // the personal organisation's boards.
  await home
    .getByLabel("Organisation")
    .selectOption({ label: "Personal · org-filter" });
  await expect(page).toHaveURL(/\?org=/);
  await expect(page.locator(".home")).toContainText("First org board");
  await expect(page.locator(".home")).not.toContainText("Second org board");
});

test("finds a board by its name on the home", async ({ page }) => {
  const account = await freshBoard(page, "title-search", { title: "Quarterly planning" });
  for (let index = 1; index <= 24; index += 1) {
    const created = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
      data: { title: `Search page ${String(index).padStart(2, "0")}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  await page.getByRole("button", { name: "All rooms" }).click();
  await page.locator(".home-search").fill("Quarterly");
  await expect(page.locator(".home-tile")).toHaveCount(1);
  await expect(page.locator(".home-tile")).toContainText("Quarterly planning");
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
    page.getByRole("button", { name: /^Room menu: Quarterly planning/ }),
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
    page.getByRole("button", { name: /^Room menu: Quarterly planning/ }),
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

test("?select= applies once and does not steal the next selection", async ({ page }) => {
  const account = await register(page, "select-once");
  await openBoard(page, account.boardId);
  const first = await addSticky(page);

  await page.goto(`/?room=${account.boardId}&lang=en&select=${first}`);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds))
    .toEqual([first]);
  await expect(page).not.toHaveURL(/select=/);

  const second = await addSticky(page);
  expect(second).not.toBe(first);
  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
  expect(selected).toEqual([second]);
});

test("a public-link viewer cannot add kanban columns or replace the board", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "viewer-ui", { title: "Viewer board" });
  await enableLink(page, account.boardId);

  const context = await browser.newContext();
  const viewer = await context.newPage();
  try {
    await viewer.goto(`/?room=${account.boardId}&lang=en`);
    await expect(viewer.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
    // ADR-197: the inspector starts closed; open it to read the read-only controls.
    await expect(viewer.locator(".inspector")).toBeHidden();
    await viewer.getByRole("button", { name: "Properties" }).click();
    const inspector = viewer.locator(".inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "+ column" })).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "+ swimlane" })).toBeDisabled();
    await expect(inspector.getByRole("button", { name: "Replace room" })).toBeDisabled();
  } finally {
    await context.close();
  }
});
