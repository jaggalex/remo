#!/usr/bin/env node
/**
 * Builds the user help from `content/help/` (ADR-081).
 *
 * RU is the source language, EN a required translation. The script validates the
 * metadata and links, renders Markdown at build time (raw HTML disabled), and writes
 * typed ids plus one JSON bundle the app imports. `--check` fails instead of writing
 * when the output is stale or a translation is missing/outdated.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { markdown, plain, readJson, translationHash } from "./docs-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = join(ROOT, "content/help");
const OUT = join(ROOT, "apps/web/src/help");
const LOCALES = ["ru", "en"];
const TYPES = new Set(["tutorial", "how-to", "reference", "explanation"]);
const check = process.argv.includes("--check");
const accept = process.argv.includes("--accept-translations");

const md = markdown();

function fail(message) {
  console.error(`docs: ${message}`);
  process.exitCode = 1;
}

function topicJson(path) {
  try {
    return readJson(path);
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return null;
  }
}

if (!statSync(CONTENT, { throwIfNoEntry: false })) {
  fail(`missing ${CONTENT}`);
  process.exit();
}

const topics = [];
const ids = new Set();
const dirs = new Set(readdirSync(CONTENT));
for (const name of readdirSync(CONTENT).sort()) {
  const dir = join(CONTENT, name);
  if (!statSync(dir).isDirectory()) continue;
  const meta = topicJson(join(dir, "topic.json"));
  if (!meta) continue;
  if (meta.id !== name) fail(`${name}: topic.json id is "${meta.id}"`);
  if (ids.has(meta.id)) fail(`${name}: duplicate topic id`);
  ids.add(meta.id);
  if (!TYPES.has(meta.type)) fail(`${name}: unknown type "${meta.type}"`);
  if (meta.audience !== "public" && meta.audience !== "private") fail(`${name}: audience must be public or private`);
  if (meta.audience === "private") fail(`${name}: private topics are not supported in the public build yet`);
  for (const locale of LOCALES) {
    if (!meta.title?.[locale] || !meta.summary?.[locale]) fail(`${name}: title/summary missing ${locale}`);
  }
  const bodies = {};
  for (const locale of LOCALES) {
    const path = join(dir, `${locale}.md`);
    if (!statSync(path, { throwIfNoEntry: false })) {
      fail(`${name}: missing ${locale}.md`);
      continue;
    }
    bodies[locale] = readFileSync(path, "utf8");
    if (!bodies[locale].trim()) fail(`${name}: ${locale}.md is empty`);
  }
  const sourceHash = bodies.ru ? translationHash(meta, "ru", bodies.ru) : "";
  const targetHash = bodies.en ? translationHash(meta, "en", bodies.en) : "";
  const previousSource = meta.translations?.en?.sourceHash;
  const previousTarget = meta.translations?.en?.targetHash;
  const current = previousSource === sourceHash && previousTarget === targetHash;
  if (accept && sourceHash) {
    if (previousSource && previousSource !== sourceHash && previousTarget && previousTarget === targetHash) {
      fail(`${name}: EN translation did not change while RU did; translate it before accepting`);
    } else {
      meta.translations = {
        ...(meta.translations ?? {}),
        en: { ...(meta.translations?.en ?? {}), sourceHash, targetHash },
      };
      writeFileSync(join(dir, "topic.json"), `${JSON.stringify(meta, null, 2)}\n`);
    }
  }
  const status = !bodies.en ? "missing" : current || accept ? "current" : "outdated";
  if (meta.audience === "public" && status !== "current" && (check || accept === false)) {
    // A public article without a reviewed translation is a gap, not a silent fallback.
    fail(`${name}: EN translation is ${status}`);
  }
  const html = {};
  for (const locale of LOCALES) {
    if (!bodies[locale]) continue;
    html[locale] = md.render(bodies[locale]);
    for (const match of bodies[locale].matchAll(/\]\(\/help\/(?:ru|en)\/([^)#]+)[^)]*\)/g)) {
      const target = match[1];
      if (!ids.has(target) && !dirs.has(target)) {
        fail(`${name}/${locale}: link to missing topic "${target}"`);
      }
    }
  }
  topics.push({
    id: meta.id,
    type: meta.type,
    title: meta.title,
    summary: meta.summary,
    related: Array.isArray(meta.related) ? meta.related : [],
    verifiedAgainst: String(meta.verifiedAgainst ?? ""),
    audience: meta.audience,
    sourceHash,
    translationStatus: status,
    html,
  });
}

for (const topic of topics) {
  for (const related of topic.related) {
    if (!topics.some((candidate) => candidate.id === related)) {
      fail(`${topic.id}: related topic "${related}" does not exist`);
    }
  }
}

const search = { ru: [], en: [] };
for (const locale of LOCALES) {
  search[locale] = topics
    .filter((topic) => topic.html[locale])
    .map((topic) => ({
      id: topic.id,
      title: topic.title[locale],
      summary: topic.summary[locale],
      text: plain(topic.html[locale]),
    }));
}

const bundle = { topics, search };
const ts = `/* Generated by scripts/docs-build.mjs. Do not edit. */
export const HELP_TOPIC_IDS = ${JSON.stringify(topics.map((topic) => topic.id))} as const;
export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];
export const HELP_LOCALES = ["ru", "en"] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];
`;

const json = `${JSON.stringify(bundle, null, 2)}\n`;
const jsonPath = join(OUT, "generated.json");
const tsPath = join(OUT, "topics.generated.ts");
const currentJson = statSync(jsonPath, { throwIfNoEntry: false }) ? readFileSync(jsonPath, "utf8") : null;
const currentTs = statSync(tsPath, { throwIfNoEntry: false }) ? readFileSync(tsPath, "utf8") : null;

if (check) {
  if (currentJson !== json) fail("apps/web/src/help/generated.json is stale — run pnpm docs:build");
  if (currentTs !== ts) fail("apps/web/src/help/topics.generated.ts is stale — run pnpm docs:build");
  if (!process.exitCode) console.log(`docs: ${topics.length} topics, both locales current`);
} else {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(jsonPath, json);
  writeFileSync(tsPath, ts);
  console.log(`docs: wrote ${topics.length} topics to apps/web/src/help/`);
}
