/**
 * The one file store for uploaded images (ADR-249, `spec/images.md` §2).
 *
 * Bytes live outside the room document and outside PostgreSQL: either in a directory
 * (`disk`, the default for a self-host that has no object storage) or in an S3-compatible
 * bucket. Both drivers implement one small interface, so the upload pipeline never learns
 * which one is configured.
 *
 * Keys are built only from ids: `orgs/{orgId}/files/{fileId}/{variant}`. A user's file
 * name never reaches the store, and the route layer never concatenates a path fragment
 * from a request. That also means a key cannot escape the store root.
 *
 * `createFileStore` is async because the S3 driver (and its SDK) is loaded only when it is
 * actually configured; the default disk installation does not pay for it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FILES_DRIVERS = ["disk", "s3"];

/** The variants the pipeline writes and the read route serves (§2.1, §4.2). */
export const FILE_VARIANTS = ["original", "w256", "w1024", "w2048"];

/** HTTP status for a failure the upload route translates directly (§4.1). */
export const FILES_ERROR_STATUS = {
  too_large: 413,
  bad_type: 415,
  too_many_pixels: 413,
  busy: 503,
  not_found: 404,
  bad_key: 500,
  bad_config: 500,
};

/**
 * A storage failure identified by a code, not a prose message: the route maps the code to
 * a status and an i18n key, and the metrics label is the code (§8). `message` is for
 * operators and never contains a file name or a key.
 */
export class FilesError extends Error {
  constructor(code, message = code, { cause, status } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FilesError";
    this.code = code;
    this.status = status ?? FILES_ERROR_STATUS[code] ?? 500;
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The only place a storage key is built. `variant` comes from the route's allow-list and
 * the ids are UUID-shaped; anything else is refused rather than normalised.
 */
export function fileKey(orgId, fileId, variant) {
  if (!ID.test(String(orgId ?? ""))) {
    throw new FilesError("bad_key", "the organisation id is not a storage key segment");
  }
  if (!ID.test(String(fileId ?? ""))) {
    throw new FilesError("bad_key", "the file id is not a storage key segment");
  }
  if (!FILE_VARIANTS.includes(variant)) {
    throw new FilesError("bad_key", `unknown file variant ${JSON.stringify(variant)}`);
  }
  return `orgs/${orgId}/files/${fileId}/${variant}`;
}

/** The default data directory mirrors `server.mjs` so disk and the service agree. */
const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), ".data");

export function filesDirectory(env = process.env) {
  const explicit = String(env.REMO_FILES_DIR ?? "").trim();
  if (explicit) return explicit;
  const dataDir = String(env.REMO_DATA_DIR ?? "").trim() || DEFAULT_DATA_DIR;
  return join(dataDir, "files");
}

/** The configured driver, refused when it is not one of the two documented names. */
export function filesDriver(env = process.env) {
  const driver = String(env.REMO_FILES_DRIVER ?? "disk").trim().toLowerCase();
  if (!FILES_DRIVERS.includes(driver)) {
    throw new FilesError(
      "bad_config",
      `REMO_FILES_DRIVER must be one of ${FILES_DRIVERS.join(", ")}`,
    );
  }
  return driver;
}

/**
 * Build the configured store. Config errors reject here, before the service accepts a
 * request; an S3 installation with a missing bucket or key must not start and then fail
 * every upload.
 *
 * The bucket probe (`HeadBucket` and the anonymous `.remo-probe` read, §2.2) needs the
 * network and is deliberately left to the deployment slice: this one validates the
 * configuration and every driver call reports its own failure.
 */
export async function createFileStore(env = process.env) {
  const driver = filesDriver(env);
  if (driver === "s3") {
    const { createS3FileStoreFromEnv } = await import("./files-s3.mjs");
    return createS3FileStoreFromEnv(env);
  }
  const { createDiskFileStore } = await import("./files-disk.mjs");
  return createDiskFileStore({ dir: filesDirectory(env) });
}
