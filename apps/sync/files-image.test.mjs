import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  assertFileSize,
  detectImageType,
  processImage,
  VARIANT_WIDTHS,
} from "./files-image.mjs";

function solid(width, height, background = { r: 255, g: 0, b: 0, alpha: 1 }, channels = 3) {
  return sharp({ create: { width, height, channels, background } });
}

function channel(hex, index) {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Two GIF frames spliced into one animation; sharp encodes, the test only joins them. */
async function animatedGif() {
  const frame = (r, g, b) =>
    solid(8, 8, { r, g, b, alpha: 1 }, 4)
      .gif()
      .toBuffer();
  const first = await frame(255, 0, 0);
  const second = await frame(0, 0, 255);
  const imageAt = (buffer) => buffer.indexOf(0x2c, 13);
  return Buffer.concat([
    first.subarray(0, first.length - 1),
    second.subarray(imageAt(second), second.length - 1),
    Buffer.from([0x3b]),
  ]);
}

describe("image signatures", () => {
  it("recognises every supported format by its bytes", async () => {
    const png = await solid(8, 8).png().toBuffer();
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    const webp = await solid(8, 8).webp().toBuffer();
    const gif = await solid(8, 8, { r: 1, g: 2, b: 3, alpha: 1 }, 4).gif().toBuffer();
    const avif = await solid(8, 8).avif().toBuffer();

    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(jpeg)).toBe("image/jpeg");
    expect(detectImageType(webp)).toBe("image/webp");
    expect(detectImageType(gif)).toBe("image/gif");
    expect(detectImageType(avif)).toBe("image/avif");
  });

  it("trusts the bytes when the name says otherwise", async () => {
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    expect(detectImageType(jpeg, "screenshot.png")).toBe("image/jpeg");
  });

  it("refuses SVG, PDF and HEIC even when they look like images", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const pdf = Buffer.from("%PDF-1.7\n%\u00e2\u00e3\n");
    const heic = Buffer.alloc(24);
    heic.writeUInt32BE(20, 0);
    heic.write("ftyp", 4, "latin1");
    heic.write("heic", 8, "latin1");

    for (const buffer of [svg, pdf, heic]) {
      expect(() => detectImageType(buffer)).toThrow(/SVG|PDF|HEIC|supported/);
      try {
        detectImageType(buffer);
      } catch (error) {
        expect(error.code).toBe("bad_type");
        expect(error.status).toBe(415);
      }
    }
  });

  it("reports a size over the limit as too_large", () => {
    expect(() => assertFileSize(2048, 1024)).toThrow(/size limit/);
    try {
      assertFileSize(2048, 1024);
    } catch (error) {
      expect(error.code).toBe("too_large");
      expect(error.status).toBe(413);
    }
    expect(assertFileSize(1024, 1024)).toBe(1024);
    expect(assertFileSize(10_000, null)).toBe(10_000);
  });
});

describe("image processing", () => {
  it("applies EXIF orientation and strips the metadata from every variant", async () => {
    const jpeg = await solid(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);

    const result = await processImage(jpeg);
    expect(result.mime).toBe("image/jpeg");
    expect([result.width, result.height]).toEqual([20, 40]);

    for (const variant of Object.values(result.variants)) {
      const meta = await sharp(variant.buffer).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.orientation).toBeUndefined();
      expect(meta.exif).toBeUndefined();
      expect([variant.w, variant.h]).toEqual([20, 40]);
    }
  });

  it("keeps transparency", async () => {
    const raw = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const offset = (y * 16 + x) * 4;
        raw[offset] = 255;
        raw[offset + 3] = x < 8 ? 255 : 0;
      }
    }
    const png = await sharp(raw, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();

    const result = await processImage(png);
    const meta = await sharp(result.variants.w256.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    const stats = await sharp(result.variants.w256.buffer).stats();
    expect(stats.channels[3].mean).toBeLessThan(255);
  });

  it("never enlarges and reports the size it actually wrote", async () => {
    const png = await solid(100, 50).png().toBuffer();
    const result = await processImage(png);

    expect([result.width, result.height]).toEqual([100, 50]);
    for (const name of Object.keys(VARIANT_WIDTHS)) {
      expect(result.variants[name]).toMatchObject({ w: 100, h: 50 });
    }
    expect(result.variants.w256.buffer.equals(result.variants.w2048.buffer)).toBe(true);
  });

  it("rejects a decompression bomb before decoding it", async () => {
    const png = await solid(100, 100).png().toBuffer();
    await expect(processImage(png, { maxPixels: 1000 })).rejects.toMatchObject({
      code: "too_many_pixels",
      status: 413,
    });
  });

  it("takes the first frame of a GIF", async () => {
    const gif = await animatedGif();
    expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2);

    const result = await processImage(gif);
    expect([result.width, result.height]).toEqual([8, 8]);
  });

  it("computes the dominant colour from the small variant", async () => {
    const png = await solid(32, 32, { r: 250, g: 4, b: 8, alpha: 1 }).png().toBuffer();
    const result = await processImage(png);

    expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(channel(result.dominantColor, 0)).toBeGreaterThan(245);
    expect(channel(result.dominantColor, 1)).toBeLessThan(10);
    expect(channel(result.dominantColor, 2)).toBeLessThan(14);
  });
});
