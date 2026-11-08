#!/usr/bin/env node
/**
 * Prepare a product release (ADR-179).
 *
 *   node scripts/release.mjs minor --notes "..." --commit
 *   node scripts/release.mjs 0.3.0 --notes "..."
 *
 * The version is semver in the root package.json; the build counter is git history and
 * is not changed here. The script updates the package, README status and CHANGELOG,
 * runs the gate, then commits and tags when `--commit` is given. It never pushes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const kind = args.find((arg) => !arg.startsWith("--")) ?? "";
const commit = args.includes("--commit");
const noVerify = args.includes("--no-verify");
const notesAt = args.indexOf("--notes");
const notes = notesAt === -1 ? "" : args[notesAt + 1] ?? "";

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", ...options });
}

function git(commandArgs) {
  return execFileSync("git", commandArgs, { cwd: ROOT, encoding: "utf8" }).trim();
}

function nextVersion(current, what) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(what)) return what;
  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  if (what === "patch") return `${major}.${minor}.${patch + 1}`;
  if (what === "minor") return `${major}.${minor + 1}.0`;
  if (what === "major") return `${major + 1}.0.0`;
  fail("usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--notes TEXT] [--commit]");
}

const packagePath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const previous = pkg.version;
const version = nextVersion(previous, kind);
const date = new Date().toISOString().slice(0, 10);

if (git(["status", "--porcelain"]) && !args.includes("--allow-dirty")) {
  fail("the working tree is not clean; commit the change before a release");
}

pkg.version = version;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const readmePath = join(ROOT, "README.md");
const readme = readFileSync(readmePath, "utf8");
writeFileSync(
  readmePath,
  readme.replace(/\*\*Status: .*? alpha\.\*\*/, `**Status: ${version} alpha.**`),
);

const changelogPath = join(ROOT, "CHANGELOG.md");
let changelog = readFileSync(changelogPath, "utf8");
changelog = changelog.replace(/remo is at \*\*.*?\*\*\./, `remo is at **${version}**.`);
const heading = `## [${version}] - ${date}`;
if (!changelog.includes(heading)) {
  const body = notes.trim() || "See the product guide changelog for the user-facing history.";
  const marker = "Release notes for a version are written from that page; the ADR records the reasons.";
  changelog = changelog.replace(
    marker,
    `${heading}\n\n${body}\n\n${marker}`,
  );
}
writeFileSync(changelogPath, changelog);

console.log(`release: ${previous} → ${version} (${date})`);
if (notes) console.log(`release: ${notes}`);

// The guide embeds the package version in its generated pages.
if (!noVerify) run("pnpm", ["guide:build"]);
if (!noVerify) run("pnpm", ["verify"]);
if (!commit) {
  console.log("release: files prepared; review, commit and tag when ready");
  process.exit(0);
}

run("git", ["add", "package.json", "README.md", "CHANGELOG.md"]);
run("git", ["commit", "-m", `release: v${version}`]);
run("git", ["tag", "-a", `v${version}`, "-m", `remo ${version}`]);
console.log(`release: committed and tagged v${version} (not pushed)`);
