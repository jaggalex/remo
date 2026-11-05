#!/usr/bin/env node
/**
 * The guide's own acceptance run (phase F).
 *
 * The manual checklist was: no horizontal scroll at five widths, anchors below the sticky
 * header, the skip link as the first tab stop, the drawer and the search dialog managing
 * focus, the theme surviving a reload, copy putting the right bytes on the clipboard, and
 * the map filtering. Every one of those is now a browser check, so a layout regression
 * fails `pnpm verify --e2e` instead of being noticed by a reader.
 *
 *   pnpm guide:build && pnpm guide:audit
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startGuideServer } from "./guide-serve.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "docs-site");
const WIDTHS = [360, 390, 768, 1024, 1440];
const SAMPLES = [
  "/guide/ru/overview/index.html",
  "/guide/ru/overview/map.html",
  "/guide/ru/reference/api.html",
  "/guide/ru/concepts/extensions.html",
  "/guide/ru/admin/deploy.html",
  "/guide/ru/support/troubleshooting.html",
];

const failures = [];
const checks = [];
const fail = (message) => failures.push(message);
const pass = (name, detail = "") => checks.push({ name, detail });

if (!existsSync(OUT)) {
  console.error("guide audit: docs-site is missing — run pnpm guide:build first");
  process.exit(1);
}

/* --------------------------------------------------------------- markup -- */

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const pages = walk(OUT).filter((path) => !path.endsWith("index.html") || path.includes("/ru/") || path.includes("/en/"));
let markupChecked = 0;
for (const path of pages) {
  const html = readFileSync(path, "utf8");
  const name = relative(OUT, path);
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) fail(`${name}: ${h1} H1 elements`);
  if (!/<main[^>]*id="main"/.test(html)) fail(`${name}: main landmark without id`);
  if (!/<a class="skip" href="#main"/.test(html)) fail(`${name}: no skip link`);
  if (/href="#"/.test(html)) fail(`${name}: a dead "#" link`);
  if (!/lang="(ru|en)"/.test(html)) fail(`${name}: no lang on <html>`);
  markupChecked += 1;
}
pass("markup", `${markupChecked} pages: one H1, main landmark, skip link, no dead links`);

/* -------------------------------------------------------------- browser -- */

const { server, port } = await startGuideServer(0);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const consoleErrors = [];

async function open(path, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${path}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${path}: ${error.message}`));
  await page.goto(`${base}${path}`);
  return page;
}

try {
  const scrollFailures = [];
  for (const width of WIDTHS) {
    for (const path of SAMPLES) {
      const page = await open(path, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (overflow > 0) scrollFailures.push(`${path} @${width}: +${overflow}px`);
      await page.close();
    }
  }
  if (scrollFailures.length) fail(`horizontal scroll: ${scrollFailures.join(", ")}`);
  else pass("layout", `no horizontal scroll at ${WIDTHS.join("/")} on ${SAMPLES.length} pages`);

  const expectedPages = [];
  for (const section of readdirSync(join(ROOT, "guide"))) {
    const sectionDir = join(ROOT, "guide", section);
    if (!statSync(sectionDir).isDirectory()) continue;
    for (const slug of readdirSync(sectionDir)) {
      if (existsSync(join(sectionDir, slug, "meta.json"))) expectedPages.push(`${section}/${slug}`);
    }
  }
  const llms = await fetch(`${base}/guide/llms.txt`);
  const llmsText = await llms.text();
  const llmsFull = await fetch(`${base}/guide/llms-full.txt`);
  const llmsFullText = await llmsFull.text();
  const mappedPages = [...llmsText.matchAll(/\]\(https:\/\/docs\.remo\.letii\.ru\/guide\/en\/[^)]+\)/g)].length;
  const sourcedPages = [...llmsFullText.matchAll(/^Source: https:\/\/docs\.remo\.letii\.ru\/guide\/en\//gm)].length;
  const stalePhrases = [
    "board-main is used",
    "current version is 9",
    "Frame order",
    "frame order",
    "shows frames in order",
    "Present the board by frames",
  ];
  const stale = stalePhrases.filter((phrase) => llmsText.includes(phrase) || llmsFullText.includes(phrase));
  const relativeAssets = /\]\(\/guide\//.test(llmsFullText);
  if (
    llms.status !== 200 ||
    !llmsText.includes("# remo") ||
    !llmsText.includes("/guide/en/overview/index.html") ||
    !llmsText.includes("llms-full.txt") ||
    !/Content updated: \d{4}-\d{2}-\d{2}/.test(llmsText) ||
    !/Schema version: \d+/.test(llmsText) ||
    llmsFull.status !== 200 ||
    !llmsFullText.includes("# remo documentation") ||
    !llmsFullText.includes("Source: https://docs.remo.letii.ru/guide/en/") ||
    mappedPages !== expectedPages.length ||
    sourcedPages !== expectedPages.length ||
    stale.length > 0 ||
    relativeAssets
  ) {
    fail(
      `AI files: llms ${llms.status}, full ${llmsFull.status}; pages ${mappedPages}/${sourcedPages} of ${expectedPages.length}; stale ${stale.join(", ") || "none"}; relative assets ${relativeAssets}`,
    );
  } else {
    pass("AI files", `llms.txt maps all ${expectedPages.length} pages, llms-full.txt contains every page`);
  }

  const aiPage = await open("/guide/ru/overview/ai.html");
  const aiState = await aiPage.evaluate(() => ({
    topLink: document.querySelector(".ai-link")?.textContent?.trim(),
    toc: document.querySelector(".toc-ai")?.textContent?.trim(),
    code: [...document.querySelectorAll("article pre code")].map((node) => node.textContent),
    copy: document.querySelectorAll("article .code-copy").length,
  }));
  if (
    aiState.topLink !== "AI" ||
    aiState.toc !== "Для AI-агента" ||
    !aiState.code.some((value) => value?.includes("/guide/llms.txt")) ||
    !aiState.code.some((value) => value?.includes("/guide/llms-full.txt")) ||
    aiState.copy !== 2
  ) {
    fail(`AI page: ${JSON.stringify(aiState)}`);
  } else {
    pass("AI page", "top link, TOC entry, two copyable links");
  }

  const overview = await open("/guide/ru/overview/index.html");
  const overviewState = await overview.evaluate(() => ({
    tip: document.querySelector(".note-tip")?.textContent ?? "",
    toc: document.querySelector(".toc-ai")?.textContent?.trim(),
    links: [...document.querySelectorAll(".note-tip code")].map((node) => node.textContent),
  }));
  if (
    !overviewState.tip.includes("AI-агенту") ||
    overviewState.toc !== "Для AI-агента" ||
    !overviewState.links.some((value) => value?.includes("/guide/llms.txt"))
  ) {
    fail(`overview AI entry: ${JSON.stringify(overviewState)}`);
  } else {
    pass("overview AI entry", "callout before the sections and a TOC link");
  }

  const anchorPage = await open("/guide/ru/concepts/glossary.html");
  await anchorPage.goto(`${base}/guide/ru/concepts/glossary.html#obekty-i-komnata`);
  const anchor = await anchorPage.evaluate(() => {
    const heading = document.getElementById("obekty-i-komnata");
    const header = document.querySelector(".top");
    return {
      top: heading.getBoundingClientRect().top,
      header: header.getBoundingClientRect().height,
    };
  });
  if (anchor.top < anchor.header) fail(`anchor lands under the header (${anchor.top} < ${anchor.header})`);
  else pass("anchors", `heading at ${Math.round(anchor.top)}px, header ${Math.round(anchor.header)}px`);

  const keyboard = await open("/guide/ru/overview/map.html");
  await keyboard.keyboard.press("Tab");
  const first = await keyboard.evaluate(() => ({
    skip: document.activeElement?.classList.contains("skip"),
    text: document.activeElement?.textContent?.trim(),
  }));
  await keyboard.keyboard.press("Enter");
  const mainFocused = await keyboard.evaluate(() => document.activeElement?.id === "main");
  if (!first.skip || !mainFocused) fail(`skip link: first stop ${JSON.stringify(first)}, main focused ${mainFocused}`);
  else pass("skip link", "first tab stop, Enter focuses main");

  const drawer = await open("/guide/ru/overview/map.html", 390);
  await drawer.click("#menu-toggle");
  const opened = await drawer.evaluate(() => ({
    open: document.getElementById("guide-nav").classList.contains("open"),
    locked: document.body.classList.contains("nav-open"),
    focusInside: document.getElementById("guide-nav").contains(document.activeElement),
  }));
  await drawer.keyboard.press("Escape");
  const closed = await drawer.evaluate(() => ({
    open: document.getElementById("guide-nav").classList.contains("open"),
    locked: document.body.classList.contains("nav-open"),
    focus: document.activeElement?.id,
  }));
  if (!opened.open || !opened.locked || !opened.focusInside || closed.open || closed.locked || closed.focus !== "menu-toggle") {
    fail(`drawer: opened ${JSON.stringify(opened)}, closed ${JSON.stringify(closed)}`);
  } else {
    pass("drawer", "opens with focus inside, Escape closes and returns focus");
  }

  const search = await open("/guide/ru/overview/map.html");
  await search.keyboard.press("Control+k");
  await search.fill("#search-input", "токен");
  await search.waitForTimeout(200);
  const searchState = await search.evaluate(() => ({
    hidden: document.getElementById("search-dialog").hidden,
    focus: document.activeElement?.id,
    results: document.querySelectorAll("#search-results li").length,
    active: document.querySelectorAll(".search-results li.active").length,
    status: document.getElementById("search-status").textContent,
  }));
  // Focus must stay inside the dialog while it is open.
  const trap = [];
  for (let i = 0; i < 5; i += 1) {
    await search.keyboard.press("Tab");
    trap.push(
      await search.evaluate(() => document.querySelector(".search-panel").contains(document.activeElement)),
    );
  }
  await search.keyboard.press("Escape");
  const searchClosed = await search.evaluate(() => ({
    hidden: document.getElementById("search-dialog").hidden,
    focus: document.activeElement?.id,
  }));
  if (
    searchState.hidden ||
    searchState.results === 0 ||
    !searchClosed.hidden ||
    searchClosed.focus !== "search-open" ||
    trap.some((inside) => !inside)
  ) {
    fail(`search: ${JSON.stringify(searchState)} → ${JSON.stringify(searchClosed)}`);
  } else {
    pass("search", `Ctrl+K, ${searchState.results} results, Tab stays inside, Esc returns focus`);
  }

  const theme = await open("/guide/ru/overview/map.html");
  // The cycle is system → light → dark; from a light system the first click is not a
  // visible change, so the check walks to dark and reloads.
  await theme.click("#theme-toggle");
  await theme.click("#theme-toggle");
  const after = await theme.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: window.localStorage.getItem("guide.theme"),
  }));
  await theme.reload();
  const persisted = await theme.evaluate(() => document.documentElement.dataset.theme);
  if (after.theme !== "dark" || after.stored !== "dark" || persisted !== "dark") {
    fail(`theme: ${JSON.stringify(after)}, after reload ${persisted}`);
  } else {
    pass("theme", "light → dark, choice kept after reload");
  }

  const copy = await open("/guide/ru/reference/api.html");
  await copy.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const code = await copy.evaluate(() => document.querySelector(".tab-panel:not([hidden]) pre")?.textContent ?? "");
  await copy.click(".tab-panel:not([hidden]) .code-copy");
  await copy.waitForTimeout(200);
  const clipboard = await copy.evaluate(() => navigator.clipboard.readText());
  const toast = await copy.evaluate(() => document.querySelector(".copy-toast")?.textContent);
  if (!code || clipboard !== code) fail("copy: clipboard does not match the code block");
  else pass("copy", `clipboard matches the block, toast "${toast}"`);

  const map = await open("/guide/ru/overview/map.html");
  await map.fill(".map-tools input", "вебхук");
  const filtered = await map.evaluate(() => ({
    rows: [...document.querySelectorAll("article tbody tr")].filter((row) => !row.hidden).length,
    count: document.querySelector(".map-count")?.textContent,
  }));
  await map.click(".map-views button[data-view='cards']");
  const cards = await map.evaluate(
    () => [...document.querySelectorAll(".map-card")].filter((card) => !card.hidden).length,
  );
  if (filtered.rows !== 1 || cards !== 1) fail(`map: filter ${JSON.stringify(filtered)}, cards ${cards}`);
  else pass("map", `filter → 1 row, cards view → 1 card`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (consoleErrors.length) fail(`console: ${consoleErrors.slice(0, 5).join(" | ")}`);
else pass("console", "no errors attributed to the implementation");

if (failures.length) {
  console.error("\nguide audit: FAILED");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log("\nguide audit");
for (const check of checks) console.log(`  ✓ ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
console.log(`guide audit: ok (${checks.length} checks)`);
