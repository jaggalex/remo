#!/usr/bin/env node
/**
 * The Q4 ratchet: one file, one reason to change (ADR-093, ADR-134).
 *
 * The gravity wells have been split, so the limit applies to every source file with no
 * exceptions — CSS included, because the largest file in the repository was a stylesheet
 * the ratchet could not see. A new file that crosses the limit fails the gate: split it, or
 * argue for an exception in an ADR rather than adding it to a list here.
 *
 * A file in the last 10% of the budget is reported as a warning, so the split is planned
 * instead of forced by the next feature.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LIMIT = 800;
const WARN_AT = Math.floor(LIMIT * 0.9);
const SOURCE = /\.(ts|tsx|mjs|css)$/;
const SKIP = new Set(["node_modules", "dist", "test-results", "e2e-report", "playwright-report", ".git"]);

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const full = join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

const roots = ["apps/web/src", "apps/sync", "packages"];
const files = roots.flatMap((root) => walk(join(ROOT, root)));
const problems = [];
const warnings = [];

for (const file of files) {
  const path = relative(ROOT, file);
  if (path.includes(".test.") || path.endsWith(".d.ts")) continue;
  const content = readFileSync(file, "utf8");
  const lines = content.replace(/\n$/, "").split("\n").length;
  if (lines > LIMIT) problems.push(`${path}: ${lines} lines, limit ${LIMIT}`);
  else if (lines >= WARN_AT) warnings.push(`${path}: ${lines} lines, ${LIMIT - lines} left`);
}

if (warnings.length) {
  console.log(`File sizes: ${warnings.length} file(s) in the last 10% of the budget:`);
  for (const warning of warnings) console.log(`  ${warning}`);
}

if (problems.length) {
  console.error("File size check failed:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`File sizes ok: ${files.length} files, limit ${LIMIT}, no exceptions`);
