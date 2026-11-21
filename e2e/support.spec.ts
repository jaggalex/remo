/**
 * The support entry and the isolated widget (ADR-250, `spec/support.md` §2, §7).
 *
 * The provider is an installation setting, not something a browser can choose, so each
 * scenario reads `GET /api/support/config` and skips when the run is configured for
 * another mode:
 *
 *   pnpm e2e                                   # none: no entry anywhere
 *   E2E_SUPPORT_PROVIDER=link \
 *     E2E_SUPPORT_URL=https://support.example.test/help \
 *     pnpm e2e e2e/support.spec.ts             # link: a new tab, exactly that URL
 *   E2E_SUPPORT_PROVIDER=chatwoot \
 *     E2E_SUPPORT_ORIGIN=http://127.0.0.1:8099 \
 *     E2E_SUPPORT_HMAC_SECRET=test \
 *     E2E_SUPPORT_CONTEXT_TOKEN=test \
 *     pnpm e2e e2e/support.spec.ts             # chatwoot: the panel, its frame, its messages
 *
 * The `chatwoot` run has no operator page to frame, so the scenario serves a fake one from
 * the configured origin — but only when that origin is a loopback address, so a developer
 * who pointed the run at a real installation never has their widget replaced by this file.
 */
import { test, expect, type Page } from "@playwright/test";
import { register } from "./helpers";

interface SupportConfig {
  provider: "none" | "link" | "chatwoot";
  url?: string;
  origin?: string;
  hours: { ru: string; en: string };
}

interface Relayed {
  relay: { type?: string; technical?: unknown; identity?: unknown } | null;
  from: string;
}

/**
 * The fake `widget.html`. It records what it receives and relays every message to the
 * embedding page, because a cross-origin frame takes its records with it: the `reset`
 * arrives a moment before the frame is removed, and only the parent outlives it.
 */
const WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake widget</title></head>
<body><p id="ready">widget</p>
<script>
  window.__supportMessages = [];
  window.addEventListener("message", (event) => {
    window.__supportMessages.push(event.data);
    parent.postMessage({ relay: event.data, from: event.origin }, "*");
  });
</script>
</body></html>`;

function isLoopback(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
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

/** The messages the fake widget relayed to the app, newest last. */
async function relayed(page: Page): Promise<Relayed[]> {
  return page.evaluate(
    () => ((window as unknown as { __supportRelayed: Relayed[] }).__supportRelayed ?? []),
  );
}

/** Serve the fake page for the configured origin and record what it relays. */
async function fakeWidget(page: Page, origin: string): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __supportRelayed: unknown[] }).__supportRelayed = [];
    window.addEventListener("message", (event) => {
      const data = event.data as { relay?: unknown } | null;
      if (data && typeof data === "object" && "relay" in data) {
        (window as unknown as { __supportRelayed: unknown[] }).__supportRelayed.push(data);
      }
    });
  });
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: WIDGET_HTML }),
  );
}

test("with support off nothing new appears", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "none", "this run configured a support provider");

  await register(page, "support-off");
  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await expect(page.getByRole("button", { name: "Help and support" })).toHaveCount(0);

  // The help centre is public and always reachable; its support link is not (§2.4).
  await page.goto("/help/en/account.support");
  await expect(page.getByRole("button", { name: "Write to support" })).toHaveCount(0);
  await expect(page.getByText("Help and support", { exact: true })).toHaveCount(0);
});

test("link mode opens the configured page in a new tab", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "link", "run with E2E_SUPPORT_PROVIDER=link");
  expect(config.url).toBeTruthy();

  await register(page, "support-link");
  // `window.open` is the observable product action; the target page belongs to the
  // operator and is not part of this repository.
  await page.addInitScript(() => {
    (window as unknown as { __supportOpen: string[] }).__supportOpen = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __supportOpen: string[] }).__supportOpen.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Help and support" }).click();

  const opened = () =>
    page.evaluate(() => (window as unknown as { __supportOpen: string[] }).__supportOpen);
  expect(await opened()).toEqual([config.url]);

  // The help centre offers the same destination to a signed-in reader. A navigation
  // re-runs the init script, so the counter starts again.
  await page.goto("/help/en/account.support");
  const link = page.getByRole("button", { name: "Write to support" });
  await expect(link).toBeVisible();
  await link.click();
  expect(await opened()).toEqual([config.url]);
});

test("the help centre offers support only to a signed-in reader", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider === "none", "no support surface in this run");

  await page.goto("/help/en/account.support");
  await expect(page.getByRole("button", { name: "Write to support" })).toHaveCount(0);

  await register(page, "support-help");
  await page.goto("/help/en/account.support");
  await expect(page.getByRole("button", { name: "Write to support" })).toBeVisible();
});

test("chatwoot mode frames only the configured origin", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "chatwoot", "run with E2E_SUPPORT_PROVIDER=chatwoot");
  expect(config.origin).toBeTruthy();
  test.skip(!isLoopback(config.origin!), `not a loopback origin: ${config.origin}`);

  await fakeWidget(page, config.origin!);
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

  // The identity arrives as a message pinned to the one configured origin.
  await expect.poll(async () => (await relayed(page)).length).toBeGreaterThan(0);
  const first = await relayed(page);
  expect(first[0]?.from).toBe(new URL(page.url()).origin);
  expect(first[0]?.relay).toMatchObject({ type: "remo:support:identity" });
});

test("technical information is opt-in and carries the client errors", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "chatwoot", "run with E2E_SUPPORT_PROVIDER=chatwoot");
  test.skip(!isLoopback(config.origin!), `not a loopback origin: ${config.origin}`);

  await fakeWidget(page, config.origin!);
  const account = await register(page, "support-consent");
  await page.goto(`/?room=${encodeURIComponent(account.boardId)}&lang=en`);

  // One real client failure in the buffer: the panel's promise is that it travels.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e synthetic failure");
    }, 0);
  });

  await openAccountMenu(page);
  await page.getByRole("button", { name: "Help and support" }).click();
  const checkbox = page.getByLabel("Attach technical information");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await expect.poll(async () => (await relayed(page)).map((entry) => entry.relay?.type)).toContain(
    "remo:support:identity",
  );
  expect((await relayed(page)).map((entry) => entry.relay?.type)).not.toContain("remo:support:technical");

  await checkbox.check();
  await expect
    .poll(async () => (await relayed(page)).map((entry) => entry.relay?.type))
    .toContain("remo:support:technical");

  const technical = (await relayed(page)).find((entry) => entry.relay?.type === "remo:support:technical")
    ?.relay?.technical as {
    app: string;
    browser: string;
    os: string;
    room: { id: string; role: string | null } | null;
    connection: string;
    errors: Array<{ message: string; at: number }>;
  };

  expect(technical.app).toMatch(/\d+\.\d+/);
  expect(technical.browser).not.toBe("");
  expect(technical.os).not.toBe("");
  // The room id and the role, never the room's name or its content (§2.4).
  expect(technical.room?.id).toBe(account.boardId);
  expect(typeof technical.room?.role).toBe("string");
  expect(technical.connection).not.toBe("");
  expect(technical.errors.map((entry) => entry.message)).toContain("e2e synthetic failure");
  expect(JSON.stringify(technical)).not.toContain("support-consent board");
});

test("signing out tells the widget to reset", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider !== "chatwoot", "run with E2E_SUPPORT_PROVIDER=chatwoot");
  test.skip(!isLoopback(config.origin!), `not a loopback origin: ${config.origin}`);

  await fakeWidget(page, config.origin!);
  await register(page, "support-reset");
  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Help and support" }).click();
  await expect.poll(async () => (await relayed(page)).length).toBeGreaterThan(0);

  // The panel stays open beside the menu: signing out happens with the widget listening.
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect
    .poll(async () => (await relayed(page)).map((entry) => entry.relay?.type))
    .toContain("remo:support:reset");
  await expect(page.locator(".support-panel")).toHaveCount(0);
});

test("a signed-out visitor is never offered support", async ({ page }) => {
  const config = await supportMode(page);
  test.skip(config.provider === "none", "no support surface in this run");

  await page.goto("/?lang=en");
  await openAccountMenu(page);
  await expect(page.getByRole("button", { name: "Help and support" })).toHaveCount(0);
});
