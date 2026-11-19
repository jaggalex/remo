#!/usr/bin/env node
// Writes src/tokens/*.css from src/tokens/tokens.json. `--check` fails instead of
// writing when a generated file is stale, so CI catches a hand-edited CSS file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss, loadTokens, lintTokens } from "./tokens-lib.mjs";

const root = fileURLToPath(new URL("../src/tokens/", import.meta.url));
const check = process.argv.includes("--check");
const tokens = loadTokens();

const problems = lintTokens(tokens);
if (problems.length) {
  console.error(`tokens.json: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

let stale = 0;
for (const [file, text] of Object.entries(buildCss(tokens))) {
  const path = join(root, file);
  let current = null;
  try { current = readFileSync(path, "utf8"); } catch { /* new file */ }
  if (current === text) continue;
  if (check) { console.error(`stale: src/tokens/${file} — run pnpm ds:tokens`); stale++; continue; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote src/tokens/${file}`);
}
if (stale) process.exit(1);
