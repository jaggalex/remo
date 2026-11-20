import { describe, expect, it } from "vitest";
import {
  gridCentres,
  gridExtent,
  gridOriginForCentre,
  imageBox,
  imageTypeOf,
  isImageFile,
  progressQuarter,
  splitFiles,
  unsupportedLabel,
} from "./imageIntake";

/**
 * Where pictures land and which files are taken (`spec/images.md` §9.2).
 *
 * The store itself needs a browser (bitmap decode, object URLs); what can be wrong about a
 * drop is arithmetic and file classification, and both are pure.
 */

const file = (name: string, type = "") => new File([new Uint8Array([1])], name, { type });

describe("which files a drop takes", () => {
  it("accepts the five formats by MIME and by extension", () => {
    expect(isImageFile(file("a.png", "image/png"))).toBe(true);
    expect(isImageFile(file("b.JPG"))).toBe(true);
    expect(isImageFile(file("c.webp"))).toBe(true);
    expect(isImageFile(file("d.gif", "image/gif"))).toBe(true);
    expect(isImageFile(file("e.avif"))).toBe(true);
    expect(imageTypeOf(file("b.JPG"))).toBe("image/jpeg");
  });

  it("refuses SVG, HEIC and a document, and names them", () => {
    const pdf = file("report.pdf", "application/pdf");
    const svg = file("logo.svg", "image/svg+xml");
    const heic = file("photo.heic", "image/heic");
    expect(isImageFile(pdf)).toBe(false);
    expect(isImageFile(svg)).toBe(false);
    expect(isImageFile(heic)).toBe(false);
    expect(unsupportedLabel(pdf)).toBe("PDF");
    expect(unsupportedLabel(svg)).toBe("SVG");
    expect(unsupportedLabel(heic)).toBe("HEIC");
  });

  it("keeps the good files when a batch is mixed", () => {
    const good = file("a.png", "image/png");
    const bad = file("b.pdf", "application/pdf");
    const { supported, rejected } = splitFiles([good, bad]);
    expect(supported).toEqual([good]);
    expect(rejected).toEqual([bad]);
  });
});

describe("the object a picture becomes", () => {
  it("caps the long side at 480 and keeps the proportion", () => {
    expect(imageBox(1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(imageBox(1080, 1920)).toEqual({ width: 270, height: 480 });
  });

  it("never enlarges a small picture", () => {
    expect(imageBox(120, 80)).toEqual({ width: 120, height: 80 });
  });
});

describe("the grid of a batch", () => {
  it("lays four per row with one gap, centring each picture in its cell", () => {
    const boxes = Array.from({ length: 5 }, () => ({ width: 100, height: 100 }));
    const centres = gridCentres(boxes, { x: 0, y: 0 }, 24);
    expect(centres.slice(0, 4)).toEqual([
      { x: 50, y: 50 },
      { x: 174, y: 50 },
      { x: 298, y: 50 },
      { x: 422, y: 50 },
    ]);
    expect(centres[4]).toEqual({ x: 50, y: 174 });
  });

  it("gives a mixed row the tallest picture's height", () => {
    const centres = gridCentres(
      [
        { width: 100, height: 100 },
        { width: 200, height: 50 },
        { width: 100, height: 100 },
      ],
      { x: 0, y: 0 },
      20,
    );
    // Rows are one tall here, so only the columns move: 100 + gap + 200 / 2.
    expect(centres[1]!.x - centres[0]!.x).toBe(170);
    expect(centres[2]!.x - centres[1]!.x).toBe(170);
  });

  it("centres the whole batch on a point for a paste", () => {
    const boxes = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ];
    expect(gridExtent(boxes, 24)).toEqual({ width: 224, height: 100 });
    expect(gridOriginForCentre(boxes, { x: 0, y: 0 }, 24)).toEqual({ x: -112, y: -50 });
  });
});

describe("progress announcements", () => {
  it("moves in quarters, never more often", () => {
    expect([0, 0.1, 0.249, 0.25, 0.6, 0.99, 1].map(progressQuarter)).toEqual([
      0, 0, 0, 1, 2, 3, 4,
    ]);
  });

  it("clamps a wild value instead of announcing nonsense", () => {
    expect(progressQuarter(Number.NaN)).toBe(0);
    expect(progressQuarter(2)).toBe(4);
    expect(progressQuarter(-1)).toBe(0);
  });
});
