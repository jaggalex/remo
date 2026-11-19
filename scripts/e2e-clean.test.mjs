import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupReports } from "./e2e-clean.mjs";

const DAY = 24 * 60 * 60 * 1000;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "remo-e2e-clean-"));
  const old = Date.now() - 10 * DAY;
  for (const [report, run] of [
    ["e2e-report", "old-a"],
    ["e2e-report", "old-b"],
    ["e2e-report", "new"],
    ["test-results", "old-a"],
    ["test-results", "old-b"],
  ]) {
    const directory = join(root, report, run);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "trace.txt"), run);
    const when = run.startsWith("old") ? old : Date.now();
    await utimes(directory, when / 1000, when / 1000);
  }
  return root;
}

describe("e2e report retention", () => {
  it("keeps the newest run and removes old runs outside the keep window", async () => {
    const root = await fixture();
    try {
      const result = await cleanupReports({ root, keep: 1, days: 7 });
      expect(result).toEqual([
        { root: "e2e-report", removed: 2, kept: 1 },
        { root: "test-results", removed: 1, kept: 1 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes every run with --all", async () => {
    const root = await fixture();
    try {
      const result = await cleanupReports({ root, all: true });
      expect(result.find((entry) => entry.root === "e2e-report")).toEqual({
        root: "e2e-report",
        removed: 3,
        kept: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not delete anything in a dry run", async () => {
    const root = await fixture();
    try {
      const result = await cleanupReports({ root, all: true, dryRun: true });
      expect(result.find((entry) => entry.root === "e2e-report")?.removed).toBe(3);
      await expect(stat(join(root, "e2e-report", "new"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
