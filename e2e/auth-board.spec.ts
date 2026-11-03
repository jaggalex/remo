import { test, expect } from "@playwright/test";
import { PASSWORD, addSticky, freshBoard, openAccount, openBoard, register } from "./helpers";

test("a new account opens its board, adds a note and the server confirms the save", async ({
  page,
}) => {
  await freshBoard(page, "auth");
  await addSticky(page);
  // The name is on the avatar, with the full name in its tooltip (spec §10, Ш3).
  await expect(page.locator(".account-button")).toHaveAttribute("title", /you/);
});

test("a signed-out visitor signs in from the access gate", async ({ page, browser }) => {
  const account = await register(page, "gate", { title: "Private launch" });

  // A second browser context has no session cookie, so the private board answers 401
  // and the gate is the only way in.
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  try {
    await visitor.goto(`/?room=${account.boardId}&lang=en`);
    await expect(visitor.locator(".access-gate")).toBeVisible({ timeout: 20_000 });
    await visitor.getByRole("button", { name: "Sign in" }).click();

    const dialog = visitor.locator(".auth-dialog");
    await expect(dialog).toBeVisible();
    // Playwright's actionability check waits for the element to receive the click. The
    // gate used to share --z-dialog with the backdrop and, being later in the DOM, paint
    // over the dialog: visible to a locator, unreachable for a person (ADR-139).
    await dialog.locator('input[type="email"]').fill(account.email);
    await dialog.locator('input[type="password"]').fill(PASSWORD);
    await dialog.getByRole("button", { name: "Sign in" }).click();

    await expect(visitor.locator(".access-gate")).toHaveCount(0, { timeout: 20_000 });
    await expect(visitor.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  } finally {
    await stranger.close();
  }
});

test("two sessions of one account are two follow targets with labels", async ({
  page,
  browser,
}) => {
  const account = await register(page, "sessions", { user: "Sess" });
  await openBoard(page, account.boardId);

  const second = await browser.newContext();
  const other = await second.newPage();
  try {
    const login = await other.request.post("/api/auth/login", {
      data: { email: account.email, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    await other.goto(`/?room=${account.boardId}&lang=en`);
    await expect(other.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

    // Presence is per session: the later one gets an index, and neither label is an email.
    await expect(page.locator(".presence .peer")).toHaveCount(1);
    await expect(other.locator(".presence .peer")).toHaveCount(1);
    const later = await page.locator(".presence .peer").getAttribute("title");
    const earlier = await other.locator(".presence .peer").getAttribute("title");
    expect(later).toContain("Sess (2)");
    expect(earlier).toContain("Sess");
    expect(later).not.toContain("@");

    // Follow the exact session, not the account as a whole.
    await page.locator(".presence .peer").click();
    await expect(page.locator(".follow-pill")).toContainText("Following Sess (2)");
    await expect(other.locator(".follow-counter")).toContainText("1");
  } finally {
    await second.close();
  }
});

test("theme and language follow the account to another browser", async ({ page, browser }) => {
  const account = await register(page, "prefs", { user: "Prefs Owner" });
  await openBoard(page, account.boardId);
  await openAccount(page);

  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "Russian" }).click();

  // The account row is the source for the second browser (ADR-150).
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/auth/me");
      const body = (await response.json()) as {
        user: { preferences: { theme: string | null; lang: string | null } };
      };
      return body.user.preferences;
    })
    .toEqual({ theme: "dark", lang: "ru" });

  const second = await browser.newContext();
  const other = await second.newPage();
  try {
    const login = await other.request.post("/api/auth/login", {
      data: { email: account.email, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    await other.goto(`/?room=${account.boardId}`);
    await expect(other.locator(".save-state")).toHaveText(/saved|сохранено/i, { timeout: 20_000 });
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(other.locator("html")).toHaveAttribute("lang", "ru");
  } finally {
    await second.close();
  }
});

test("the account menu lists active sessions and ends this browser", async ({ page }) => {
  await freshBoard(page, "sessions-ui");
  await openAccount(page);
  await page.getByRole("button", { name: "Active sessions" }).click();

  const dialog = page.getByRole("dialog", { name: "Active sessions" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".session-list li")).toHaveCount(1);
  await expect(dialog.locator(".session-current")).toHaveText("This browser");

  await dialog.getByRole("button", { name: "Sign out here" }).click();
  await expect(page.locator(".account-button")).toHaveAttribute(
    "aria-label",
    "Account and interface",
    { timeout: 15_000 },
  );
});

test("signing out returns the board to its signed-out state", async ({ page }) => {
  await freshBoard(page, "signout");
  await openAccount(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  // Without an account the menu keeps theme, language and the way back in.
  await expect(page.locator(".account-button")).toHaveAttribute(
    "aria-label",
    "Account and interface",
    { timeout: 15_000 },
  );
});

test("a cookie mutation must come from this origin and echo the CSRF cookie", async ({
  page,
}) => {
  const account = await register(page, "csrf");
  await openBoard(page, account.boardId);
  const origin = new URL(page.url()).origin;
  const path = `/api/boards/${account.boardId}/duplicate`;

  // What a hostile page would send: the session cookie rides along, the origin does not
  // match, and the double-submit token is not readable from another origin (ADR-062).
  const foreign = await page.request.post(path, {
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);

  const missing = await page.request.post(path, { headers: { Origin: origin } });
  expect(missing.status()).toBe(403);

  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "remo_csrf");
  expect(csrf?.value).toBeTruthy();
  const accepted = await page.request.post(path, {
    headers: { Origin: origin, "X-CSRF-Token": csrf?.value ?? "" },
  });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
});
