import { test, expect } from "@playwright/test";
import { PASSWORD, addSticky, enableLink, freshBoard, openAccount, openBoard, register } from "./helpers";

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

test("an organisation invitation works after signing in from the link", async ({ page, browser }) => {
  const owner = await register(page, "invite-org");
  const invited = await browser.newContext();
  try {
    const guest = await invited.newPage();
    const { email } = await register(guest, "invited-member");
    expect((await guest.request.post("/api/auth/logout")).ok()).toBeTruthy();

    const invitation = await page.request.post(`/api/orgs/${owner.orgId}/invitations`, {
      data: { email },
    });
    expect(invitation.ok()).toBeTruthy();
    const { url } = await invitation.json() as { url: string };
    await guest.goto(`/${new URL(url).search}&lang=en`);

    const prompt = guest.getByRole("dialog", { name: "You are invited" });
    await prompt.getByRole("button", { name: "Sign in to accept" }).click();
    const login = guest.locator(".auth-dialog");
    await login.locator('input[type="email"]').fill(email);
    await login.locator('input[type="password"]').fill(PASSWORD);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await prompt.getByRole("button", { name: "Accept invitation" }).click();

    const org = await page.request.get(`/api/orgs/${owner.orgId}`);
    const { org: { slug } } = await org.json() as { org: { slug: string } };
    await expect(guest).toHaveURL((current) =>
      current.searchParams.get("org") === slug && !current.searchParams.has("invite"));
    await expect(prompt).toHaveCount(0);
  } finally {
    await invited.close();
  }
});

test("a guest invitation opens its room after acceptance", async ({ page, browser }) => {
  const owner = await register(page, "invite-room");
  const invited = await browser.newContext();
  try {
    const guest = await invited.newPage();
    const { email } = await register(guest, "invited-guest");
    const invitation = await page.request.post(`/api/boards/${owner.boardId}/invitations`, {
      data: { email, role: "viewer" },
    });
    expect(invitation.ok()).toBeTruthy();
    const { url } = await invitation.json() as { url: string };
    await guest.goto(`/${new URL(url).search}&lang=en`);
    await guest.getByRole("dialog", { name: "You are invited" })
      .getByRole("button", { name: "Accept invitation" }).click();

    await expect(guest).toHaveURL((current) =>
      current.searchParams.get("room") === owner.boardId && !current.searchParams.has("invite"));
    await expect(guest.locator(".rm-readonly")).toContainText("View only");
    await expect(guest.locator(".save-state")).toHaveText(/saved/i);
  } finally {
    await invited.close();
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

    // Presence is per session: the later one gets an index, and neither label is an
    // email — the @ belongs to the public handle (ADR-164).
    await expect(page.locator(".presence .peer")).toHaveCount(1);
    await expect(other.locator(".presence .peer")).toHaveCount(1);
    const later = await page.locator(".presence .peer").getAttribute("title");
    const earlier = await other.locator(".presence .peer").getAttribute("title");
    expect(later).toContain("Sess (2)");
    expect(earlier).toContain("Sess");
    expect(later).toContain("@");
    expect(later).not.toContain(account.email);

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

  // The two controls live at the right edge of the header (ADR-194), not in the menu.
  await page.getByRole("button", { name: /Theme: light/ }).click();
  await page.getByRole("button", { name: /Language: English/ }).click();

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
  // Without an account the header still offers theme and language, and the menu
  // offers the way back in.
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

test("a public-link visitor who signs in gets a writable socket", async ({ page, browser }) => {
  const account = await register(page, "link-signin", { title: "Link sign-in" });
  await enableLink(page, account.boardId);

  const context = await browser.newContext();
  const visitor = await context.newPage();
  try {
    await visitor.goto(`/?room=${account.boardId}&lang=en`);
    await expect(visitor.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

    await openAccount(visitor);
    await visitor.getByRole("button", { name: "Sign in", exact: true }).click();
    const dialog = visitor.locator(".auth-dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="email"]').fill(account.email);
    await dialog.locator('input[type="password"]').fill(PASSWORD);
    await dialog.getByRole("button", { name: "Sign in" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    // The socket must be rebuilt with the account's editor rights. Otherwise the note
    // stays pending forever and disappears on reload.
    await addSticky(visitor);
    await visitor.reload();
    await expect(visitor.locator(".counts li", { hasText: "Sticky note" })).toContainText(
      "1",
      { timeout: 20_000 },
    );
  } finally {
    await context.close();
  }
});

test("renames the account from the menu", async ({ page }) => {
  await freshBoard(page, "rename-account", { user: "Before" });
  await openAccount(page);
  const field = page.locator(".account-name-field");
  await field.getByLabel("Account name").fill("After");
  await field.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".account-button")).toHaveAttribute("title", /After/);

  await page.reload();
  await expect(page.locator(".account-button")).toHaveAttribute("title", /After/);
});

test("changes the account handle and keeps it after a reload", async ({ page }) => {
  await freshBoard(page, "handle-account", { user: "Handle" });
  await openAccount(page);
  const field = page.locator(".account-name-field");
  await field.getByLabel("Handle").fill("handle.person");
  await field.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".account-who")).toContainText("@handle.person");

  await page.reload();
  await openAccount(page);
  await expect(page.locator(".account-who")).toContainText("@handle.person");
});
