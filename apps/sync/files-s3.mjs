/**
 * The `s3` file-store driver: any S3-compatible service, MinIO included
 * (ADR-249, `spec/images.md` §2.1–§2.2).
 *
 * The bucket is private and the driver never asks for a public ACL or a signed URL: the
 * browser only ever reads through `/files/...`, where the room access check runs. MinIO
 * needs path-style addressing and a region name (any value); Yandex Object Storage and
 * friends use virtual-hosted addressing. That is a client option, not a per-request one.
 *
 * Large originals are streamed with multipart upload from 8 MiB. A buffer (every WebP
 * variant) goes in one `PutObject`, because it is already in memory and below the
 * single-request ceiling.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { FilesError } from "./files-store.mjs";

/** The S3 minimum part size is 5 MiB; the spec picks 8 MiB for a comfortable margin. */
export const S3_PART_BYTES = 8 * 1024 * 1024;

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const TRUE = new Set(["1", "true", "yes", "on"]);

function missing(name) {
  return new FilesError("bad_config", `${name} is required for REMO_FILES_DRIVER=s3`);
}

/** Validate every S3 variable once, before the service starts accepting uploads. */
export function s3ConfigFromEnv(env = process.env) {
  const endpoint = String(env.REMO_S3_ENDPOINT ?? "").trim();
  if (!endpoint) throw missing("REMO_S3_ENDPOINT");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new FilesError("bad_config", "REMO_S3_ENDPOINT is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FilesError("bad_config", "REMO_S3_ENDPOINT must use http:// or https://");
  }
  if (url.username || url.password) {
    throw new FilesError("bad_config", "REMO_S3_ENDPOINT must not contain credentials");
  }

  const bucket = String(env.REMO_S3_BUCKET ?? "").trim();
  if (!bucket) throw missing("REMO_S3_BUCKET");
  if (!BUCKET.test(bucket)) {
    throw new FilesError("bad_config", "REMO_S3_BUCKET is not a valid bucket name");
  }

  const accessKeyId = String(env.REMO_S3_ACCESS_KEY_ID ?? "").trim();
  if (!accessKeyId) throw missing("REMO_S3_ACCESS_KEY_ID");
  const secretAccessKey = String(env.REMO_S3_SECRET_ACCESS_KEY ?? "").trim();
  if (!secretAccessKey) throw missing("REMO_S3_SECRET_ACCESS_KEY");

  return {
    endpoint,
    bucket,
    region: String(env.REMO_S3_REGION ?? "").trim() || "us-east-1",
    forcePathStyle: TRUE.has(String(env.REMO_S3_FORCE_PATH_STYLE ?? "").toLowerCase()),
    accessKeyId,
    secretAccessKey,
  };
}

/** The client options, separated so a test can assert path-style without a network. */
export function s3ClientOptions(config) {
  return {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
}

function isNotFound(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === "NoSuchKey" ||
    error?.name === "NotFound"
  );
}

function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

/**
 * Split a stream into S3 parts. The accumulator only concatenates when a full part is
 * available, so a 20 MiB original made of small socket chunks is not repeatedly copied.
 */
async function* parts(stream, size) {
  let pending = [];
  let length = 0;
  for await (const chunk of stream) {
    const buffer = toBuffer(chunk);
    pending.push(buffer);
    length += buffer.length;
    if (length < size) continue;
    const all = Buffer.concat(pending);
    pending = [];
    length = 0;
    let offset = 0;
    while (all.length - offset >= size) {
      yield all.subarray(offset, offset + size);
      offset += size;
    }
    if (offset < all.length) {
      const rest = all.subarray(offset);
      pending = [rest];
      length = rest.length;
    }
  }
  if (length) yield Buffer.concat(pending);
}

export function createS3FileStore({ client, bucket, partSize = S3_PART_BYTES } = {}) {
  if (!client || typeof client.send !== "function") {
    throw new FilesError("bad_config", "the s3 driver needs an S3 client");
  }
  if (!BUCKET.test(String(bucket ?? ""))) {
    throw new FilesError("bad_config", "REMO_S3_BUCKET is not a valid bucket name");
  }

  async function putBuffer(key, bytes, contentType) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
        // No ACL: the bucket policy keeps every object private, and a per-object ACL
        // would be a second, weaker place to decide who reads it.
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
    return { key, size: bytes.length, contentType: contentType ?? null };
  }

  async function multipart(key, stream, contentType) {
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
    const uploadId = created?.UploadId;
    if (!uploadId) throw new Error("s3 did not return a multipart upload id");

    let size = 0;
    let partNumber = 1;
    const uploaded = [];
    try {
      for await (const part of parts(stream, partSize)) {
        const response = await client.send(
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: part,
            ContentLength: part.length,
          }),
        );
        uploaded.push({ ETag: response?.ETag, PartNumber: partNumber });
        size += part.length;
        partNumber += 1;
      }
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: uploaded },
        }),
      );
    } catch (error) {
      // An abandoned multipart upload keeps billing for its parts until a lifecycle
      // rule removes it, so the driver aborts its own attempt immediately.
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
        .catch(() => {});
      throw error;
    }
    return { key, size, contentType: contentType ?? null };
  }

  async function upload(key, stream, contentType) {
    // One read-ahead part tells a small stream apart from a large one without buffering
    // the whole body: the first part is either the only part or the first of many.
    const iterator = parts(stream, partSize);
    const first = await iterator.next();
    if (first.done) return putBuffer(key, Buffer.alloc(0), contentType);
    const second = await iterator.next();
    if (second.done) return putBuffer(key, first.value, contentType);

    async function* replay() {
      yield first.value;
      yield second.value;
      yield* iterator;
    }
    return multipart(key, replay(), contentType);
  }

  async function put(key, body, meta = {}) {
    const contentType = meta.contentType ?? null;
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      return putBuffer(key, bytes, contentType);
    }
    if (body && typeof body.pipe === "function") {
      return upload(key, body, contentType);
    }
    throw new FilesError("bad_type", "put() needs a Buffer or a readable stream");
  }

  async function get(key) {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response?.Body) throw new FilesError("not_found", "the object has no body");
      return response.Body;
    } catch (error) {
      if (isNotFound(error)) throw new FilesError("not_found", "the object does not exist");
      throw error;
    }
  }

  async function head(key) {
    try {
      const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        size: Number(response?.ContentLength ?? 0),
        contentType: response?.ContentType ?? null,
        etag: response?.ETag ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function deleteKey(key) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async function list(prefix = "") {
    const keys = [];
    let token;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const item of response?.Contents ?? []) {
        if (item?.Key) keys.push(item.Key);
      }
      token = response?.IsTruncated ? response.NextContinuationToken : undefined;
      if (response?.IsTruncated && !token) {
        throw new Error("s3 listed a truncated page without a continuation token");
      }
    } while (token);
    return keys.sort();
  }

  return { driver: "s3", bucket, put, get, head, delete: deleteKey, list };
}

/** Build the production store from the environment, validating every variable first. */
export function createS3FileStoreFromEnv(env = process.env) {
  const config = s3ConfigFromEnv(env);
  const client = new S3Client(s3ClientOptions(config));
  return createS3FileStore({ client, bucket: config.bucket });
}
