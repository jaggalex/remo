/**
 * Mail-backed account flows (ADR-246, `spec/mail.md` §9).
 *
 * The console driver appends one JSON line per letter; the scenario reads the link the
 * same way a person reads their inbox. Nothing here stubs the server: registration,
 * reset and invitations run through the real outbox and drain.
 */
import { readFile, truncate } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { PASSWORD, register } from "./helpers";
import { MAIL_FILE } from "./ports";

const LINK = /https?:\/\/[^\s"'<>]+/;

async function emptyMailbox() {
  await truncate(MAIL_FILE, 0).catch(() => {});
}

async function letterLink(email: string, contains: string): Promise<string> {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    try {
      const lines = (await readFile(MAIL_FILE, "utf8")).split("\n").filter(Boolean);
      for (const line of lines) {
        const letter = JSON.parse(line) as { to: string; text: string };
        if (letter.to !== email) continue;
        if (!letter.text.includes(contains)) continue;
        const match = LINK.exec(letter.text);
        if (match) return match[0];
      }
    } catch {
      // The file does not exist until the first letter is sent.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no letter with ${contains} for ${email}`);
}

test.beforeEach(async () => {
  await emptyMailbox();
});

test("registration sends a confirmation letter and the banner disappears after it", async ({
  page,
}) => {
  const { email } = await register(page, "verify-mail");

  await page.goto("/?lang=en");
  await expect(page.getByText("Confirm your email")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText("A confirmed address lets you invite people and receive letters"),
  ).toBeVisible();

  const link = await letterLink(email, "?verify=");
  await page.goto(`${link}&lang=en`);
  await expect(page.getByText("Email confirmed")).toBeVisible({ timeout: 20_000 });

  await page.goto("/?lang=en");
  await expect(page.getByText("Confirm your email")).toHaveCount(0);
  await expect(page.locator(".account-button")).toHaveCount(1);
});

test("a forgotten password arrives by letter, resets the account and ends old sessions", async ({
  page,
  browser,
}) => {
  const { email } = await register(page, "forgot-mail");

  // A second signed-in browser proves the reset signs every session out.
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await other.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
    expect((await other.request.get("/api/auth/me")).status()).toBe(200);

    await page.request.post("/api/auth/logout");
    await page.goto("/?forgot=1&lang=en");
    const forgot = page.getByRole("dialog", { name: "Reset your password" });
    await forgot.locator('input[type="email"]').fill(email);
    await forgot.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByText("If an account with this address exists")).toBeVisible();

    const link = await letterLink(email, "?reset=");
    const token = new URL(link).searchParams.get("reset");
    expect(token?.length).toBeGreaterThan(30);

    await page.goto(`${link}&lang=en`);
    const reset = page.getByRole("dialog", { name: "New password" });
    await reset.locator('input[type="password"]').fill("a brand new e2e passphrase");
    await reset.getByRole("button", { name: "Save password" }).click();

    await expect(page.locator(".auth-hint")).toContainText("Password changed", {
      timeout: 20_000,
    });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill("a brand new e2e passphrase");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page.locator(".account-button")).toHaveCount(1, { timeout: 20_000 });

    await other.goto("/?lang=en");
    expect((await other.request.get("/api/auth/me")).status()).toBe(401);
  } finally {
    await second.close();
  }
});

test("an invitation letter opens the invitation and is accepted after signing in", async ({
  page,
  browser,
}) => {
  const owner = await register(page, "invite-mail-owner");
  const invited = await browser.newContext();
  try {
    const guest = await invited.newPage();
    const { email } = await register(guest, "invite-mail-guest");
    await guest.request.post("/api/auth/logout");

    const invitation = await page.request.post(`/api/orgs/${owner.orgId}/invitations`, {
      data: { email },
    });
    expect(invitation.ok()).toBeTruthy();
    const body = (await invitation.json()) as { emailQueued: boolean };
    expect(body.emailQueued).toBe(true);

    const link = await letterLink(email, "?invite=");
    await guest.goto(`${link}&lang=en`);
    const prompt = guest.getByRole("dialog", { name: "You are invited" });
    await prompt.getByRole("button", { name: "Sign in to accept" }).click();
    const login = guest.getByRole("dialog").filter({ has: guest.locator('input[type="email"]') });
    await login.locator('input[type="email"]').fill(email);
    await login.locator('input[type="password"]').fill(PASSWORD);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await prompt.getByRole("button", { name: "Accept invitation" }).click();

    const org = await page.request.get(`/api/orgs/${owner.orgId}`);
    const { org: summary } = (await org.json()) as { org: { slug: string } };
    await expect(guest).toHaveURL(
      (current) =>
        current.searchParams.get("org") === summary.slug && !current.searchParams.has("invite"),
    );
  } finally {
    await invited.close();
  }
});
