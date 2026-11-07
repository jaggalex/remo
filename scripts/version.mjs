#!/usr/bin/env node
/**
 * One answer to "which remo is this?" (ADR-179).
 *
 * The product has three numbers, deliberately separate:
 *   version — the release a person names (semver, from package.json);
 *   build   — a counter that grows on every commit;
 *   schema  — the database compatibility version.
 *
 * The build number comes from git when the checkout has history; a Docker build gets
 * the same values as build args, so the image and the source agree. A missing git
 * checkout is not an error: a release archive reports `dev` rather than inventing a
 * number.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../apps/sync/schema-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function git(args, fallback) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

/** Values the web build, the sync process and the release script all use. */
export function buildInfo(env = process.env) {
  return {
    version: env.REMO_VERSION || packageJson.version || "0.0.0-dev",
    build: env.REMO_BUILD || git(["rev-list", "--count", "HEAD"], "dev"),
    commit: env.REMO_COMMIT || git(["rev-parse", "--short", "HEAD"], "dev"),
    schema: SCHEMA_VERSION,
  };
}

if (process.argv[1] && process.argv[1].endsWith("version.mjs")) {
  const info = buildInfo();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log(
      `remo ${info.version} · build ${info.build} · ${info.commit}` +
        (info.schema ? ` · schema ${info.schema}` : ""),
    );
  }
}
