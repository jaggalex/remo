import { describe, expect, it } from "vitest";
import { backupKeep } from "./db-backup.mjs";

describe("backup retention", () => {
  it("keeps fourteen dumps by default", () => {
    expect(backupKeep(undefined)).toBe(14);
    expect(backupKeep("")).toBe(14);
  });

  it("accepts a positive integer", () => {
    expect(backupKeep("1")).toBe(1);
    expect(backupKeep("30")).toBe(30);
  });

  it("refuses a value that would delete every dump", () => {
    // Number("") is 0 and Number("abc") is NaN; slice(0) and slice(NaN) keep none.
    for (const raw of ["0", "-1", "abc", "1.5"]) {
      expect(() => backupKeep(raw), raw).toThrow(/positive integer/);
    }
  });
});
