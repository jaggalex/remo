/**
 * The release configuration is read, not executed.
 *
 * `release.sh` used to `source` the operator's file, so a document could run commands
 * and change the environment the verification gate sees. These cases pin the replacement:
 * strict `KEY=VALUE` lines, an owned file with mode 600, no symlink.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIB = join(ROOT, "deploy", "config.sh");

function fileWith(content, mode = 0o600) {
  const dir = mkdtempSync(join(tmpdir(), "remo-release-"));
  const path = join(dir, "deploy.env");
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

function read(path) {
  const script = [
    `source ${JSON.stringify(LIB)}`,
    `read_release_config ${JSON.stringify(path)} || exit $?`,
    `printf '%s|%s|%s' "\${REMO_DEPLOY_HOST:-}" "\${REMO_APP_ORIGIN:-}" "\${REMO_DOCS_ORIGIN:-}"`,
  ].join("; ");
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("the release configuration parser", () => {
  it("reads plain assignments, comments and blank lines", () => {
    const path = fileWith(
      [
        "# release configuration",
        "",
        "REMO_DEPLOY_HOST=deploy@example.com",
        "REMO_APP_ORIGIN=https://boards.example.com",
        "REMO_DOCS_ORIGIN=https://docs.example.com",
        "",
      ].join("\n"),
    );
    const result = read(path);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "deploy@example.com|https://boards.example.com|https://docs.example.com",
    );
  });

  it("refuses a line that is not KEY=VALUE", () => {
    for (const line of ["export REMO_DEPLOY_HOST=x", "REMO DEPLOY HOST=x", "just a word"]) {
      const result = read(fileWith(`${line}\n`));
      expect(result.status, line).not.toBe(0);
      expect(result.stderr).toContain("Invalid line");
    }
  });

  it("refuses shell syntax in a value", () => {
    for (const line of ["REMO_DEPLOY_HOST=$(whoami)", "REMO_DEPLOY_HOST=`whoami`"]) {
      const result = read(fileWith(`${line}\n`));
      expect(result.status, line).not.toBe(0);
      expect(result.stderr).toContain("Shell syntax is not allowed");
    }
  });

  it("refuses an unknown key instead of silently ignoring a typo", () => {
    const result = read(fileWith("REMO_DEPLOY_HOTS=deploy@example.com\n"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown key");
  });

  it("refuses a file another user could read", () => {
    const result = read(fileWith("REMO_DEPLOY_HOST=deploy@example.com\n", 0o644));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mode 600");
  });

  it("refuses a symlink, even to a valid file", () => {
    const target = fileWith("REMO_DEPLOY_HOST=deploy@example.com\n");
    const link = join(mkdtempSync(join(tmpdir(), "remo-release-")), "deploy.env");
    symlinkSync(target, link);
    const result = read(link);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("symlinked");
  });
});
