import { expect, test, type Page } from "@playwright/test";
import {
  addSticky,
  agentBoard,
  freshBoard,
  openAccount,
  openBoardMenu,
  openFacilitation,
  openMore,
} from "./helpers";

/**
 * Visual evidence and screen contracts (roadmap Q2.1).
 *
 * PNGs in `spec/baselines/` are the artefact a person reviews; regenerate them with
 * `pnpm baselines`. The automated gate is a set of invariants that do not depend on the
 * platform's font rasterizer: connector pixels are sampled where the routing must differ,
 * and every dialog must fit the viewport without horizontal overflow.
 */
const update = Boolean(process.env.REMO_UPDATE_BASELINES);

async function capture(page: Page, target: ReturnType<Page["locator"]>, name: string) {
  if (!update) return;
  await target.screenshot({ path: `spec/baselines/${name}.png` });
}

function canvasPixels(page: Page) {
  return page.locator("[data-testid=connector-states] canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dark = (x: number, y: number) => {
      const index = (y * width + x) * 4;
      return data[index]! < 80 && data[index + 1]! < 80 && data[index + 2]! < 80;
    };
    const count = (fromX: number, toX: number, fromY: number, toY: number) => {
      let total = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) if (dark(x, y)) total += 1;
      }
      return total;
    };
    const signature = (fromY: number, toY: number) => {
      const cells: number[] = [];
      for (let row = 0; row < 5; row += 1) {
        for (let column = 0; column < 12; column += 1) {
          const x0 = 200 + column * 30;
          const y0 = fromY + row * ((toY - fromY) / 5);
          cells.push(count(x0, x0 + 30, y0, y0 + (toY - fromY) / 5));
        }
      }
      return cells.join(",");
    };
    return {
      // Between the notes, so the sticky text and borders are out of the sample.
      straight: count(300, 460, 84, 96),
      curved: count(300, 460, 350, 400),
      signatures: {
        straight: signature(60, 120),
        elbow: signature(180, 300),
        curved: signature(320, 430),
      },
      size: { width: canvas.width, height: canvas.height },
    };
  });
}

test("three connector routings paint differently", async ({ page }) => {
  await page.goto("/__ds?view=connectors&lang=en");
  const canvas = page.locator("[data-testid=connector-states] canvas");
  await expect(canvas).toBeVisible();

  const pixels = await canvasPixels(page);
  await capture(page, page.locator("[data-testid=connector-states]"), "connectors");
  if (update) {
    // The stage-1 debt named three baselines; each row is also its own file so a review
    // can look at one routing without hunting inside the overview.
    const box = await page.locator("[data-testid=connector-states] canvas").boundingBox();
    if (box) {
      for (const [name, top, height] of [
        ["straight", 30, 120],
        ["elbow", 160, 160],
        ["curved", 300, 155],
      ] as const) {
        await page.screenshot({
          path: `spec/baselines/connector-${name}.png`,
          clip: { x: box.x, y: box.y + top, width: box.width, height },
        });
      }
    }
  }
  console.log("connector pixels", pixels);

  expect(pixels.size).toEqual({ width: 760, height: 460 });
  // Every routing paints, the waypoint is on the line, and the three shapes are not the
  // same geometry rendered three times.
  expect(pixels.straight).toBeGreaterThan(100);
  expect(pixels.curved).toBeGreaterThan(100);
  expect(new Set(Object.values(pixels.signatures)).size).toBe(3);
});

test("the board, export, timer and vote screens fit the viewport", async ({ page }) => {
  const account = await freshBoard(page, "visual");
  await addSticky(page);

  const overflow = async () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
      offenders: [...document.querySelectorAll("*")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          className: String((element as HTMLElement).className).slice(0, 60),
          right: Math.round(element.getBoundingClientRect().right),
        })),
    }));
  const fits = async () => {
    const metrics = await overflow();
    console.log("viewport", metrics);
    return metrics.scrollWidth <= metrics.innerWidth;
  };
  expect(await fits()).toBe(true);
  await capture(page, page.locator("body"), "board");

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await expect(page.locator(".export-dialog")).toBeVisible();
  expect(await page.locator(".export-dialog .export-choice").count()).toBeGreaterThanOrEqual(5);
  expect(await fits()).toBe(true);
  await capture(page, page.locator(".export-dialog"), "export");
  await page.locator(".export-dialog .dialog-close").click();

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await expect(page.locator(".timer-dialog")).toBeVisible();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  await openFacilitation(page);
  await expect(page.getByRole("menuitem", { name: /Timer/ })).toContainText("05:00");
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await expect(page.locator(".timer-face")).toBeVisible();
  await capture(page, page.locator(".timer-dialog"), "timer");
  await page.locator(".timer-dialog .dialog-close").click();

  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ["obj-a", "obj-b"], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  const vote = page.getByRole("dialog", { name: "Voting session" });
  await expect(vote).toBeVisible();
  await expect(page.locator(".vote-list li")).toHaveCount(2);
  expect(await fits()).toBe(true);
  await capture(page, vote, "vote");
});

test("a card with fields is readable", async ({ page }) => {
  await freshBoard(page, "visual-card");

  const point = await page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{ placements: Array<{ x: number; y: number }> }>;
      };
    };
    const layout = probe.__remo.layouts.find((entry) => entry.placements.length > 0)!;
    const placement = layout.placements[0]!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (placement.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (placement.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  });
  await page.mouse.click(point.x, point.y);
  const fields = page.locator(".card-fields");
  await fields.locator("select").first().selectOption("in_progress");
  await fields.locator('input[type="date"]').first().fill("2026-10-30");
  await fields.locator('input[type="date"]').nth(1).fill("2026-10-31");
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  await capture(page, page.locator(".layer.board"), "card-fields");
});

/**
 * The rail and the bottom edge (ADR-119, §10.4).
 *
 * The rail is a panel of its own, every enabled tool is one colour, and the bottom-centre
 * plate never shares its slot with the zoom controls. All of that is geometry and
 * computed style, so it holds without a byte comparison; the PNGs are for the review.
 */
test("the rail is one panel and the bottom edge stays clear", async ({ page }) => {
  const account = await freshBoard(page, "visual-rail");
  const stickyId = await addSticky(page);
  // The hint is a first-use plate: show it for this frame, whatever ran before.
  await page.evaluate(() => window.localStorage.removeItem("remo.canvas.hint"));
  await page.reload();
  await expect(page.locator(".save-state")).toHaveText(/saved/i, { timeout: 20_000 });

  const frame = () =>
    page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const touches = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
        Boolean(a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom);
      const hud = box(".canvas-hud");
      const hint = box(".canvas-hint");
      const rail = box(".tool-rail");
      const panel = document.querySelector(".tool-rail-panel");
      const colours = [...document.querySelectorAll(".tool-rail .rm-iconbtn")].map((icon) => ({
        disabled: (icon as HTMLButtonElement).disabled,
        // The resting selection tool is the one pressed control on the rail.
        selected: icon.getAttribute("aria-pressed") === "true",
        colour: getComputedStyle(icon).color,
      }));
      const hintElement = document.querySelector<HTMLElement>(".canvas-hint");
      return {
        hud,
        hint,
        rail,
        hudAndHint: touches(hud, hint),
        hintClipped: hintElement ? hintElement.scrollWidth > hintElement.clientWidth + 1 : false,
        hintWraps: hintElement ? getComputedStyle(hintElement).whiteSpace : null,
        panels: document.querySelectorAll(".tool-rail-panel").length,
        railShadow: panel ? getComputedStyle(panel).boxShadow : "",
        railRadius: panel ? getComputedStyle(panel).borderRadius : "",
        tools: colours
          .filter((entry) => !entry.disabled && !entry.selected)
          .map((entry) => entry.colour),
        selected: colours.filter((entry) => entry.selected).map((entry) => entry.colour),
        stops: colours.filter((entry) => entry.disabled).map((entry) => entry.colour),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const state = await frame();
    expect(state.scrollWidth, `no horizontal overflow at ${width}`).toBeLessThanOrEqual(
      state.innerWidth,
    );
    expect(state.hudAndHint, `the hint does not touch the zoom controls at ${width}`).toBe(false);
    expect(state.hintClipped, `the hint is not cut with an ellipsis at ${width}`).toBe(false);
    expect(state.hintWraps, `the hint wraps at ${width}`).toBe("normal");
    expect(state.hud!.x, `the HUD stays inside the canvas at ${width}`).toBeGreaterThanOrEqual(0);
    expect(state.rail!.x, `the rail is 12 px off the edge at ${width}`).toBe(12);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await frame();
  // One panel of tools, one of history; a hairline is not a panel.
  expect(state.panels).toBe(2);
  expect(state.railShadow).not.toBe("none");
  expect(state.railRadius).not.toBe("0px");
  // Р1: one colour for every tool that works; the muted token only for real stops.
  // Access arrives after the first paint, so a tool can be dimmed for a frame and
  // transition into its colour; the rail settles on one colour for all of them.
  await expect
    .poll(async () => new Set((await frame()).tools).size, { timeout: 10_000 })
    .toBe(1);
  expect(new Set(state.selected).size, "the pressed tool paints the accent").toBe(1);
  expect(state.selected[0]).not.toBe(state.tools[0]);
  expect(state.stops.length, "history is the only stop on a fresh board").toBeGreaterThan(0);
  const muted = await page.evaluate(
    () => getComputedStyle(document.querySelector(".tool-rail .rm-btn:disabled")!).color,
  );
  expect(state.stops.every((colour) => colour === muted)).toBe(true);
  // A tool that can explain itself is not dimmed: the connector has no selection here.
  await expect(
    page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Connector" }),
  ).toBeEnabled();

  await capture(page, page.locator(".tool-rail"), "rail");
  if (update) {
    await page.screenshot({
      path: "spec/baselines/canvas-bottom.png",
      clip: { x: 0, y: 900 - 120, width: 1440, height: 120 },
    });
  }

  // The voting line uses the same slot and the hint steps aside (§10.4, Н1). The note
  // the test just made is in scope, next to its nearest neighbour, so the artefact shows
  // two counters that a person can point at.
  const ids = await page.evaluate(
    (sticky) => {
      const probe = window as unknown as {
        __remo: { widgets: Array<{ id: string; x: number; y: number }> };
      };
      const widgets = probe.__remo.widgets;
      const note = widgets.find((widget) => widget.id === sticky)!;
      const other = widgets
        .filter((widget) => widget.id !== sticky)
        .sort(
          (a, b) =>
            Math.hypot(a.x - note.x, a.y - note.y) - Math.hypot(b.x - note.x, b.y - note.y),
        )[0]!;
      return [sticky, other.id];
    },
    stickyId,
  );
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ids, votesPerSubject: 3, minutes: 10, anonymous: false },
  });
  expect(created.status()).toBe(201);
  await expect(page.locator(".vote-board-bar")).toBeVisible();

  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const withVote = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, right: rect.right };
      };
      const hud = box(".canvas-hud");
      const bar = box(".vote-board-bar");
      return {
        hint: Boolean(document.querySelector(".canvas-hint")),
        overlap: Boolean(hud && bar && hud.x < bar.right && bar.x < hud.right),
        inside: Boolean(bar && bar.right <= window.innerWidth && bar.x >= 0),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(withVote.hint, `no hint while voting at ${width}`).toBe(false);
    expect(withVote.overlap, `the voting line clears the zoom controls at ${width}`).toBe(false);
    expect(withVote.inside, `the voting line fits at ${width}`).toBe(true);
    expect(withVote.scrollWidth).toBeLessThanOrEqual(withVote.innerWidth);
  }

  // The counter on the object (§10.3): the same corner on every object, and two of the
  // shapes a running session shows — «0 +» on a neighbour and my own vote in words.
  // Zoom in first: the artefact is reviewed by a person, and at the fitted 37 % the
  // note is smaller than its counter.
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await page.locator(".vote-chip").first().getByRole("button", { name: /Vote for/ }).click();
  await expect(page.locator(".vote-chip").first()).toHaveClass(/mine/);
  await capture(page, page.locator(".canvas-wrap"), "vote-chips");

  // Both themes: the rail is a panel, not a strip of icons on the canvas edge.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAccount(page);
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  // The same counters in the dark theme: the plate, the accent of my vote and the
  // muted "+" must all be readable there too (§6, both themes).
  await capture(page, page.locator(".canvas-wrap"), "vote-chips-dark");
  await capture(page, page.locator(".tool-rail"), "rail-dark");
});

/**
 * The header and its four menus (ADR-119).
 *
 * The PNGs are the artefact a person reviews; the assertions are the frame: 52 px, one
 * row, no horizontal scroll at the three widths the brief names, and every menu inside
 * the viewport rather than clipped by its right edge.
 */
test("the header stays on one row and its menus fit the viewport", async ({ page }) => {
  await freshBoard(page, "visual-header");

  for (const width of [1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const frame = await page.evaluate(() => {
      const header = document.querySelector(".topbar")!;
      const box = header.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(frame.height, `header height at ${width}`).toBe(52);
    expect(frame.scrollWidth, `horizontal overflow at ${width}`).toBeLessThanOrEqual(
      frame.innerWidth,
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });

  // §10 acceptance: no emoji or text glyph stands in for an icon, one primary button.
  const header = await page.locator(".topbar").innerText();
  expect(header).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
  await expect(page.locator(".topbar .rm-btn-primary")).toHaveCount(1);

  const menus: [string, () => Promise<void>, string][] = [
    ["board menu", () => openBoardMenu(page), "topbar-board-menu"],
    ["facilitation", () => openFacilitation(page), "topbar-facilitation"],
    ["more", () => openMore(page), "topbar-more"],
    ["account", () => openAccount(page), "topbar-account"],
  ];
  for (const [name, open, file] of menus) {
    await open();
    const surface = page.locator(".rm-menu, .rm-popover").last();
    await expect(surface, name).toBeVisible();
    const box = await surface.boundingBox();
    expect(box, `${name} has a box`).not.toBeNull();
    expect(box!.x, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} ends inside the viewport`).toBeLessThanOrEqual(1440);
    await capture(page, page.locator(".topbar").locator("xpath=.."), file);
    await page.keyboard.press("Escape");
    await expect(surface, `${name} closes on Escape`).toHaveCount(0);
  }

  // Both themes, with a menu open: the header is one surface, the menu another.
  await openAccount(page);
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await capture(page, page.locator(".app"), "topbar-dark");
});

/**
 * The plan preview (ADR-142, M3), on data the fake provider makes identical on every run.
 *
 * The fixture is two notes and one line, so the artefact shows the whole reading: the
 * counts, the bounds, and a miniature where a line joins the two boxes.
 */
test("the agent plan preview is readable and fits the viewport", async ({ page }) => {
  await agentBoard(page, "visual-plan");
  await openMore(page);
  await page.getByRole("menuitem", { name: "Ask AI…" }).click();
  const agents = page.getByRole("dialog", { name: "AI agents on this room" });
  await expect(agents).toBeVisible();
  await agents.getByRole("combobox", { name: "Agent", exact: true }).selectOption({
    label: "Planner",
  });
  await agents.getByRole("combobox", { name: "Skill", exact: true }).selectOption("brief-to-board");

  await page
    .getByLabel("What should it draw?")
    .fill("Соедини две заметки FAKE_PLAN_CONNECTED");
  await page.getByRole("button", { name: "Ask the agent" }).click();

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  // Stable data: two objects, one connector, three actions, and a line on the map.
  await expect(plan).toContainText("Objects: 2 · connectors: 1 · actions: 3");
  await expect(plan).toContainText("2 sticky notes");
  await expect(plan.locator(".agent-plan-map-svg rect")).toHaveCount(2);
  await expect(plan.locator(".agent-plan-map-svg line")).toHaveCount(1);

  const box = await plan.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await capture(page, plan, "agent-plan");
});

/**
 * The tidy preview (ADR-143): the same selection before and after, the strategy and the
 * warnings, on a deterministic prefix layout. The model is the fake provider, so the
 * note text and the block title are identical on every run.
 */
test("the tidy preview shows before and after and fits the viewport", async ({ page }) => {
  const board = await agentBoard(page, "visual-tidy");
  const rows = [
    { x: -520, y: 260, text: "US-3: pay" },
    { x: 80, y: -180, text: "US-1: browse" },
    { x: 620, y: 420, text: "US-10: refund" },
    { x: 260, y: 60, text: "US-2: cart" },
    { x: -320, y: -420, text: "US-5: ship" },
  ];
  for (const row of rows) {
    const response = await page.request.post(`/api/boards/${board.boardId}/commands`, {
      headers: { "Idempotency-Key": `visual-tidy-${row.text}-${Date.now()}` },
      data: {
        command: "board.item.create",
        input: { type: "sticky_note", x: row.x, y: row.y, width: 160, height: 180, content: row.text },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(5);
  // The board fits itself to the seeded content after the sync lands; ask for the whole
  // board explicitly, so every note is on screen and the camera is where we read it.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(400);

  const geometry = await page.evaluate(() => {
    const probe = window.__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return { camera: probe.camera, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  });
  const toClient = (world: { x: number; y: number }) => ({
    x: geometry.rect.left + geometry.rect.width / 2 + (world.x - geometry.camera.x) * geometry.camera.zoom,
    y: geometry.rect.top + geometry.rect.height / 2 + (world.y - geometry.camera.y) * geometry.camera.zoom,
  });
  const widgets = await page.evaluate(() => window.__remo.widgets);
  // Bottom-up: the arrange bar opens above the selection, so clicking downwards would
  // let the bar cover the next note.
  const ordered = [...widgets].sort((a, b) => b.y - a.y);
  const first = toClient({ x: ordered[0].x, y: ordered[0].y });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  for (const widget of ordered.slice(1)) {
    const point = toClient({ x: widget.x, y: widget.y });
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.up("Shift");
  await expect
    .poll(() => page.evaluate(() => window.__remo.selectedIds.length))
    .toBe(5);

  await page.getByRole("button", { name: "Tidy up", exact: true }).click();
  const tidy = page.getByRole("dialog", { name: "Tidy up selection" });
  await expect(tidy).toBeVisible();
  await tidy.getByRole("button", { name: "Tidy up", exact: true }).click();
  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("Moves: 5");
  await expect(plan).toContainText("Blocks: US");
  await expect(plan.locator(".tidy-map-ghost")).toHaveCount(5);
  await expect(plan.locator(".tidy-map-legend")).toContainText("Before");

  const box = await plan.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await capture(page, plan, "agent-plan-tidy");
});
