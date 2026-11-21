/**
 * The support entry in the account menu (ADR-250, `spec/support.md` §2, §7).
 *
 * The provider is an installation setting, not something a browser can choose, so each
 * scenario reads `GET /api/support/config` and skips when the run is configured for
 * another mode:
 *
 *   pnpm e2e                                   # none: the entry must be absent
 *   E2E_SUPPORT_PROVIDER=link \
 *     E2E_SUPPORT_URL=https://support.example.test/help \
 *     pnpm e2e e2e/support.spec.ts             # link: a new tab, exactly that URL
 *   E2E_SUPPORT_PROVIDER=chatwoot \
 *     E2E_SUPPORT_ORIGIN=http://127.0.0.1:8099 \
 *     E2E_SUPPORT_HMAC_SECRET=test \
 *     E2E_SUPPORT_CONTEXT_TOKEN=test \
 *     pnpm e2e e2e/support.spec.ts             # chatwoot: the panel and its frame
 *
 * The chatwoot scenario needs a page at `<origin>/widget.html`; without one it skips
 * rather than asserting on a broken iframe the developer never served.
 */
import { test, expect, type Page } from "@playwright/test";
import { register } from "./helpers";

interface SupportConfig {
  provider: "none" | "link" | "chatwoot";
  url?: string;
  origin?: string;
  hours: { ru: string; en: string };
}

async function supportMode(page: Page): Promise<SupportConfig> {
  const response = await page.request.get("/api/support/config");
  if (response.status() === 404) {
    return { provider: "none", hours: { ru: "", en: "" } };
  }
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as SupportConfig;
}

async function openAccountMenu(page: Page): Promise<void> {
  await page.locator(".account-button").click();
  await expect(page.getByRole("dialog", { name: "Account and interface" })).toBeVisible();
}

test("with support off the account menu has no entry", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "none", "this run configured a support provider");

  await register(page, "support-off");
  await page.goto("/?lang=en");
  await openAccountMenu(page);

  await expect(page.getByRole("button", { name: "Help and support" })).toHaveCount(0);
});

test("link mode opens the configured page in a new tab", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "link", "run with E2E_SUPPORT_PROVIDER=link");
  expect(config.url).toBeTruthy();

  await register(page, "support-link");
  // `window.open` is the observable product action; the target page belongs to the
  // operator and is not part of this repository.
  await page.addInitScript(() => {
    (window as unknown as { __supportOpen: string[][] }).__supportOpen = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __supportOpen: string[][] }).__supportOpen.push([String(url)]);
      return null;
    }) as typeof window.open;
  });
  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Help and support" }).click();

  const opened = await page.evaluate(
    () => (window as unknown as { __supportOpen: string[][] }).__supportOpen,
  );
  expect(opened).toEqual([[config.url]]);
});

test("chatwoot mode frames only the configured origin", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "chatwoot", "run with E2E_SUPPORT_PROVIDER=chatwoot");
  expect(config.origin).toBeTruthy();

  // A page that does not answer is not a failure of remo: the developer did not start
  // the fake widget, so there is nothing to frame.
  const widget = await page.request.get(`${config.origin}/widget.html`).catch(() => null);
  test.skip(!widget?.ok(), `no widget page at ${config.origin}`);

  await register(page, "support-widget");
  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Help and support" }).click();

  const panel = page.locator(".support-panel");
  await expect(panel).toBeVisible();
  const frame = panel.locator("iframe");
  await expect(frame).toHaveAttribute("src", `${config.origin}/widget.html?lang=en`);
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);
});

test("a signed-out visitor is never offered support", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider === "none", "no support surface in this run");

  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await expect(page.getByRole("button", { name: "Help and support" })).toHaveCount(0);
});
