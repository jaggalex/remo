/**
 * One run's configuration, checked without starting a server.
 *
 * Review finding: default and shifted runs used directories where one was an ancestor of
 * the other, so Playwright's cleanup of the default run could delete a concurrent shifted
 * run's evidence. The tests assert both path disjointness and actual cleanup behaviour.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAncestorPath, resolveRun } from "./ports";

const temporary: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "remo-artifacts-"));
  temporary.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("browser-gate run configuration", () => {
  it("keeps the fixed ports for the default run", () => {
    const run = resolveRun({ E2E_RUN_ID: "pid_ab12cd34" });
    expect(run.syncPort).toBe(1235);
    expect(run.proxyPort).toBe(1237);
    expect(run.webPort).toBe(5175);
    expect(run.databaseName).toBe("remo_test_e2e_pid_ab12cd34");
    expect(run.databaseUrl).toBe(
      "postgres://remo_test:remo_test@127.0.0.1:55432/remo_test_e2e_pid_ab12cd34",
    );
    expect(run.outputDir).toBe("test-results/default_pid_ab12cd34");
    expect(run.reportDir).toBe("e2e-report/default_pid_ab12cd34");
  });

  it("gives two concurrent runs different databases and artifact directories", () => {
    const first = resolveRun({ E2E_PORT_BASE: "1000", E2E_RUN_ID: "pid_ab12cd34" });
    const second = resolveRun({ E2E_PORT_BASE: "2000", E2E_RUN_ID: "pid_ef567890" });

    expect(first.databaseName).toBe("remo_test_e2e_1000_pid_ab12cd34");
    expect(second.databaseName).toBe("remo_test_e2e_2000_pid_ef567890");
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(first.syncPort).not.toBe(second.syncPort);
    expect(first.outputDir).not.toBe(second.outputDir);
    expect(first.reportDir).not.toBe(second.reportDir);
    expect(isAncestorPath(first.outputDir, second.outputDir)).toBe(false);
    expect(isAncestorPath(second.outputDir, first.outputDir)).toBe(false);
    expect(isAncestorPath(first.reportDir, second.reportDir)).toBe(false);
  });

  it("keeps default and shifted runs disjoint even with the same suffix time", () => {
    const def = resolveRun({ E2E_RUN_ID: "pid_1" });
    const shifted = resolveRun({ E2E_PORT_BASE: "1000", E2E_RUN_ID: "pid_2" });
    for (const [a, b] of [
      [def.outputDir, shifted.outputDir],
      [def.reportDir, shifted.reportDir],
    ]) {
      expect(a).not.toBe(b);
      expect(isAncestorPath(a, b)).toBe(false);
      expect(isAncestorPath(b, a)).toBe(false);
    }
  });

  it("cleaning one run's output leaves another run's artifacts intact", () => {
    const root = tempRoot();
    const first = resolveRun({ E2E_RUN_ID: "pid_1" });
    const second = resolveRun({ E2E_PORT_BASE: "1000", E2E_RUN_ID: "pid_2" });

    // Map the two relative defaults under one temporary root, then let the first run
    // "clean" exactly as Playwright does: remove its own output directory recursively.
    const firstOut = join(root, first.outputDir);
    const secondOut = join(root, second.outputDir);
    const secondReport = join(root, second.reportDir);
    mkdirSync(firstOut, { recursive: true });
    mkdirSync(secondOut, { recursive: true });
    mkdirSync(secondReport, { recursive: true });
    writeFileSync(join(firstOut, "trace.zip"), "first");
    writeFileSync(join(secondOut, "trace.zip"), "second");
    writeFileSync(join(secondReport, "index.html"), "second report");

    rmSync(firstOut, { recursive: true, force: true });

    expect(existsSync(firstOut)).toBe(false);
    expect(existsSync(join(secondOut, "trace.zip"))).toBe(true);
    expect(existsSync(join(secondReport, "index.html"))).toBe(true);
  });

  it("keeps explicit overrides but refuses nested artifact directories", () => {
    const override = "postgres://someone:secret@127.0.0.1:6000/control";
    const run = resolveRun({
      E2E_RUN_ID: "pid_1",
      E2E_PORT_BASE: "1000",
      E2E_OUTPUT_DIR: "custom-results",
      E2E_REPORT_DIR: "custom-report",
      E2E_SYNC_PORT: "9001",
      REMO_TEST_POSTGRES_URL: override,
      DATABASE_URL: "postgres://remo:remo@127.0.0.1:5432/remo",
    });

    expect(run.outputDir).toBe("custom-results");
    expect(run.reportDir).toBe("custom-report");
    expect(run.syncPort).toBe(9001);
    expect(run.databaseUrl).toBe(
      new URL("/remo_test_e2e_1000_pid_1", override).toString(),
    );
    // DATABASE_URL is never consulted by the test configuration.
    expect(run.databaseUrl).not.toContain(":5432/remo");
    expect(run.databaseName).toBe("remo_test_e2e_1000_pid_1");

    expect(() =>
      resolveRun({
        E2E_RUN_ID: "pid_1",
        E2E_OUTPUT_DIR: "same",
        E2E_REPORT_DIR: "same/report",
      }),
    ).toThrow(/must be separate, non-nested/);
  });

  it("treats an empty suffix as unset rather than sharing the default run", () => {
    const run = resolveRun({ E2E_PORT_BASE: "1000", E2E_RUN_SUFFIX: "  ", E2E_RUN_ID: "pid_1" });
    expect(run.databaseName).toBe("remo_test_e2e_1000_pid_1");
    expect(run.outputDir).toBe("test-results/1000_pid_1");
  });

  it("refuses a suffix that would silently collide with another run", () => {
    expect(() => resolveRun({ E2E_RUN_SUFFIX: "1000-a" })).toThrow(/E2E_RUN_SUFFIX/);
    expect(() => resolveRun({ E2E_RUN_SUFFIX: "1000 a" })).toThrow(/E2E_RUN_SUFFIX/);
    expect(resolveRun({ E2E_RUN_SUFFIX: "Run_1", E2E_RUN_ID: "pid_1" }).databaseName).toBe(
      "remo_test_e2e_run_1_pid_1",
    );
  });
});
