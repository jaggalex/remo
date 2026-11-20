import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createDiskFileStore } from "./files-disk.mjs";
import { fileKey } from "./files-store.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "remo-files-disk-"));
  directories.push(dir);
  return { dir, store: createDiskFileStore({ dir }) };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Every file under the store, including a temporary file a failed write left behind. */
async function everyFile(dir) {
  const out = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

describe("the disk file store", () => {
  it("puts, heads, reads, lists and deletes one key", async () => {
    const { dir, store } = await tempStore();
    const key = fileKey("org-1", "file-1", "w256");
    const body = Buffer.from("hello webp");

    const written = await store.put(key, body, { contentType: "image/webp" });
    expect(written).toMatchObject({ key, size: body.length });

    expect(await store.head(key)).toMatchObject({ size: body.length });
    expect(await readAll(await store.get(key))).toEqual(body);
    expect(await store.list("orgs/org-1/files/")).toEqual([key]);

    await store.delete(key);
    expect(await store.head(key)).toBeNull();
    await expect(store.get(key)).rejects.toMatchObject({ code: "not_found" });
    expect(await store.list("orgs/org-1/files/")).toEqual([]);
    expect(await everyFile(dir)).toEqual([]);
  });

  it("writes a stream through a temporary file and leaves none behind", async () => {
    const { dir, store } = await tempStore();
    const key = fileKey("org-1", "file-2", "original");
    const chunks = [Buffer.from("one "), Buffer.from("two"), Buffer.from(" three")];

    const written = await store.put(key, Readable.from(chunks));
    expect(written.size).toBe(Buffer.concat(chunks).length);
    expect(await readAll(await store.get(key))).toEqual(Buffer.concat(chunks));

    const names = (await everyFile(dir)).map((path) => path.split("/").pop());
    expect(names.some((name) => name.startsWith(".tmp-"))).toBe(false);
  });

  it("removes the temporary file when the stream fails", async () => {
    const { dir, store } = await tempStore();
    async function* broken() {
      yield Buffer.from("partial");
      throw new Error("client disconnected");
    }

    await expect(store.put(fileKey("org-1", "file-3", "original"), Readable.from(broken()))).rejects.toThrow(
      "client disconnected",
    );
    expect(await everyFile(dir)).toEqual([]);
    expect(await store.list("orgs/org-1/files/")).toEqual([]);
  });

  it("refuses a key that escapes the store directory", async () => {
    const { store } = await tempStore();
    await expect(store.get("../../etc/passwd")).rejects.toMatchObject({ code: "bad_key" });
    await expect(store.put("../escape", Buffer.from("x"))).rejects.toMatchObject({ code: "bad_key" });
  });
});
