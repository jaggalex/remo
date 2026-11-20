/**
 * The one multipart reader for uploads (ADR-249, `spec/images.md` §4.1).
 *
 * `readJsonBody` cannot be reused: an upload is binary, may be 20 MiB and is not JSON.
 * This reader keeps the same "one mechanism" rule: it owns the ceiling, the boundary
 * parsing and the error codes, and the route above it only maps a code to a status.
 *
 * The body is read as a stream with a hard stop at `maxBytes` plus room for the
 * boundaries and part headers. A `Content-Length` that already exceeds that ceiling is
 * refused before a byte is read, and a stream that lies about its length is still cut
 * off at the same point. Nothing here trusts a part name as a path: the file name is
 * only echoed back to the caller for the originals' download name.
 */

/** Room for boundaries, part headers and the small text fields of one upload. */
const OVERHEAD_BYTES = 64 * 1024;

/** A failure identified by a code so the route can map it to a status and an i18n key. */
export class MultipartError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MultipartError";
    this.code = code;
  }
}

const DISPOSITION = /^content-disposition\s*:/i;

function param(header, name) {
  const match = new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`, "i").exec(header);
  if (match) return match[1];
  // Some clients send an unquoted boundary or file name; accept the simple token form.
  const loose = new RegExp(`(?:^|;)\\s*${name}=([^;]+)`, "i").exec(header);
  return loose ? loose[1].trim() : null;
}

/** The multipart boundary, or `bad_content_type` when this is not a multipart form. */
export function multipartBoundary(contentType) {
  const header = String(contentType ?? "");
  if (!/^multipart\/form-data\b/i.test(header)) {
    throw new MultipartError("bad_content_type", "expected multipart/form-data");
  }
  const boundary = param(header, "boundary");
  if (!boundary || boundary.length > 200) {
    throw new MultipartError("bad_content_type", "the multipart boundary is missing or too long");
  }
  return boundary;
}

/**
 * Split the buffered body into its parts. The parser is deliberately strict: a body
 * without a closing boundary is an error, not a truncated upload that we would store.
 */
function parseParts(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const parts = [];

  if (body.indexOf(delimiter) !== 0) {
    throw new MultipartError("bad_multipart", "the body does not start with the boundary");
  }

  let position = 0;
  for (;;) {
    const after = position + delimiter.length;
    if (body[after] === 0x2d && body[after + 1] === 0x2d) {
      // The closing `--boundary--` (epilogue is ignored).
      return parts;
    }
    if (body[after] !== 0x0d || body[after + 1] !== 0x0a) {
      throw new MultipartError("bad_multipart", "the boundary line is malformed");
    }
    const contentStart = after + 2;
    const headerEnd = body.indexOf("\r\n\r\n", contentStart);
    if (headerEnd < 0) throw new MultipartError("bad_multipart", "a part has no headers");
    const headerBlock = body.toString("utf8", contentStart, headerEnd);
    const next = body.indexOf(separator, headerEnd + 4);
    if (next < 0) throw new MultipartError("bad_multipart", "the body has no closing boundary");
    parts.push({
      headers: headerBlock.split("\r\n"),
      content: body.subarray(headerEnd + 4, next),
    });
    position = next + 2;
  }
}

function partName(headers) {
  const disposition = headers.find((line) => DISPOSITION.test(line));
  return disposition ? param(disposition, "name") : null;
}

function partFile(headers) {
  const disposition = headers.find((line) => DISPOSITION.test(line));
  if (!disposition) return null;
  let filename = param(disposition, "filename");
  if (filename === null) {
    // RFC 5987 form, which some native clients prefer.
    const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (extended) {
      try {
        filename = decodeURIComponent(extended[1]);
      } catch {
        filename = extended[1];
      }
    }
  }
  if (filename === null) return null;
  const type = headers.find((line) => /^content-type\s*:/i.test(line));
  const contentType = type ? type.slice(type.indexOf(":") + 1).trim().split(";")[0] : null;
  return { filename, contentType };
}

/**
 * @returns {Promise<{ fields: Record<string, string>, file: { filename: string, contentType: string|null, buffer: Buffer } | null }>}
 */
export async function readMultipart(request, { maxBytes, maxFieldBytes = 4096 } = {}) {
  const limit = Number(maxBytes);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new MultipartError("too_large", "the upload limit is not configured");
  }
  const boundary = multipartBoundary(request.headers["content-type"]);

  // The declared length covers the whole body, boundaries included, so the ceiling is
  // the file limit plus the fixed overhead. A header beyond even that cannot be honest.
  const declared = Number(request.headers["content-length"]);
  const ceiling = limit + OVERHEAD_BYTES;
  if (Number.isFinite(declared) && declared > ceiling) {
    throw new MultipartError("too_large", "the upload exceeds the size limit");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    // The count is incremented before the check, so a single oversized chunk is caught.
    if (size > ceiling) {
      throw new MultipartError("too_large", "the upload exceeds the size limit");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) throw new MultipartError("bad_multipart", "the body is empty");

  const fields = {};
  let file = null;
  let fileParts = 0;
  for (const part of parseParts(Buffer.concat(chunks), boundary)) {
    const name = partName(part.headers);
    const asFile = partFile(part.headers);
    // Only a part literally named `file` is the upload. Any other part is a small text
    // field; the route may read `alt` or coordinates from it.
    if (name === "file") {
      fileParts += 1;
      if (fileParts > 1) {
        throw new MultipartError("bad_multipart", "the form contains more than one file field");
      }
      if (part.content.length > limit) {
        throw new MultipartError("too_large", "the file exceeds the size limit");
      }
      file = {
        filename: asFile?.filename ?? "",
        contentType: asFile?.contentType ?? null,
        buffer: Buffer.from(part.content),
      };
      continue;
    }
    if (!name) continue;
    if (part.content.length > maxFieldBytes) {
      throw new MultipartError("too_large", `the field ${name} is too large`);
    }
    fields[name] = part.content.toString("utf8");
  }

  if (!file) throw new MultipartError("missing_file", "the form has no file field");
  return { fields, file };
}
