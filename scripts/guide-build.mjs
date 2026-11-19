#!/usr/bin/env node
/**
 * Builds the product guide portal from `guide/` (ADR-099).
 *
 * Same contract as the in-app help: RU is the source, EN a required translation tracked
 * by a content hash, Markdown rendered with raw HTML disabled, and `--check` fails
 * instead of writing when anything is stale. The output is a static site: no runtime, no
 * container, served by the same nginx as the product.
 *
 *   node scripts/guide-build.mjs            build docs-site/
 *   node scripts/guide-build.mjs --check    validate sources and output, write nothing
 *   node scripts/guide-build.mjs --accept-translations   record the current RU hash
 *
 * The connectivity check is the point of the guide: every page must be reachable from
 * `overview/index` by following links, so the documentation is a system and not a pile.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  directories,
  exists,
  headingProblems,
  headings,
  helpTopicIds,
  linkTargets,
  markdown,
  plain,
  readJson,
  translationHash,
  withContainers,
  withHeadingIds,
} from "./docs-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { SCHEMA_VERSION } = await import(
  new URL("../apps/sync/schema-version.mjs", import.meta.url)
);
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const SOURCE_URL = "https://github.com/jaggalex/remo";
const ABOUT = {
  version: PACKAGE.version ?? "0.0.0",
  author: PACKAGE.author ?? "Alexander Kostylev",
  license: PACKAGE.license ?? "AGPL-3.0-only",
  year: 2026,
};
const GUIDE = join(ROOT, "guide");
const OUT = join(ROOT, "docs-site");
const LOCALES = ["ru", "en"];
const TYPES = new Set(["overview", "tutorial", "how-to", "explanation", "reference"]);
const STATUSES = new Set(["available", "experimental", "planned"]);
const ENTRY = "overview/index";
// Public origin of the documentation site; the AI files use absolute links so an agent
// can follow them from outside the portal (ADR-157).
const PUBLIC_GUIDE = "https://docs.remo.letii.ru/guide";
const LOCALE_NAMES = { ru: "RU", en: "EN" };
const CHROME = {
  ru: {
    brandSuffix: "документация",
    menu: "Открыть меню документации",
    skip: "Перейти к содержимому",
    crumbsLabel: "Хлебные крошки",
    search: "Поиск",
    searchLabel: "Поиск по документации",
    searchTitle: "Поиск по документации",
    searchPlaceholder: "Страница, понятие или ошибка…",
    searchResults: "Результаты поиска",
    searchEmpty: "Ничего не найдено. Попробуйте другое слово.",
    searchError: "Поиск недоступен: не удалось загрузить индекс.",
    searchLoading: "Ищу…",
    searchFound: "Найдено: {count}",
    searchHint: "↑ ↓ выбрать · Enter открыть · Esc закрыть",
    themeSystem: "Тема: как в системе. Переключить на светлую",
    themeLight: "Тема: светлая. Переключить на тёмную",
    themeDark: "Тема: тёмная. Переключить на системную",
    about: "О remo",
    sourceCode: "Исходный код",
    disclaimer: "Отказ от ответственности",
    ai: "AI",
    aiLabel: "Документация для AI-агента",
    aiToc: "Для AI-агента",
    sections: "Разделы документации",
    crumbs: "Документация",
    toc: "На этой странице",
    related: "Связанные страницы",
    next: "Дальше",
    previous: "Назад",
    status: "Статус",
    updated: "обновлено",
    statuses: { available: "доступно", experimental: "экспериментальное", planned: "в планах" },
  },
  en: {
    brandSuffix: "documentation",
    menu: "Open the documentation menu",
    skip: "Skip to content",
    crumbsLabel: "Breadcrumbs",
    search: "Search",
    searchLabel: "Search the documentation",
    searchTitle: "Search the documentation",
    searchPlaceholder: "A page, a concept or an error…",
    searchResults: "Search results",
    searchEmpty: "Nothing found. Try another word.",
    searchError: "Search is unavailable: the index could not be loaded.",
    searchLoading: "Searching…",
    searchFound: "Found: {count}",
    searchHint: "↑ ↓ to choose · Enter to open · Esc to close",
    themeSystem: "Theme: system. Switch to light",
    themeLight: "Theme: light. Switch to dark",
    themeDark: "Theme: dark. Switch to system",
    about: "About remo",
    sourceCode: "Source code",
    disclaimer: "Disclaimer",
    ai: "AI",
    aiLabel: "Documentation for an AI agent",
    aiToc: "For AI agents",
    sections: "Documentation sections",
    crumbs: "Documentation",
    toc: "On this page",
    related: "Related pages",
    next: "Next",
    previous: "Previous",
    status: "Status",
    updated: "updated",
    statuses: { available: "available", experimental: "experimental", planned: "planned" },
  },
};

const check = process.argv.includes("--check");
const accept = process.argv.includes("--accept-translations");

const NOTE_LABELS = {
  ru: { note: "Примечание", tip: "Совет", warning: "Внимание", danger: "Осторожно" },
  en: { note: "Note", tip: "Tip", warning: "Warning", danger: "Danger" },
};
const md = withContainers(withHeadingIds(markdown()), NOTE_LABELS);

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  const alt = escapeHtml(self.renderInlineAsText(token.children ?? [], options, env));
  const title = token.attrGet("title");
  return `<figure><a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img src="${escapeHtml(
    src,
  )}" alt="${alt}" loading="lazy"></a>${
    title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ""
  }</figure>`;
};

// The product mark: the same file as the favicon, inlined so it follows the theme.
const LOGO = readFileSync(join(ROOT, "remo-logo.svg"), "utf8");
const LOGO_INLINE = LOGO.replace('role="img" aria-label="REMO"', 'aria-hidden="true"').replace(
  /#1E2A44/g,
  "currentColor",
);
const problems = [];
const fail = (message) => problems.push(message);

/* ------------------------------------------------------------------ load -- */

const sections = readJson(join(GUIDE, "sections.json"));
const sectionById = new Map(sections.map((section) => [section.id, section]));
const helpIds = helpTopicIds(ROOT);
const pages = new Map();

for (const section of sections) {
  const dir = join(GUIDE, section.id);
  for (const slug of directories(dir)) {
    const base = join(dir, slug);
    if (!exists(join(base, "meta.json"))) continue;
    const meta = readJson(join(base, "meta.json"));
    const id = `${section.id}/${slug}`;
    if (meta.id !== id) fail(`${id}: meta.id is "${meta.id}"`);
    if (pages.has(id)) fail(`${id}: duplicate page id`);
    if (!TYPES.has(meta.type)) fail(`${id}: unknown type "${meta.type}"`);
    if (!STATUSES.has(meta.status)) fail(`${id}: unknown status "${meta.status}"`);
    for (const locale of LOCALES) {
      if (!meta.title?.[locale]) fail(`${id}: title missing ${locale}`);
      if (!meta.summary?.[locale]) fail(`${id}: summary missing ${locale}`);
    }
    const bodies = {};
    for (const locale of LOCALES) {
      const path = join(base, `${locale}.md`);
      if (!exists(path)) {
        fail(`${id}: missing ${locale}.md`);
        continue;
      }
      bodies[locale] = readFileSync(path, "utf8");
      if (!bodies[locale].trim()) fail(`${id}: ${locale}.md is empty`);
    }
    const sourceHash = bodies.ru ? translationHash(meta, "ru", bodies.ru) : "";
    const targetHash = bodies.en ? translationHash(meta, "en", bodies.en) : "";
    const previousSource = meta.translations?.en?.sourceHash;
    const previousTarget = meta.translations?.en?.targetHash;
    const current = previousSource === sourceHash && previousTarget === targetHash;
    if (accept && sourceHash) {
      if (previousSource && previousSource !== sourceHash && previousTarget && previousTarget === targetHash) {
        fail(`${id}: EN translation did not change while RU did; translate it before accepting`);
      } else {
        meta.translations = {
          ...(meta.translations ?? {}),
          en: { ...(meta.translations?.en ?? {}), sourceHash, targetHash },
        };
        writeFileSync(join(base, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
        delete meta.__rewritten;
      }
    }
    const translation = !bodies.en ? "missing" : current || accept ? "current" : "outdated";
    if (translation !== "current") fail(`${id}: EN translation is ${translation}`);
    for (const locale of LOCALES) {
      if (!bodies[locale]) continue;
      for (const problem of headingProblems(md, bodies[locale], `${id}/${locale}`)) {
        fail(problem);
      }
      for (const target of linkTargets(bodies[locale])) {
        // The internal spec and the ADRs are not user documentation: the guide must not
        // depend on them, or it starts explaining implementation instead of behaviour.
        if (/(^|\/)spec\/|(^|\/)ADR\.md/.test(target)) {
          fail(`${id}/${locale}: links to internal documentation (${target})`);
          continue;
        }
        const guideLink = target.match(/^\/guide\/([a-z0-9-]+)\/([a-z0-9-]+)(#.*)?$/);
        if (guideLink) {
          const [section, slug] = [guideLink[1], guideLink[2]];
          if (!pages.has(`${section}/${slug}`) && !exists(join(GUIDE, section, slug))) {
            fail(`${id}/${locale}: link to missing page "${target}"`);
          }
          if (!sectionById.has(section)) fail(`${id}/${locale}: unknown section "${section}"`);
        }
        const helpLink = target.match(/^\/help\/([a-z0-9.-]+)(#.*)?$/);
        if (helpLink && !helpIds.has(helpLink[1])) {
          fail(`${id}/${locale}: link to missing help topic "${helpLink[1]}"`);
        }
      }
      for (const image of bodies[locale].matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        const target = image[1];
        if (target.startsWith("/guide/assets/")) {
          const file = target.slice("/guide/assets/".length);
          if (!exists(join(GUIDE, "assets", file))) {
            fail(`${id}/${locale}: image not found in guide/assets (${file})`);
          }
        }
      }
      for (const block of bodies[locale].matchAll(/```json\n([\s\S]*?)```/g)) {
        try {
          JSON.parse(block[1]);
        } catch {
          fail(`${id}/${locale}: a json example does not parse`);
        }
      }
    }
    pages.set(id, { id, section: section.id, slug, meta, bodies, translation });
  }
}

/* -------------------------------------------------------------- coverage -- */

const coverage = readJson(join(GUIDE, "coverage.json"));
for (const row of coverage.capabilities) {
  if (!row.id) fail("coverage: a row has no id");
  const kinds = ["capability", "concept", "reference"].filter((kind) => row[kind]);
  if (kinds.length < 2) fail(`coverage/${row.id}: needs at least two document kinds`);
  for (const key of ["capability", "concept", "limits", "example"]) {
    if (row[key] && !pages.has(row[key])) fail(`coverage/${row.id}: ${key} → missing page ${row[key]}`);
  }
  for (const page of row.howto ?? []) {
    if (!pages.has(page)) fail(`coverage/${row.id}: howto → missing page ${page}`);
  }
  for (const page of row.reference ?? []) {
    if (!pages.has(page)) fail(`coverage/${row.id}: reference → missing page ${page}`);
  }
}

/* ----------------------------------------------------------------- trace -- */

const trace = readJson(join(GUIDE, "trace.json"));
for (const [page, links] of Object.entries(trace)) {
  if (!pages.has(page)) fail(`trace: unknown page ${page}`);
  for (const path of links.code ?? []) {
    if (!exists(join(ROOT, path))) fail(`trace/${page}: code path missing (${path})`);
  }
  for (const path of links.tests ?? []) {
    if (!exists(join(ROOT, path))) fail(`trace/${page}: test path missing (${path})`);
  }
  const adrText = readFileSync(join(ROOT, "ADR.md"), "utf8");
  for (const number of links.adr ?? []) {
    if (!adrText.includes(`## ADR-${String(number).padStart(3, "0")}:`)) {
      fail(`trace/${page}: ADR-${number} is missing`);
    }
  }
}

/* ------------------------------------------------------------- help links -- */

const helpLinks = readJson(join(GUIDE, "help-links.json"));
for (const topic of helpIds) {
  if (!helpLinks[topic]) fail(`help-links: topic ${topic} has no guide page`);
  else if (!pages.has(helpLinks[topic])) fail(`help-links: ${topic} → missing ${helpLinks[topic]}`);
}
for (const [topic, page] of Object.entries(helpLinks)) {
  if (!helpIds.has(topic)) fail(`help-links: unknown topic ${topic}`);
  if (!pages.has(page)) fail(`help-links: ${topic} → missing ${page}`);
}

/* ------------------------------------------------------------ connectivity -- */

if (pages.has(ENTRY)) {
  const seen = new Set([ENTRY]);
  const queue = [ENTRY];
  while (queue.length) {
    const current = pages.get(queue.shift());
    const targets = new Set(current.meta.related ?? []);
    for (const locale of LOCALES) {
      for (const target of linkTargets(current.bodies[locale] ?? "")) {
        const match = target.match(/^\/guide\/([a-z0-9-]+)\/([a-z0-9-]+)/);
        if (match) targets.add(`${match[1]}/${match[2]}`);
      }
    }
    for (const target of targets) {
      if (!pages.has(target) || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  for (const id of pages.keys()) {
    if (!seen.has(id)) fail(`${id}: unreachable from ${ENTRY} — the guide must be one graph`);
  }
} else if (!check) {
  fail(`missing entry page ${ENTRY}`);
}

/* ------------------------------------------------------------------ links -- */

for (const page of pages.values()) {
  for (const related of page.meta.related ?? []) {
    if (!pages.has(related)) fail(`${page.id}: related page "${related}" does not exist`);
  }
}

/* ----------------------------------------------------------------- render -- */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ordered = [...pages.values()].sort(
  (a, b) =>
    (sectionById.get(a.section)?.order ?? 0) - (sectionById.get(b.section)?.order ?? 0) ||
    (a.meta.order ?? 0) - (b.meta.order ?? 0) ||
    a.id.localeCompare(b.id),
);

/** The reading order, so each page can point at exactly one "next". */
const sequence = ordered.map((page) => page.id);
const contentUpdated = ordered
  .map((page) => page.meta.updated ?? "")
  .filter(Boolean)
  .sort()
  .at(-1) ?? "";

function rewriteLinks(body, locale) {
  return body
    .replace(/\]\(\/guide\/([a-z0-9-]+)\/([a-z0-9-]+)(#[^)]*)?\)/g, (_all, section, slug, anchor = "") => {
      return `](/guide/${locale}/${section}/${slug}.html${anchor})`;
    })
    .replace(/\]\(\/help\/([a-z0-9.-]+)(#[^)]*)?\)/g, (_all, topic, anchor = "") => {
      return `](/help/${locale}/${topic}${anchor})`;
    });
}

const search = { ru: [], en: [] };

function renderPage(page, locale) {
  const section = sectionById.get(page.section);
  const body = rewriteLinks(page.bodies[locale] ?? "", locale);
  // A wide table must scroll inside itself: on a phone it must not widen the page
  // (spec: no horizontal page scroll at any width).
  const html = md
    .render(body, { locale })
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
  // `headings()` walks the token stream correctly; reading the inline token by the
  // heading's index in the filtered list produced empty and mismatched entries.
  const toc = headings(md, body).filter((heading) => heading.level <= 3);

  search[locale].push({
    id: page.id,
    title: page.meta.title[locale],
    summary: page.meta.summary[locale],
    section: section.title[locale],
    text: plain(html),
    url: `/guide/${locale}/${page.section}/${page.slug}.html`,
  });

  const index = sequence.indexOf(page.id);
  const nextId = sequence[index + 1] ?? null;
  const previousId = sequence[index - 1] ?? null;

  const sectionFirst = (sectionId) =>
    ordered.find((candidate) => candidate.section === sectionId) ?? null;
  const nav = sections
    .map((entry) => {
      const items = ordered.filter((candidate) => candidate.section === entry.id);
      if (!items.length) return "";
      const here = items.some((item) => item.id === page.id);
      return `<details class="nav-group" data-section="${entry.id}"${here ? " open" : " open"}>
  <summary>${escapeHtml(entry.title[locale])}</summary>
  <ul>${items
    .map(
      (item) =>
        `<li><a href="/guide/${locale}/${item.section}/${item.slug}.html"${
          item.id === page.id ? ' aria-current="page"' : ""
        }>${escapeHtml(item.meta.title[locale])}</a></li>`,
    )
    .join("")}</ul>
</details>`;
    })
    .join("\n");

  const tocHtml = toc
    .map(
      (heading) =>
        `<li class="toc-h${heading.level}"><a href="#${heading.id}" data-target="${heading.id}">${escapeHtml(
          heading.text,
        )}</a></li>`,
    )
    .join("");

  const related = (page.meta.related ?? [])
    .map((id) => {
      const target = pages.get(id);
      if (!target) return "";
      return `<li><a href="/guide/${locale}/${target.section}/${target.slug}.html"><span class="related-title">${escapeHtml(
        target.meta.title[locale],
      )}</span><span class="related-summary">${escapeHtml(
        target.meta.summary[locale],
      )}</span></a></li>`;
    })
    .join("");

  const next = nextId ? pages.get(nextId) : null;
  const previous = previousId ? pages.get(previousId) : null;
  const other = locale === "ru" ? "en" : "ru";
  const ui = CHROME[locale];

  const aiToc = `<li class="toc-ai"><a href="/guide/${locale}/overview/ai.html">${escapeHtml(
    ui.aiToc,
  )}</a></li>`;
  const tocAside = tocHtml
    ? `<aside class="toc-col" aria-label="${escapeHtml(ui.toc)}">
  <nav class="toc-inner">
    <p class="toc-title">${escapeHtml(ui.toc)}</p>
    <ul>${aiToc}${tocHtml}</ul>
  </nav>
</aside>`
    : "";

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>try{var t=localStorage.getItem("guide.theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}</script>
<title>${escapeHtml(page.meta.title[locale])} — remo</title>
<meta name="description" content="${escapeHtml(page.meta.summary[locale])}">
<meta name="theme-color" content="#fcfbfa">
<link rel="icon" href="/guide/assets/remo-logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/guide/assets/tokens.css">
<link rel="stylesheet" href="/guide/assets/guide.css">
</head>
<body>
<a class="skip" href="#main">${escapeHtml(ui.skip)}</a>
<header class="top">
  <button type="button" class="menu-toggle" id="menu-toggle"
          aria-expanded="false" aria-controls="guide-nav" aria-label="${escapeHtml(ui.menu)}">
    <span aria-hidden="true">☰</span>
  </button>
  <a class="brand" href="/guide/${locale}/${ENTRY}.html">
    <span class="brand-logo">${LOGO_INLINE}</span>
    <span class="brand-word">remo</span><span class="brand-sub"> · ${escapeHtml(
      ui.brandSuffix,
    )}</span>
  </a>
  <div class="top-actions">
    <a class="ai-link" href="/guide/${locale}/overview/ai.html"
       title="${escapeHtml(ui.aiLabel)}" aria-label="${escapeHtml(ui.aiLabel)}">${escapeHtml(
         ui.ai,
       )}</a>
    <button type="button" class="search-open" id="search-open"
            aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
      <span aria-hidden="true">⌕</span>
      <span class="search-open-label">${escapeHtml(ui.search)}</span>
      <kbd class="search-open-key" id="search-key">Ctrl K</kbd>
    </button>
    <button type="button" class="theme-toggle" id="theme-toggle"
            aria-label="${escapeHtml(ui.themeSystem)}" title="${escapeHtml(ui.themeSystem)}">
      <span aria-hidden="true" id="theme-icon">◐</span>
    </button>
    <a href="/guide/${other}/${page.section}/${page.slug}.html" hreflang="${other}" class="lang-switch">${
      LOCALE_NAMES[other]
    }</a>
  </div>
</header>
<div class="layout">
  <div class="scrim" id="scrim" hidden></div>
  <nav class="side" id="guide-nav" aria-label="${escapeHtml(ui.sections)}">
${nav}
  </nav>
  <main id="main" tabindex="-1">
    <nav class="crumbs" aria-label="${escapeHtml(ui.crumbsLabel)}">
      <a href="/guide/${locale}/${ENTRY}.html">${escapeHtml(ui.crumbs)}</a>
      <span aria-hidden="true">→</span>
      <a href="/guide/${locale}/${section.id}/${sectionFirst(section.id)?.slug ?? ""}.html">${escapeHtml(
        section.title[locale],
      )}</a>
    </nav>
    <h1>${escapeHtml(page.meta.title[locale])}</h1>
    <p class="summary">${escapeHtml(page.meta.summary[locale])}</p>
    <p class="meta">
      <span class="status status-${page.meta.status}">${escapeHtml(ui.status)}: ${escapeHtml(
        ui.statuses[page.meta.status] ?? page.meta.status,
      )}</span>
      <span class="updated">${escapeHtml(ui.updated)} ${escapeHtml(page.meta.updated ?? "")}</span>
    </p>
    <article>${html}</article>
    ${related ? `<aside class="related"><h2>${escapeHtml(ui.related)}</h2><ul class="related-grid">${related}</ul></aside>` : ""}
    ${
      next
        ? `<nav class="next" aria-label="${escapeHtml(ui.next)}"><span>${escapeHtml(ui.next)} →</span><a href="/guide/${locale}/${
            next.section
          }/${next.slug}.html">${escapeHtml(next.meta.title[locale])}</a></nav>`
        : ""
    }
    ${
      previous
        ? `<nav class="previous"><span>← ${escapeHtml(ui.previous)}</span><a href="/guide/${locale}/${
            previous.section
          }/${previous.slug}.html">${escapeHtml(previous.meta.title[locale])}</a></nav>`
        : ""
    }
  </main>
  ${tocAside}
</div>
<footer class="site-footer">
  <span>remo ${escapeHtml(ABOUT.version)}</span>
  <span>© ${ABOUT.year} ${escapeHtml(ABOUT.author)}</span>
  <a href="/guide/${locale}/support/about.html">${escapeHtml(ui.about)} · ${escapeHtml(ABOUT.license)}</a>
  <a href="/guide/${locale}/support/disclaimer.html">${escapeHtml(ui.disclaimer)}</a>
  <a href="${SOURCE_URL}" rel="noopener">${escapeHtml(ui.sourceCode)}</a>
</footer>
<div class="search-dialog" id="search-dialog" role="dialog" aria-modal="true"
     aria-label="${escapeHtml(ui.searchTitle)}" hidden>
  <div class="search-scrim" data-close="search"></div>
  <div class="search-panel">
    <div class="search-field">
      <span aria-hidden="true">⌕</span>
      <input id="search-input" type="search" autocomplete="off" spellcheck="false"
             placeholder="${escapeHtml(ui.searchPlaceholder)}"
             aria-label="${escapeHtml(ui.searchLabel)}"
             role="combobox" aria-expanded="true" aria-controls="search-results"
             aria-autocomplete="list" aria-describedby="search-status">
    </div>
    <p class="search-status" id="search-status" role="status" aria-live="polite"></p>
    <ul class="search-results" id="search-results" role="listbox"
        aria-label="${escapeHtml(ui.searchResults)}"></ul>
    <p class="search-hint">${escapeHtml(ui.searchHint)}</p>
  </div>
</div>
<script src="/guide/assets/nav.js"></script>
<script src="/guide/assets/toc.js"></script>
<script src="/guide/assets/theme.js"></script>
<script src="/guide/assets/tabs.js"></script>
<script src="/guide/assets/copy.js"></script>
<script src="/guide/assets/search.js"></script>
${page.id === "overview/map" ? '<script src="/guide/assets/map.js"></script>' : ""}
</body>
</html>`;
}

/** Absolute page URL, so an agent outside the portal can follow it (ADR-157). */
function aiPageUrl(page) {
  return `${PUBLIC_GUIDE}/en/${page.section}/${page.slug}.html`;
}

/** `llms.txt`: the conventional map of the documentation, in English. */
function llmsIndex() {
  const lines = [
    "# remo",
    "",
    "> remo is a local-first visual canvas for a small team: boards, objects, access, export and integrations in one product.",
    "> This is public product documentation for AI agents. It grants no account, board or API access.",
    "",
    `Full text in one file: ${PUBLIC_GUIDE}/llms-full.txt`,
    `Content updated: ${contentUpdated}. Schema version: ${SCHEMA_VERSION}. Pages: ${ordered.length}.`,
    "",
  ];
  for (const section of sections) {
    const items = ordered.filter((page) => page.section === section.id);
    if (!items.length) continue;
    lines.push(`## ${section.title.en}`, "");
    for (const page of items) {
      lines.push(`- [${page.meta.title.en}](${aiPageUrl(page)}) — ${page.meta.summary.en}`);
    }
    lines.push("");
  }
  lines.push(
    "## Notes",
    "",
    "- This file is a map; open the links for the full page.",
    `- \`${PUBLIC_GUIDE}/llms-full.txt\` contains every page in one text file.`,
    "- The portal also has Russian pages; the AI files use English for broader model support.",
    "- The in-app help is a separate short reference at https://remo.letii.ru/help/en and is not included in this file.",
    "- Documentation is not an API token: it cannot read or change a board.",
    "",
  );
  return lines.join("\n");
}

/** Links inside the guide are site-absolute; an AI file needs external-absolute URLs. */
function absoluteGuideLinks(body) {
  return body
    .replace(
      /\]\(\/guide\/([a-z0-9-]+)\/([a-z0-9-]+)(#[^)]*)?\)/g,
      (_all, section, slug, anchor = "") =>
        `](${PUBLIC_GUIDE}/en/${section}/${slug}.html${anchor})`,
    )
    .replace(
      /\]\(\/help\/([a-z0-9.-]+)(#[^)]*)?\)/g,
      (_all, topic, anchor = "") => `](https://remo.letii.ru/help/en/${topic}${anchor})`,
    )
    .replace(
      /\]\(\/guide\/([^)]+)\)/g,
      (_all, path) => `](${PUBLIC_GUIDE}/${path})`,
    );
}

/** `llms-full.txt`: every English page in reading order, with its source URL. */
function llmsFull() {
  const lines = [
    "# remo documentation",
    "",
    "> Public product documentation for AI agents. It grants no account, board or API access.",
    "> The in-app help is a separate short reference at https://remo.letii.ru/help/en.",
    `> Source map: ${PUBLIC_GUIDE}/llms.txt`,
    `> Content updated: ${contentUpdated}. Schema version: ${SCHEMA_VERSION}. Pages: ${ordered.length}.`,
    "",
  ];
  for (const page of ordered) {
    lines.push(
      `## ${page.meta.title.en}`,
      "",
      `Source: ${aiPageUrl(page)}`,
      "",
      absoluteGuideLinks(page.bodies.en ?? "").trim(),
      "",
      "---",
      "",
    );
  }
  return lines.join("\n");
}

const files = new Map();
for (const page of ordered) {
  for (const locale of LOCALES) {
    files.set(
      `${locale}/${page.section}/${page.slug}.html`,
      renderPage(page, locale),
    );
  }
}

files.set(
  "index.html",
  `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=/guide/ru/${ENTRY}.html">
<link rel="canonical" href="/guide/ru/${ENTRY}.html">
<title>Документация remo</title></head>
<body><a href="/guide/ru/${ENTRY}.html">Документация remo</a></body></html>
`,
);
files.set("search.json", `${JSON.stringify(search, null, 2)}\n`);
files.set("llms.txt", llmsIndex());
files.set("llms-full.txt", llmsFull());
files.set("assets/guide.css", readFileSync(join(GUIDE, "theme", "guide.css"), "utf8"));
files.set("assets/search.js", readFileSync(join(GUIDE, "theme", "search.js"), "utf8"));
files.set("assets/nav.js", readFileSync(join(GUIDE, "theme", "nav.js"), "utf8"));
files.set("assets/toc.js", readFileSync(join(GUIDE, "theme", "toc.js"), "utf8"));
files.set("assets/theme.js", readFileSync(join(GUIDE, "theme", "theme.js"), "utf8"));
files.set("assets/tabs.js", readFileSync(join(GUIDE, "theme", "tabs.js"), "utf8"));
files.set("assets/copy.js", readFileSync(join(GUIDE, "theme", "copy.js"), "utf8"));
files.set("assets/map.js", readFileSync(join(GUIDE, "theme", "map.js"), "utf8"));
files.set("assets/remo-logo.svg", LOGO);
for (const name of readdirSync(join(GUIDE, "assets"))) {
  const path = join(GUIDE, "assets", name);
  if (!statSync(path).isFile()) continue;
  if (!/\.(svg|png|jpe?g|webp)$/i.test(name)) continue;
  files.set(`assets/${name}`, readFileSync(path));
}
files.set(
  "assets/tokens.css",
  [
    "primitive.css",
    "semantic.css",
    "component.css",
    join("themes", "light.css"),
    join("themes", "dark.css"),
  ]
    .map((name) => readFileSync(join(ROOT, "packages/ui/src/tokens", name), "utf8"))
    .join("\n"),
);

/* ------------------------------------------------------------------ write -- */

if (problems.length) {
  for (const problem of problems) console.error(`guide: ${problem}`);
  process.exitCode = 1;
} else if (check) {
  for (const [relative, content] of files) {
    const path = join(OUT, relative);
    const current = exists(path) ? readFileSync(path) : null;
    // Text files are compared as text, binary assets (images) as bytes.
    const same =
      current !== null &&
      (typeof content === "string" ? current.toString("utf8") === content : current.equals(content));
    if (!same) fail(`${relative} is stale — run pnpm guide:build`);
  }
  if (problems.length) {
    for (const problem of problems) console.error(`guide: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`guide: ${pages.size} pages, ${LOCALES.length} locales, ${files.size} files current`);
  }
} else {
  for (const [relative, content] of files) {
    const path = join(OUT, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(`guide: wrote ${pages.size} pages to docs-site/`);
}
