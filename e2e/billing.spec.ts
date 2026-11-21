import { expect, test, type Page } from "@playwright/test";
import { freshBoard, openAccount } from "./helpers";

/**
 * Browser acceptance for the plan surface (ADR-247, `spec/billing.md` §11 and §13).
 *
 * Billing is a product mode: `REMO_BILLING=off` is the self-host default and must keep
 * the 0.4.1 scenario set untouched. This file therefore runs only in a run that started
 * sync with the feature on (`pnpm e2e --billing`): off, every test here is a declared
 * skip, never a failure, and the ordinary gate is unchanged.
 *
 * A fresh e2e database has no price book and no payment connection. Prices and
 * connections are operator data (`pnpm billing:prices seed`, `pnpm billing:providers`),
 * with no HTTP route that could create them, so the invoice scenario below is a skip
 * until an operator seeds the run. Everything the catalogue already answers is asserted:
 * an empty catalogue is an empty shop, not an error.
 */

const BILLING_ON = process.env.E2E_BILLING === "1";

test.skip(
  !BILLING_ON,
  "billing scenarios need `pnpm e2e --billing` (sync starts with REMO_BILLING=on)",
);

/** Open the organisation screen from the account menu, on either the board or the home. */
async function openOrganisation(page: Page): Promise<void> {
  await openAccount(page);
  await page.getByRole("button", { name: "Organisation and people" }).click();
  await expect(page.locator(".org-dialog")).toBeVisible();
}

/** Create a shared organisation the way a person does: the screen, not the API. */
async function createSharedOrganisation(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "+ New organisation" }).click();
  await page.locator(".org-create input").first().fill(name);
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.getByRole("dialog", { name })).toBeVisible();
}

/** Rooms created through the same command route the home uses; returns their ids. */
async function createRooms(
  page: Page,
  orgId: string,
  count: number,
  prefix: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const created = await page.request.post(`/api/orgs/${orgId}/boards`, {
      data: { title: `${prefix} ${index}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const body = (await created.json()) as { board: { id: string } };
    ids.push(body.board.id);
  }
  return ids;
}

test("the plan tab shows the free plan and an empty price book", async ({ page }) => {
  await freshBoard(page, "billing-tab");
  await page.getByRole("button", { name: "All rooms" }).click();
  await openOrganisation(page);

  // A personal organisation always has the tab while billing is on; it cannot buy a plan.
  await expect(page.getByRole("tab", { name: "Plan & payment" })).toBeVisible();

  // A plan belongs to a shared organisation, so create one through the screen first.
  await createSharedOrganisation(page, "Billing team");
  const tab = page.getByRole("tab", { name: "Plan & payment" });
  await expect(tab).toBeVisible();
  await tab.click();

  const panel = page.locator(".billing-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator(".billing-facts")).toContainText("Free");
  await expect(page.locator(".billing-usage").first()).toContainText("Rooms 0/5");

  // A fresh installation sells nothing yet (§2.1.1: a currency without a complete price
  // list is hidden). The catalogue says so instead of inventing a price.
  const catalog = await page.request.get("/api/billing/catalog");
  expect(catalog.ok()).toBeTruthy();
  expect((await catalog.json()) as { currencies: unknown[] }).toEqual({ currencies: [] });

  const loaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/billing/catalog",
  );
  await page.getByRole("button", { name: "Change plan" }).click();
  expect((await loaded).status()).toBe(200);

  const chooser = page.locator(".billing-choose");
  await expect(chooser).toContainText("Choose a plan");
  // No error and no plan: "not for sale" is different from "the request failed".
  await expect(chooser.locator(".auth-error")).toHaveCount(0);
  await expect(chooser).not.toContainText("Pro");
  await expect(panel.getByRole("button", { name: /^Pay / })).toHaveCount(0);
});

test("the tab is absent when the billing family answers 404", async ({ page }) => {
  await freshBoard(page, "billing-off");
  await page.getByRole("button", { name: "All rooms" }).click();

  // The off installation answers 404 for the whole family (proved for the server by
  // `payment-providers.test.mjs`, "is a 404 for the whole family when billing is off"),
  // and the tab must not exist (§8). A second server is a second run, so the probe
  // receives the same answer here.
  await page.route(/\/api\/orgs\/[^/]+\/billing$/, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE", message: "not found" }),
    }),
  );
  const probe = page.waitForResponse((response) =>
    /\/orgs\/[^/]+\/billing$/.test(new URL(response.url()).pathname),
  );
  await openOrganisation(page);
  expect((await probe).status()).toBe(404);

  await expect(page.getByRole("tab", { name: "People" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Plan & payment" })).toHaveCount(0);
});

test("Free keeps five rooms and names the sixth refusal", async ({ page }) => {
  const account = await freshBoard(page, "billing-rooms");
  // The helper already made one room; four more reach the Free ceiling of five.
  await createRooms(page, account.orgId, 4, "Room");
  await page.getByRole("button", { name: "All rooms" }).click();
  await expect(page.locator(".home-tile")).toHaveCount(5);

  // The server owns the decision: a §2.4 plan refusal, not a 500 and not silence.
  const refused = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
    data: { title: "Sixth by API" },
  });
  expect(refused.status()).toBe(402);
  expect(await refused.json()).toMatchObject({
    error: "PLAN_LIMIT",
    limit: "rooms",
    current: 5,
    max: 5,
    plan: "free",
  });

  // The same refusal from the form becomes one banner with the one useful action.
  await page.getByRole("button", { name: "New room" }).click();
  const dialog = page.locator(".new-board-dialog");
  await dialog.getByLabel("Name").fill("Sixth room");
  await dialog.getByRole("button", { name: "Create room" }).click();

  const notice = page.locator(".plan-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Plan limit: active rooms 5/5");
  await expect(notice.getByRole("button", { name: "See plans" })).toBeVisible();
  // A plan refusal is not a failed form: the ordinary error line stays empty.
  await expect(dialog.locator(".auth-error")).toHaveCount(0);

  await notice.getByRole("button", { name: "See plans" }).click();
  await expect(page.locator(".org-dialog")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Plan & payment" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".billing-usage").first()).toContainText("Rooms 5/5");
});

test("the owner chooses which rooms stay active from the plan tab", async ({ page }) => {
  const account = await freshBoard(page, "billing-picker");
  // Five rooms is exactly the Free ceiling: the choice is the owner's, not a repair.
  const extra = await createRooms(page, account.orgId, 4, "Picker");
  await page.getByRole("button", { name: "All rooms" }).click();
  await openOrganisation(page);
  await page.getByRole("tab", { name: "Plan & payment" }).click();

  const panel = page.locator(".billing-panel");
  await expect(panel.locator(".billing-usage").first()).toContainText("Rooms 5/5");

  // At the limit the chooser waits behind the owner's button (§2.5).
  await panel.getByRole("button", { name: "Change active rooms" }).click();
  const list = panel.locator(".billing-rooms-list");
  await expect(list.getByRole("checkbox")).toHaveCount(5);
  await expect(panel.locator(".billing-rooms-count")).toContainText("5 of 5");

  // Keep the first board and Picker 1–3; Picker 4 becomes read-only.
  for (const box of await list.getByRole("checkbox").all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await expect(panel.locator(".billing-rooms-count")).toContainText("0 of 5");
  for (const title of ["billing-picker board", "Picker 1", "Picker 2", "Picker 3"]) {
    await list.getByRole("checkbox", { name: title, exact: true }).check();
  }
  await expect(panel.locator(".billing-rooms-count")).toContainText("4 of 5");
  await expect(panel.locator(".billing-warning")).toContainText(
    "Only 4 of 5 are selected",
  );

  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.locator(".billing-rooms-saved")).toContainText("Saved");

  // The fifth room keeps its content and loses editing, exactly as the spec says.
  const frozenId = extra[extra.length - 1]!;
  await page.goto(`/?room=${frozenId}&lang=en`);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeDisabled();
});

test("a frozen room keeps its content and loses editing", async ({ page }) => {
  const account = await freshBoard(page, "billing-frozen");
  const extra = await createRooms(page, account.orgId, 4, "Kept");
  const frozenId = extra[extra.length - 1]!;
  const active = [account.boardId, ...extra.slice(0, 3)];

  // The owner's explicit choice of active rooms is the one freeze route the server has.
  const chosen = await page.request.put(`/api/orgs/${account.orgId}/billing/frozen-rooms`, {
    data: { boardIds: active },
  });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
  expect(await chosen.json()).toEqual({ activeRooms: 4 });

  // The frozen room is readable and exportable, and nothing else (§2.5).
  const access = await page.request.get(`/api/boards/${frozenId}/access`);
  expect(access.ok()).toBeTruthy();
  const { access: decision } = (await access.json()) as {
    access: { allowed: boolean; capabilities: string[] };
  };
  expect(decision.allowed).toBe(true);
  expect(decision.capabilities).toContain("board.read");
  expect(decision.capabilities).not.toContain("board.edit");
  expect(decision.capabilities).toContain("board.export");
  expect(decision.capabilities).toContain("board.backup");

  // The screen follows the same decision: the tool rail is there and dimmed.
  await page.goto(`/?room=${frozenId}&lang=en`);
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeDisabled();
});

test("a room over the plan limit shows the read-only banner", async () => {
  // `usage.rooms > limits.rooms` is only reached by a plan downgrade, and a downgrade is
  // an operator act: `pnpm billing:grant` is a CLI and no HTTP route changes a plan. The
  // browser run therefore cannot prepare the state; what such a state rests on — the
  // frozen room being read-only — is asserted in the scenario above.
  test.skip(
    true,
    "needs an operator downgrade (pnpm billing:grant) to leave usage.rooms above the plan limit",
  );
});

test("paying by invoice creates an invoice for a shared organisation", async ({ page }) => {
  // The public catalogue is the only browser-readable proof of what can be bought. Prices
  // and connections are operator data (§2.1, §5): there is no HTTP route that seeds them,
  // so without a seeded run this scenario cannot start a checkout.
  const catalog = await page.request.get("/api/billing/catalog");
  expect(catalog.ok()).toBeTruthy();
  const { currencies } = (await catalog.json()) as {
    currencies: Array<{ currency: string; methodGroups: string[] }>;
  };
  const invoiceCurrency = currencies.find((offer) => offer.methodGroups.includes("invoice"));
  test.skip(
    !invoiceCurrency,
    "needs an operator seed: `pnpm billing:prices seed` and a live `invoice` connection " +
      "from `pnpm billing:providers` (neither has an HTTP route)",
  );

  await freshBoard(page, "billing-invoice");
  // A personal organisation cannot buy a plan; the invoice belongs to a shared one.
  const created = await page.request.post("/api/orgs", { data: { name: "Invoice team" } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { org } = (await created.json()) as { org: { slug: string } };

  await page.goto(`/?org=${encodeURIComponent(org.slug)}&lang=en`);
  await openOrganisation(page);
  await page.getByRole("tab", { name: "Plan & payment" }).click();
  await expect(page.locator(".billing-panel")).toBeVisible();
  await page.getByRole("button", { name: "Change plan" }).click();

  const chooser = page.locator(".billing-choose");
  await expect(chooser).toContainText("Choose a plan");
  await chooser.getByRole("radio", { name: "Invoice for a company" }).check();
  await chooser.getByRole("checkbox").check();
  await chooser.getByRole("button", { name: /^Pay / }).click();

  // The manual provider's widget is the instruction text; the invoice is already open.
  const instructions = page.locator(".billing-instructions");
  await expect(instructions).toBeVisible();
  await expect(instructions).toContainText("The invoice is open.");
  await expect(page.locator(".billing-invoices")).toContainText("Awaiting payment");
});

test("the owner replaces the saved card through the provider's page", async ({ page }) => {
  // A card is saved only by a checkout, and a checkout needs a price and a card route —
  // both operator data (`spec/billing.md` §2.1, §5) with no HTTP route. With the empty
  // catalogue of the ordinary run there is nothing to buy, so the scenario declares why.
  const catalog = await page.request.get("/api/billing/catalog");
  expect(catalog.ok()).toBeTruthy();
  const { currencies } = (await catalog.json()) as {
    currencies: Array<{ currency: string; methodGroups: string[] }>;
  };
  const cardOffer = currencies.find((offer) => offer.methodGroups.includes("ru_card"));
  test.skip(
    !cardOffer,
    "needs an operator seed: `pnpm billing:prices seed` and a live `fake` connection for " +
      "`ru_card` from `pnpm billing:providers` (neither has an HTTP route)",
  );

  // A personal organisation cannot buy a plan; the card belongs to a shared one.
  await freshBoard(page, "billing-card");
  const created = await page.request.post("/api/orgs", { data: { name: "Card team" } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { org } = (await created.json()) as { org: { slug: string } };
  const home = `/?org=${encodeURIComponent(org.slug)}&lang=en`;

  const openBilling = async () => {
    await page.goto(home);
    await openOrganisation(page);
    await page.getByRole("tab", { name: "Plan & payment" }).click();
    await expect(page.locator(".billing-panel")).toBeVisible();
  };

  await openBilling();

  // The first purchase is what makes the provider keep a card: the replacement verb
  // exists only next to a saved method, so the scenario buys the plan once.
  await page.getByRole("button", { name: "Change plan" }).click();
  const chooser = page.locator(".billing-choose");
  await expect(chooser).toContainText("Choose a plan");
  await chooser.getByRole("radio", { name: "Russian bank card or SBP" }).check();
  await chooser.getByRole("checkbox").check();
  await Promise.all([
    page.waitForURL(/[?&]fake_pay=/),
    chooser.getByRole("button", { name: /^Pay / }).click(),
  ]);

  // The fake provider's page is the redirect the checkout returned (ADR-248 §7).
  await Promise.all([
    page.waitForURL(/billing=return/),
    page.getByRole("button", { name: "Success" }).click(),
  ]);

  await openBilling();
  const card = page.locator(".billing-card");
  await expect(card).toContainText("•••• 4242");

  // "Replace" is the same checkout for the same plan, with autopay consent: the
  // provider is asked for a reusable token and the screen shows what it kept (§8.1).
  await Promise.all([
    page.waitForURL(/[?&]fake_pay=/),
    card.getByRole("button", { name: "Replace" }).click(),
  ]);
  await Promise.all([
    page.waitForURL(/billing=return/),
    page.getByRole("button", { name: "Success" }).click(),
  ]);

  await openBilling();
  await expect(page.locator(".billing-card")).toContainText("•••• 4242");
});
