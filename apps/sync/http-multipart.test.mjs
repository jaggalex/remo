/**
 * The multipart reader for uploads (ADR-249, `spec/images.md` §4.1).
 *
 * The cases below are the ones a route must be able to trust: a real file and its text
 * fields arrive intact, a body without a boundary is refused before parsing, a lying
 * `Content-Length` still hits the ceiling, and a text field cannot grow the buffer.
 */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { multipartBoundary, readMultipart } from "./http-multipart.mjs";

const BOUNDARY = "----remo-test-boundary";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function body(parts) {
  const pieces = [];
  for (const part of parts) {
    pieces.push(Buffer.from(`--${BOUNDARY}\r\n`));
    let disposition = `Content-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) disposition += `; filename="${part.filename}"`;
    pieces.push(Buffer.from(`${disposition}\r\n`));
    if (part.contentType) pieces.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    pieces.push(Buffer.from("\r\n"));
    pieces.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body));
    pieces.push(Buffer.from("\r\n"));
  }
  pieces.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(pieces);
}

/** A request-shaped async iterable with the two headers the reader consults. */
function requestOf(chunks, headers = {}) {
  const stream = Readable.from(chunks);
  stream.headers = {
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
    ...headers,
  };
  return stream;
}

describe("multipart boundary", () => {
  it("is read from the Content-Type header, quoted or not", () => {
    expect(multipartBoundary(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(BOUNDARY);
    expect(multipartBoundary('multipart/form-data; boundary="a=b"')).toBe("a=b");
  });

  it("refuses a request without a boundary", () => {
    expect(() => multipartBoundary("multipart/form-data")).toThrow(
      expect.objectContaining({ code: "bad_content_type" }),
    );
    expect(() => multipartBoundary("application/json")).toThrow(
      expect.objectContaining({ code: "bad_content_type" }),
    );
  });
});

describe("readMultipart", () => {
  it("returns the file and the text fields of a valid upload", async () => {
    const parsed = await readMultipart(
      requestOf([
        body([
          { name: "alt", body: "a screenshot" },
          { name: "file", filename: "shot.png", contentType: "image/png", body: PNG },
        ]),
      ]),
      { maxBytes: 1024 * 1024 },
    );
    expect(parsed.fields).toEqual({ alt: "a screenshot" });
    expect(parsed.file).toMatchObject({ filename: "shot.png", contentType: "image/png" });
    expect(parsed.file.buffer.equals(PNG)).toBe(true);
  });

  it("accepts exactly one file among several fields", async () => {
    const parsed = await readMultipart(
      requestOf([
        body([
          { name: "x", body: "10" },
          { name: "y", body: "20" },
          { name: "file", filename: "a.png", contentType: "image/png", body: PNG },
        ]),
      ]),
      { maxBytes: 4096, maxFieldBytes: 32 },
    );
    expect(parsed.fields).toEqual({ x: "10", y: "20" });
    expect(parsed.file.filename).toBe("a.png");
  });

  it("refuses a second file field instead of choosing one", async () => {
    await expect(
      readMultipart(
        requestOf([
          body([
            { name: "file", filename: "a.png", contentType: "image/png", body: PNG },
            { name: "file", filename: "b.png", contentType: "image/png", body: PNG },
          ]),
        ]),
        { maxBytes: 4096 },
      ),
    ).rejects.toMatchObject({ code: "bad_multipart" });
  });

  it("needs a file field", async () => {
    await expect(
      readMultipart(requestOf([body([{ name: "alt", body: "nothing" }])]), { maxBytes: 4096 }),
    ).rejects.toMatchObject({ code: "missing_file" });
  });

  it("stops a body that lies about Content-Length", async () => {
    const large = body([
      { name: "file", filename: "big.png", contentType: "image/png", body: Buffer.alloc(200 * 1024) },
    ]);
    const stream = requestOf([large.subarray(0, 256), large.subarray(256)], {
      "content-length": "10",
    });
    await expect(readMultipart(stream, { maxBytes: 1024 })).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("refuses a declared Content-Length over the ceiling before reading", async () => {
    const stream = requestOf([body([{ name: "file", filename: "a.png", body: PNG }])], {
      "content-length": String(64 * 1024 * 1024),
    });
    await expect(readMultipart(stream, { maxBytes: 1024 * 1024 })).rejects.toMatchObject({
      code: "too_large",
    });
    // Nothing was consumed: the first chunk is still there for whoever owns the stream.
    expect(stream.readableEnded).toBe(false);
  });

  it("refuses a text field larger than its own limit", async () => {
    await expect(
      readMultipart(
        requestOf([
          body([
            { name: "alt", body: "x".repeat(64) },
            { name: "file", filename: "a.png", contentType: "image/png", body: PNG },
          ]),
        ]),
        { maxBytes: 4096, maxFieldBytes: 16 },
      ),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses a body that is not closed with the boundary", async () => {
    const truncated = body([{ name: "file", filename: "a.png", body: PNG }]).subarray(
      0,
      body([{ name: "file", filename: "a.png", body: PNG }]).length - 8,
    );
    await expect(
      readMultipart(requestOf([truncated]), { maxBytes: 4096 }),
    ).rejects.toMatchObject({ code: "bad_multipart" });
  });
});
