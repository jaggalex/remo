#!/usr/bin/env node
/**
 * Prune old Playwright reports.
 *
 * Every run writes its traces and screenshots under `e2e-report/<run>` and
 * `test-results/<run>`. The files are useful while debugging a failure and useless after
 * that: a month of runs is gigabytes. `pnpm e2e` calls this after the database teardown,
 * and `pnpm e2e:clean` runs it on demand.
 *
 * The newest N runs are always kept. Anything older than D days and outside those N is
 * removed. `--all` removes every run; `--dry-run` prints what would go.
 *
 * Only directories directly inside the two run-scoped roots are touched. A plain
 * Playwright HTML report (`playwright-report/`) has data directories of its own, so it is
 * deliberately not treated as a run root.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPORT_ROOTS = ["e2e-report", "test-results"];
export const DEFAULT_KEEP = 10;
export const DEFAULT_DAYS = 7;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

/**
 * Remove old run directories under the report roots.
 *
 * @returns {Promise<Array<{root: string, removed: number, kept: number}>>}
 */
export async function cleanupReports({
  root = ROOT,
  keep = DEFAULT_KEEP,
  days = DEFAULT_DAYS,
  all = false,
  dryRun = false,
  roots = REPORT_ROOTS,
} = {}) {
  const keepCount = all ? 0 : positive(keep, DEFAULT_KEEP);
  const keepDays = positive(days, DEFAULT_DAYS);
  const cutoff = keepDays > 0 ? Date.now() - keepDays * 24 * 60 * 60 * 1000 : 0;
  const result = [];

  for (const name of roots) {
    const directory = join(root, name);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }

    const runs = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      const info = await stat(path);
      runs.push({ path, mtime: info.mtimeMs });
    }
    runs.sort((a, b) => b.mtime - a.mtime);

    const newest = new Set(runs.slice(0, keepCount).map((run) => run.path));
    const doomed = all
      ? runs
      : runs.filter((run) => !newest.has(run.path) && (keepDays <= 0 || run.mtime < cutoff));

    if (!dryRun) {
      for (const run of doomed) await rm(run.path, { recursive: true, force: true });
    }
    result.push({ root: name, removed: doomed.length, kept: runs.length - doomed.length });
  }

  return result;
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: node scripts/e2e-clean.mjs [--keep N] [--days D] [--all] [--dry-run]",
    );
    return;
  }
  const keep = positive(
    option(args, "--keep", process.env.REMO_E2E_KEEP ?? DEFAULT_KEEP),
    DEFAULT_KEEP,
  );
  const days = positive(
    option(args, "--days", process.env.REMO_E2E_KEEP_DAYS ?? DEFAULT_DAYS),
    DEFAULT_DAYS,
  );
  const result = await cleanupReports({
    keep,
    days,
    all: args.includes("--all"),
    dryRun: args.includes("--dry-run"),
  });
  for (const entry of result) {
    console.log(
      `${entry.root}: ${args.includes("--dry-run") ? "would remove" : "removed"} ${entry.removed}, kept ${entry.kept}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[e2e-clean] ${error.message}`);
    process.exitCode = 1;
  });
}
