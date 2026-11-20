import { describe, expect, it } from "vitest";
import { formatStorageBytes, storageShare, storageTone } from "./storageUsage";

/**
 * The storage bar's thresholds and sizes (ADR-249 §7, `spec/images.md` §9.8): accent
 * under 80 %, warning up to 100 %, danger at the ceiling, and `null` never divides.
 */
describe("storageShare", () => {
  it("is zero without a limit", () => {
    expect(storageShare(500, null)).toBe(0);
  });

  it("is the used part of the ceiling", () => {
    expect(storageShare(0, 100)).toBe(0);
    expect(storageShare(50, 100)).toBe(0.5);
    expect(storageShare(100, 100)).toBe(1);
  });

  it("caps at a full bar and ignores nonsense", () => {
    expect(storageShare(260, 100)).toBe(1);
    expect(storageShare(-5, 100)).toBe(0);
    expect(storageShare(Number.NaN, 100)).toBe(0);
    expect(storageShare(500, 0)).toBe(0);
  });
});

describe("storageTone", () => {
  it("names the colour role of the threshold", () => {
    expect(storageTone(0)).toBe("accent");
    expect(storageTone(0.79)).toBe("accent");
    expect(storageTone(0.8)).toBe("warning");
    expect(storageTone(0.99)).toBe("warning");
    expect(storageTone(1)).toBe("danger");
  });
});

describe("formatStorageBytes", () => {
  it("uses a readable unit in both languages", () => {
    expect(formatStorageBytes(0, "en")).toMatch(/byte/);
    expect(formatStorageBytes(0, "ru")).toMatch(/байт/);
    expect(formatStorageBytes(12_000, "en")).toMatch(/kB|KB/);
    expect(formatStorageBytes(1_500_000, "en")).toMatch(/MB/);
    expect(formatStorageBytes(2 * 1024 ** 3, "en")).toMatch(/GB/);
    expect(formatStorageBytes(2 * 1024 ** 3, "ru")).toMatch(/ГБ/);
  });
});
