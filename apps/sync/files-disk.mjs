/**
 * The `disk` file-store driver (ADR-249, `spec/images.md` §2.1).
 *
 * This is the self-host and development default: a directory under `REMO_DATA_DIR` and no
 * external service. Writes go to a temporary file in the destination directory and are
 * renamed into place, so a crash or a client disconnect never leaves a half-written
 * variant that the read route would serve as a complete image. The temporary name starts
 * with `.tmp-` and `list()` ignores it, which is what lets the garbage collector find and
 * remove the remains of a failed upload.
 */
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FilesError } from "./files-store.mjs";

const TEMP_PREFIX = ".tmp-";

function isMissing(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

export function createDiskFileStore({ dir } = {}) {
  const root = resolve(String(dir ?? ""));
  if (!dir) throw new FilesError("bad_config", "REMO_FILES_DIR is required for the disk driver");

  /** Resolve a key under the root, refusing a key that would escape it. */
  function pathFor(key) {
    const target = resolve(root, String(key ?? ""));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new FilesError("bad_key", "the storage key escapes the file directory");
    }
    return target;
  }

  async function put(key, body, meta = {}) {
    const target = pathFor(key);
    const directory = dirname(target);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `${TEMP_PREFIX}${randomUUID()}`);
    let size = 0;
    try {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
        size = bytes.length;
        await writeFile(temporary, bytes, { flag: "wx" });
      } else if (body && typeof body.pipe === "function") {
        const counter = new Transform({
          transform(chunk, _encoding, done) {
            size += chunk.length;
            done(null, chunk);
          },
        });
        await pipeline(body, counter, createWriteStream(temporary, { flags: "wx" }));
      } else {
        throw new FilesError("bad_type", "put() needs a Buffer or a readable stream");
      }
      await rename(temporary, target);
    } catch (error) {
      // A failed write leaves the temporary file behind; the store's own `list` would
      // hide it, so remove it here instead of waiting for the collector.
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return { key, size, contentType: meta.contentType ?? null };
  }

  async function get(key) {
    const target = pathFor(key);
    try {
      await stat(target);
    } catch (error) {
      if (isMissing(error)) throw new FilesError("not_found", "the file does not exist");
      throw error;
    }
    return createReadStream(target);
  }

  async function head(key) {
    const target = pathFor(key);
    try {
      const info = await stat(target);
      return { size: info.size, contentType: null, etag: null };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function deleteKey(key) {
    const target = pathFor(key);
    try {
      await unlink(target);
    } catch (error) {
      // Deleting an absent key is the state the caller wanted; only a real error throws.
      if (!isMissing(error)) throw error;
    }
  }

  async function list(prefix = "") {
    const base = pathFor(prefix);
    const out = [];

    async function walk(directory) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && !entry.name.startsWith(TEMP_PREFIX)) {
          out.push(relative(root, full).split(sep).join("/"));
        }
      }
    }

    await walk(base);
    return out.sort();
  }

  return { driver: "disk", root, put, get, head, delete: deleteKey, list };
}
