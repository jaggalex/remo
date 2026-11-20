import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileStore, fileKey, filesDirectory, filesDriver } from "./files-store.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("storage keys", () => {
  it("are built from ids only, never from the user's file name", () => {
    const key = fileKey("org-1", "file-1", "w256");
    expect(key).toBe("orgs/org-1/files/file-1/w256");
    expect(key).not.toContain("screenshot");
    expect(key).not.toContain(" ");
  });

  it("refuses an unknown variant instead of putting it in a path", () => {
    expect(() => fileKey("org-1", "file-1", "../../etc/passwd")).toThrow(/unknown file variant/);
    expect(() => fileKey("org-1", "file-1", "original.png")).toThrow(/unknown file variant/);
  });

  it("refuses an id that is not one path segment", () => {
    expect(() => fileKey("../org", "file-1", "w256")).toThrow(/organisation id/);
    expect(() => fileKey("org-1", "file/1", "w256")).toThrow(/file id/);
  });
});

describe("configuration", () => {
  it("defaults to disk under REMO_DATA_DIR", () => {
    expect(filesDriver({})).toBe("disk");
    expect(filesDirectory({ REMO_DATA_DIR: "/var/lib/remo" })).toBe("/var/lib/remo/files");
    expect(filesDirectory({ REMO_FILES_DIR: "/srv/files" })).toBe("/srv/files");
  });

  it("refuses an unknown driver", () => {
    expect(() => filesDriver({ REMO_FILES_DRIVER: "ftp" })).toThrow(/REMO_FILES_DRIVER/);
  });

  it("creates the disk driver from the environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "remo-files-store-"));
    directories.push(dir);
    const store = await createFileStore({ REMO_FILES_DRIVER: "disk", REMO_FILES_DIR: dir });
    expect(store.driver).toBe("disk");
    expect(store.root).toBe(dir);
  });

  it("validates every S3 variable before the first upload", async () => {
    await expect(
      createFileStore({ REMO_FILES_DRIVER: "s3", REMO_S3_ENDPOINT: "http://minio:9000" }),
    ).rejects.toMatchObject({ code: "bad_config" });
  });
});
