#!/usr/bin/env node
/**
 * The numbers in the documents are generated, not typed (ADR-132).
 *
 * Hand-typed counts drift: documents claimed numbers that the tree no longer had. The
 * rule is simple — a count that can be derived is derived.
 *
 * Two kinds of numbers, treated differently:
 *
 *   tree facts   — a property of the repository: ADR count, schema version, scenarios,
 *                  pages, baselines. Generated here, checked by `pnpm verify`.
 *   run facts    — a property of one execution: durations, pass counts, coverage. The
 *                  command that measures them prints them; a document never restates one
 *                  without a date, because it will drift on the next run.
 *
 *   node scripts/state-report.mjs            # check (what the gate runs)
 *   node scripts/state-report.mjs --write    # rewrite the blocks after a real change
 *   node scripts/state-report.mjs --print    # print the block, write nothing
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEGIN = "<!-- generated:state:begin -->";
const END = "<!-- generated:state:end -->";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const print = args.has("--print");

/** Documents that carry the block, and the language they are written in. */
const DOCUMENTS = [
  { path: "AGENTS.md", lang: "ru" },
  { path: "TESTING.md", lang: "en" },
];

const SOURCE_ROOTS = ["apps/web/src", "apps/sync", "packages"];
const SOURCE = /\.(ts|tsx|mjs|css)$/;
const SKIP = new Set(["node_modules", "dist", ".data", "test-results", "e2e-report"]);

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function adrFacts() {
  const text = readFileSync(join(ROOT, "ADR.md"), "utf8");
  const ids = [...text.matchAll(/^## ADR-(\d+):/gm)].map((match) => Number(match[1]));
  if (ids.length === 0) throw new Error("ADR.md has no `## ADR-N:` headings");
  return { count: ids.length, latest: Math.max(...ids) };
}

async function schemaVersion() {
  const module = await import(pathToFileURL(join(ROOT, "apps/sync/schema-version.mjs")).href);
  return module.SCHEMA_VERSION;
}

function helpTopics() {
  const base = join(ROOT, "content/help");
  return readdirSync(base).filter((entry) => existsSync(join(base, entry, "topic.json"))).length;
}

function guidePages() {
  // One page is a directory with `ru.md` and `en.md` (scripts/guide-build.mjs enforces both).
  return walk(join(ROOT, "guide")).filter((file) => file.endsWith("/ru.md")).length;
}

function baselines() {
  const png = (directory) => {
    const base = join(ROOT, directory);
    if (!existsSync(base)) return 0;
    return readdirSync(base).filter((entry) => entry.endsWith(".png")).length;
  };
  return { product: png("spec/baselines"), design: png("spec/ds-baselines") };
}

function largestSource() {
  let best = { path: null, lines: 0 };
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      if (!SOURCE.test(file) || file.includes(".test.")) continue;
      const lines = readFileSync(file, "utf8").replace(/\n$/, "").split("\n").length;
      if (lines > best.lines) best = { path: relative(ROOT, file), lines };
    }
  }
  return best;
}

function e2eFacts() {
  // `--list` collects without starting a server, so it is the authoritative count.
  const result = spawnSync("pnpm", ["exec", "playwright", "test", "--list"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = /Total: (\d+) tests? in (\d+) files?/.exec(output);
  if (!match) {
    throw new Error(`cannot read the e2e scenario count from \`playwright test --list\`:\n${output.slice(-400)}`);
  }
  return { tests: Number(match[1]), files: Number(match[2]) };
}

const LABELS = {
  ru: {
    caption: "Факты дерева, проверяются `pnpm state:check`; числа прогона печатают сами команды.",
    columns: ["Факт", "Значение"],
    adr: "ADR",
    adrValue: (facts) => `${facts.adr.count}, последний — ADR-${facts.adr.latest}`,
    schema: "Версия схемы",
    e2e: "Браузерные сценарии",
    e2eValue: (facts) => `${facts.e2e.tests} в ${facts.e2e.files} файлах`,
    help: "Темы помощи",
    helpValue: (facts) => `${facts.help} (RU + EN)`,
    guide: "Страницы портала",
    baselines: "Эталоны",
    baselinesValue: (facts) => `${facts.baselines.product} продуктовых + ${facts.baselines.design} DS`,
    largest: "Крупнейший файл",
    largestValue: (facts) => `\`${facts.largest.path}\` — ${facts.largest.lines} строк`,
  },
  en: {
    caption: "Tree facts, checked by `pnpm state:check`; run facts are printed by the commands themselves.",
    columns: ["Fact", "Value"],
    adr: "ADR",
    adrValue: (facts) => `${facts.adr.count}, latest ADR-${facts.adr.latest}`,
    schema: "Schema version",
    e2e: "Browser scenarios",
    e2eValue: (facts) => `${facts.e2e.tests} in ${facts.e2e.files} files`,
    help: "Help topics",
    helpValue: (facts) => `${facts.help} (RU + EN)`,
    guide: "Portal pages",
    baselines: "Baselines",
    baselinesValue: (facts) => `${facts.baselines.product} product + ${facts.baselines.design} DS`,
    largest: "Largest file",
    largestValue: (facts) => `\`${facts.largest.path}\` — ${facts.largest.lines} lines`,
  },
};

function render(lang, facts) {
  const label = LABELS[lang];
  if (!label) throw new Error(`unknown language ${lang}`);
  const rows = [
    [label.adr, label.adrValue(facts)],
    [label.schema, String(facts.schema)],
    [label.e2e, label.e2eValue(facts)],
    [label.help, label.helpValue(facts)],
    [label.guide, String(facts.guide)],
    [label.baselines, label.baselinesValue(facts)],
    [label.largest, label.largestValue(facts)],
  ];
  return [
    `_${label.caption}_`,
    "",
    `| ${label.columns[0]} | ${label.columns[1]} |`,
    "|---|---|",
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
  ].join("\n");
}

function replaceBlock(text, block) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return `${text.slice(0, start)}${BEGIN}\n${block}\n${END}${text.slice(end + END.length)}`;
}

/** The first line that differs, so a failure names the fact and not just the file. */
function firstDifference(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return { line: index + 1, expected: a[index] ?? "", actual: b[index] ?? "" };
  }
  return null;
}

async function main() {
  const facts = {
    adr: adrFacts(),
    schema: await schemaVersion(),
    e2e: e2eFacts(),
    help: helpTopics(),
    guide: guidePages(),
    baselines: baselines(),
    largest: largestSource(),
  };

  if (print) {
    console.log(render("ru", facts));
    return 0;
  }

  const problems = [];
  for (const document of DOCUMENTS) {
    const path = join(ROOT, document.path);
    const current = readFileSync(path, "utf8");
    const block = render(document.lang, facts);
    const expected = replaceBlock(current, block);
    if (expected === null) {
      problems.push(`${document.path}: no ${BEGIN} / ${END} pair`);
      continue;
    }
    if (expected === current) continue;
    if (write) {
      writeFileSync(path, expected);
      console.log(`state: wrote ${document.path}`);
      continue;
    }
    const existing = current
      .slice(current.indexOf(BEGIN) + BEGIN.length, current.indexOf(END))
      .replace(/^\n/, "")
      .replace(/\n$/, "");
    const diff = firstDifference(block, existing);
    problems.push(
      `${document.path}: the generated block is stale` +
        (diff
          ? ` — block line ${diff.line}: has "${diff.actual.trim()}", expected "${diff.expected.trim()}"`
          : ""),
    );
  }

  if (problems.length === 0) {
    console.log(`state: ${DOCUMENTS.length} blocks current`);
    return 0;
  }

  for (const problem of problems) console.error(`  ${problem}`);
  if (!write) {
    console.error("Run `pnpm state:write` and commit the result.");
    return 1;
  }
  return 0;
}

process.exitCode = await main();
