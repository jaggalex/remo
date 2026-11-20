import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createS3FileStore,
  S3_PART_BYTES,
  s3ClientOptions,
  s3ConfigFromEnv,
} from "./files-s3.mjs";

function notFound() {
  return Object.assign(new Error("NoSuchKey"), {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 },
  });
}

/**
 * The S3 contract without a network: the real command classes are sent to a fake client,
 * so the test proves the driver's own request shape, not the SDK's transport.
 */
class FakeS3 {
  constructor({ listPages = [] } = {}) {
    this.calls = [];
    this.objects = new Map();
    this.listPages = [...listPages];
    this.upload = null;
    this.completed = null;
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    this.calls.push({ name, input });

    if (name === "PutObjectCommand") {
      this.objects.set(input.Key, Buffer.from(input.Body));
      return { ETag: '"etag"' };
    }
    if (name === "CreateMultipartUploadCommand") {
      this.upload = { key: input.Key, uploadId: "upload-1", contentType: input.ContentType };
      return { UploadId: this.upload.uploadId };
    }
    if (name === "UploadPartCommand") {
      this.upload ??= { key: input.Key, uploadId: input.UploadId };
      this.upload.parts ??= [];
      this.upload.parts.push({ partNumber: input.PartNumber, body: Buffer.from(input.Body) });
      return { ETag: `"part-${input.PartNumber}"` };
    }
    if (name === "CompleteMultipartUploadCommand") {
      this.completed = input.MultipartUpload.Parts;
      this.objects.set(input.Key, Buffer.concat((this.upload.parts ?? []).map((part) => part.body)));
      return { ETag: '"multipart"' };
    }
    if (name === "AbortMultipartUploadCommand") {
      this.aborted = input.UploadId;
      return {};
    }
    if (name === "GetObjectCommand") {
      const body = this.objects.get(input.Key);
      if (!body) throw notFound();
      return { Body: Readable.from([body]) };
    }
    if (name === "HeadObjectCommand") {
      const body = this.objects.get(input.Key);
      if (!body) throw notFound();
      return { ContentLength: body.length, ContentType: "image/webp", ETag: '"etag"' };
    }
    if (name === "DeleteObjectCommand") {
      this.objects.delete(input.Key);
      return {};
    }
    if (name === "ListObjectsV2Command") {
      const page = this.listPages.shift() ?? { Contents: [], IsTruncated: false };
      return page;
    }
    throw new Error(`unexpected command ${name}`);
  }
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const key = "orgs/org-1/files/file-1/w256";

describe("the S3 file store", () => {
  it("puts a buffer as a private object with its content type", async () => {
    const client = new FakeS3();
    const store = createS3FileStore({ client, bucket: "remo-files" });

    const written = await store.put(key, Buffer.from("webp"), { contentType: "image/webp" });
    expect(written).toMatchObject({ key, size: 4, contentType: "image/webp" });

    const call = client.calls.find((entry) => entry.name === "PutObjectCommand");
    expect(call.input).toMatchObject({
      Bucket: "remo-files",
      Key: key,
      ContentType: "image/webp",
      ContentLength: 4,
    });
    expect(call.input.ACL).toBeUndefined();
  });

  it("reads, heads, deletes and lists objects", async () => {
    const client = new FakeS3({
      listPages: [
        { Contents: [{ Key: key }], IsTruncated: true, NextContinuationToken: "next" },
        { Contents: [{ Key: `${key}-2` }], IsTruncated: false },
      ],
    });
    const store = createS3FileStore({ client, bucket: "remo-files" });
    client.objects.set(key, Buffer.from("webp"));

    expect(await readAll(await store.get(key))).toEqual(Buffer.from("webp"));
    expect(await store.head(key)).toMatchObject({ size: 4, contentType: "image/webp" });
    expect(await store.list("orgs/org-1/")).toEqual([key, `${key}-2`]);

    await store.delete(key);
    expect(client.objects.has(key)).toBe(false);
    expect(await store.head(key)).toBeNull();
    await expect(store.get(key)).rejects.toMatchObject({ code: "not_found" });
  });

  it("uploads a large stream with multipart parts", async () => {
    const client = new FakeS3();
    const store = createS3FileStore({ client, bucket: "remo-files", partSize: 4 });

    const written = await store.put(key, Readable.from([Buffer.from("abcdefgh")]));
    expect(written.size).toBe(8);

    expect(client.upload.parts.map((part) => [part.partNumber, part.body.toString()])).toEqual([
      [1, "abcd"],
      [2, "efgh"],
    ]);
    expect(client.completed.map((part) => part.PartNumber)).toEqual([1, 2]);
    expect(client.objects.get(key).toString()).toBe("abcdefgh");
  });

  it("keeps a stream smaller than one part as a single put", async () => {
    const client = new FakeS3();
    const store = createS3FileStore({ client, bucket: "remo-files", partSize: S3_PART_BYTES });

    await store.put(key, Readable.from([Buffer.from("abc")]));
    expect(client.calls.map((entry) => entry.name)).toEqual(["PutObjectCommand"]);
  });

  it("uses path-style addressing for MinIO when asked", () => {
    const config = s3ConfigFromEnv({
      REMO_S3_ENDPOINT: "http://minio:9000",
      REMO_S3_BUCKET: "remo-files",
      REMO_S3_ACCESS_KEY_ID: "key",
      REMO_S3_SECRET_ACCESS_KEY: "secret",
      REMO_S3_FORCE_PATH_STYLE: "1",
    });
    expect(config.region).toBe("us-east-1");
    expect(s3ClientOptions(config)).toMatchObject({
      endpoint: "http://minio:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "key", secretAccessKey: "secret" },
    });
  });

  it("names the missing variable instead of failing on the first upload", () => {
    expect(() => s3ConfigFromEnv({ REMO_S3_ENDPOINT: "http://minio:9000" })).toThrow(
      /REMO_S3_BUCKET/,
    );
  });
});
