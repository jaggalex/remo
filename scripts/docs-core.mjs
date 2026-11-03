/**
 * Shared primitives for the two documentation builds: in-app help (ADR-081) and the
 * product guide portal.
 *
 * One mechanism, two outputs. Both collections are RU-source with a required EN
 * translation tracked by a content hash, both render Markdown with raw HTML disabled,
 * and both fail the gate instead of publishing a stale translation. Keeping the rules
 * here is what stops the two from drifting apart.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";

/** Raw HTML is off: documentation is data, and an `html` block would be executable output. */
export function markdown() {
  return new MarkdownIt({ html: false, linkify: false, typographer: false });
}

export function hash(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function exists(path) {
  return Boolean(statSync(path, { throwIfNoEntry: false }));
}

export function directories(path) {
  if (!exists(path)) return [];
  return readdirSync(path)
    .sort()
    .filter((name) => statSync(join(path, name)).isDirectory());
}

export function plain(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** A stable anchor: lowercase, digits, single dashes; Cyrillic is transliterated away. */
export function slugify(text) {
  const latin = text
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => CYRILLIC[letter] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || "section";
}

const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

/**
 * Heading ids and a table of contents from the rendered Markdown.
 *
 * The body starts at H2 — the page title is the layout's H1 — so the table of contents
 * is the list of H2/H3 in order, and an id is stable for the life of the heading.
 */
export function withHeadingIds(md) {
  md.core.ruler.push("heading_ids", (state) => {
    const used = new Map();
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.type !== "heading_open") continue;
      const inline = state.tokens[index + 1];
      let id = slugify(inline?.content ?? "");
      const seen = (used.get(id) ?? 0) + 1;
      used.set(id, seen);
      if (seen > 1) id = `${id}-${seen}`;
      token.attrSet("id", id);
      token.meta = { ...(token.meta ?? {}), guideId: id };
    }
  });
  return md;
}

const CONTAINERS = new Set(["note", "tip", "warning", "danger", "actions", "tabs", "tab"]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `:::note`, `:::tip`, `:::warning`, `:::danger` and the two layout containers
 * (`:::actions` for cards, `:::tabs` with `:::tab` children).
 *
 * Markdown stays Markdown: no raw HTML is accepted, the container names are a closed set,
 * and the inner content is parsed by the same rules as the page. The label text comes from
 * the language the page is rendered in.
 */
export function withContainers(md, labels) {
  md.block.ruler.before("fence", "guide_container", (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]);
    const match = /^:::[ \t]*([a-z][a-z-]*)[ \t]*(.*)$/.exec(line);
    if (!match || !CONTAINERS.has(match[1])) return false;
    if (silent) return true;

    const kind = match[1];
    let nextLine = startLine;
    let closed = false;
    // Containers nest (:::tabs > :::tab), so the closing marker is the one that brings
    // the depth back to zero, not the first bare ::: on the way.
    let depth = 1;
    while (++nextLine < endLine) {
      if (state.sCount[nextLine] < state.blkIndent) break;
      const at = state.bMarks[nextLine] + state.tShift[nextLine];
      const text = state.src.slice(at, state.eMarks[nextLine]);
      if (/^:::[ \t]*[a-z]/.test(text)) {
        depth += 1;
      } else if (/^:::[ \t]*$/.test(text)) {
        depth -= 1;
        if (depth === 0) {
          closed = true;
          break;
        }
      }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;
    state.parentType = "container";

    const open = state.push("guide_container_open", "div", 1);
    open.block = true;
    open.info = kind;
    open.markup = ":::";
    open.map = [startLine, nextLine];
    open.meta = { title: match[2].trim() };

    state.lineMax = nextLine;
    state.md.block.tokenize(state, startLine + 1, nextLine);
    state.lineMax = oldLineMax;
    state.parentType = oldParent;

    const close = state.push("guide_container_close", "div", -1);
    close.markup = ":::";
    close.info = kind;
    state.line = nextLine + (closed ? 1 : 0);
    return true;
  });

  md.renderer.rules.guide_container_open = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    if (token.info === "actions") return '<div class="cards">';
    if (token.info === "tabs") return '<div class="tabs">';
    if (token.info === "tab") {
      return `<section class="tab" data-tab="${escapeHtml(token.meta.title)}"><h3>${escapeHtml(
        token.meta.title,
      )}</h3>`;
    }
    const locale = env && env.locale === "en" ? "en" : "ru";
    const label = (labels[locale] && labels[locale][token.info]) || token.info;
    return `<div class="note note-${token.info}" role="note"><p class="note-label">${escapeHtml(
      label,
    )}</p>`;
  };

  md.renderer.rules.guide_container_close = (tokens, idx) => {
    const kind = tokens[idx].info;
    return kind === "tab" ? "</section>" : "</div>";
  };

  return md;
}

export function headings(md, body) {
  const tokens = md.parse(body, {});
  const out = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "heading_open") continue;
    out.push({
      level: Number(tokens[index].tag.slice(1)),
      text: tokens[index + 1]?.content ?? "",
      id: tokens[index].attrGet("id") ?? "",
    });
  }
  return out;
}

/** Heading discipline: one H1 in the layout, body starts at H2, no skipped levels. */
export function headingProblems(md, body, label) {
  const problems = [];
  const list = headings(md, body);
  if (!list.length) return [`${label}: no headings`];
  if (list[0].level !== 2) problems.push(`${label}: the body must start with H2`);
  let previous = 1;
  for (const heading of list) {
    if (heading.level === 1) problems.push(`${label}: the body must not contain H1 ("${heading.text}")`);
    if (heading.level > previous + 1) {
      problems.push(`${label}: H${heading.level} after H${previous} ("${heading.text}")`);
    }
    previous = heading.level;
  }
  return problems;
}

/** Every `](target)` in the source, so a broken cross-link fails the build. */
export function linkTargets(body) {
  return [...body.matchAll(/\]\(([^)\s]+)/g)].map((match) => match[1]);
}

/** The ids of the in-app help, read from the content tree (one source of truth). */
export function helpTopicIds(root) {
  const content = join(root, "content", "help");
  const ids = new Set();
  for (const name of directories(content)) {
    if (exists(join(content, name, "topic.json"))) ids.add(name);
  }
  return ids;
}
