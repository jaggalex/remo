/**
 * Image validation and processing for uploads (ADR-249, `spec/images.md` §4.2).
 *
 * The type is decided by magic bytes, never by `Content-Type` or the file extension: a
 * browser sends whatever the operating system guessed, and a renamed `.png` is a normal
 * way to hand the server a PDF. Only the five formats the product paints are accepted.
 *
 * Processing goes through `sharp` once per required width. Every output is a fresh WebP,
 * so EXIF, GPS, XMP and any ICC profile except the sRGB conversion disappear; the user's
 * original is never served inline. `limitInputPixels` and an explicit width×height check
 * reject a decompression bomb before libvips allocates the bitmap.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { FilesError } from "./files-store.mjs";

export const IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
];

/** Variant names and the width each one asks for (§2.1). */
export const VARIANT_WIDTHS = {
  w256: 256,
  w1024: 1024,
  w2048: 2048,
};

export const DEFAULT_MAX_PIXELS = 50_000_000;
export const DEFAULT_CONCURRENCY = 2;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87 = Buffer.from("GIF87a", "latin1");
const GIF89 = Buffer.from("GIF89a", "latin1");
const PDF = Buffer.from("%PDF-", "latin1");

function startsWith(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

/** ISO-BMFF major brand plus compatible brands; `null` when this is not an ftyp box. */
function isoBrands(buffer) {
  if (buffer.length < 12 || buffer.toString("latin1", 4, 8) !== "ftyp") return null;
  const declared = buffer.readUInt32BE(0);
  const end = Math.min(buffer.length, declared >= 16 ? declared : buffer.length);
  const brands = [buffer.toString("latin1", 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(buffer.toString("latin1", offset, offset + 4));
  }
  return brands;
}

const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function looksLikeSvg(buffer) {
  const start = buffer.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (!start.startsWith("<")) return false;
  return /<svg[\s>]/i.test(start);
}

/**
 * The MIME type from the first bytes, or `bad_type`. The optional name is accepted only so
 * callers can pass the upload's name without this function ever trusting it.
 */
export function detectImageType(buffer, name = "") {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer ?? []);
  // `name` is deliberately not consulted: a JPEG called `photo.png` is a JPEG, and an
  // honest SVG must be refused by its signature rather than let through by a `.png` name.
  void name;
  if (startsWith(buffer, PNG)) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (startsWith(buffer, GIF87) || startsWith(buffer, GIF89)) return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  const brands = isoBrands(buffer);
  if (brands) {
    const major = brands[0];
    if (AVIF_BRANDS.has(major) || brands.some((brand) => AVIF_BRANDS.has(brand))) {
      // An AVIF may use `mif1` as its major brand and name `avif`/`avis` as compatible.
      return "image/avif";
    }
    if (HEIC_BRANDS.has(major) || brands.some((brand) => HEIC_BRANDS.has(brand))) {
      throw new FilesError("bad_type", "HEIC/HEIF is not supported");
    }
    throw new FilesError("bad_type", "unsupported ISO-BMFF image type");
  }

  if (looksLikeSvg(buffer)) throw new FilesError("bad_type", "SVG is not supported");
  if (startsWith(buffer, PDF)) throw new FilesError("bad_type", "PDF is not an image");
  throw new FilesError("bad_type", "the file signature is not a supported image type");
}

/** Refuse a body over the configured limit; the caller reads the stream with the same cap. */
export function assertFileSize(bytes, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isFinite(limit) || limit <= 0) return Number(bytes);
  if (Number(bytes) > limit) throw new FilesError("too_large", "the file exceeds the size limit");
  return Number(bytes);
}

/** Run at most `limit` tasks at once; variant encoding is memory-hungry per slot. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

/** The average colour of an already-small WebP, as `#rrggbb` (§3.1). */
export async function dominantColor(buffer) {
  const { channels } = await sharp(buffer).stats();
  const [red, green, blue] = channels.slice(0, 3).map((channel) => clampByte(channel.mean));
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function asFilesError(error, maxPixels) {
  if (error instanceof FilesError) return error;
  if (/pixel limit/i.test(String(error?.message ?? ""))) {
    return new FilesError("too_many_pixels", `the image exceeds ${maxPixels} pixels`, {
      cause: error,
    });
  }
  return new FilesError("bad_type", "the image cannot be decoded", { cause: error });
}

/**
 * Read the original, apply EXIF orientation and produce the three WebP variants.
 *
 * The result keeps the natural, oriented size: that is what the object's aspect ratio and
 * the "100%" size use. A variant never enlarges the image; when the source is narrower
 * than a step, that step and every larger one reuse the source-width buffer, and the
 * entry reports the size actually written.
 */
export async function processImage(buffer, options = {}) {
  const maxPixels = Number(options.maxPixels) > 0 ? Number(options.maxPixels) : DEFAULT_MAX_PIXELS;
  const concurrency =
    Number(options.concurrency) > 0 ? Math.floor(Number(options.concurrency)) : DEFAULT_CONCURRENCY;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (!bytes.length) throw new FilesError("bad_type", "the upload is empty");
  const mime = detectImageType(bytes);

  let metadata;
  try {
    // `animated: false` is what makes a GIF's first frame the image: by default libvips
    // would stack every page and report the whole strip as one tall picture.
    metadata = await sharp(bytes, { limitInputPixels: maxPixels, animated: false }).metadata();
  } catch (error) {
    throw asFilesError(error, maxPixels);
  }
  if (!metadata?.width || !metadata?.height) {
    throw new FilesError("bad_type", "the image has no dimensions");
  }
  if (metadata.width * metadata.height > maxPixels) {
    throw new FilesError("too_many_pixels", `the image exceeds ${maxPixels} pixels`);
  }

  // Orientations 5–8 rotate by 90°, so the natural width and height swap.
  const orientation = Number(metadata.orientation ?? 1);
  const swapped = orientation >= 5 && orientation <= 8;
  const width = swapped ? metadata.height : metadata.width;
  const height = swapped ? metadata.width : metadata.height;

  // Several steps collapse to one buffer on a small source; render each width once.
  const targets = [...new Set(Object.values(VARIANT_WIDTHS).map((step) => Math.min(step, width)))];
  targets.sort((a, b) => a - b);

  const rendered = new Map();
  const buffers = await mapLimit(targets, concurrency, async (target) => {
    try {
      const { data, info } = await sharp(bytes, { limitInputPixels: maxPixels, animated: false })
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return { target, data, width: info.width, height: info.height };
    } catch (error) {
      throw asFilesError(error, maxPixels);
    }
  });
  for (const entry of buffers) rendered.set(entry.target, entry);

  const variants = {};
  for (const [name, step] of Object.entries(VARIANT_WIDTHS)) {
    const entry = rendered.get(Math.min(step, width));
    variants[name] = {
      w: entry.width,
      h: entry.height,
      bytes: entry.data.length,
      buffer: entry.data,
    };
  }

  const smallest = rendered.get(Math.min(VARIANT_WIDTHS.w256, width));
  return {
    width,
    height,
    variants,
    dominantColor: await dominantColor(smallest.data),
    mime,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}
