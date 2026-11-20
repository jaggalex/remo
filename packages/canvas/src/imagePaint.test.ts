import { describe, expect, it } from "vitest";
import {
  imageFieldsOf,
  imageFit,
  imageVariantFallbacks,
  imageVariantFor,
  imageVariantForWidget,
  paintImage,
} from "./imagePaint";
import { DEFAULT_PALETTE } from "./palette";
import type { Widget } from "@remo/model";

/** A 2D context stand-in that records what the painter asked for. */
function fakeContext() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const fillStyles: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => {
        calls.push({ method: String(key), args });
        return undefined;
      };
    },
    set(target, key, value) {
      if (key === "fillStyle" && typeof value === "string") fillStyles.push(value);
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state, fillStyles };
}

const bitmap = { width: 400, height: 200, close: () => {} } as unknown as ImageBitmap;

describe("variant by on-screen size (ADR-249, §6)", () => {
  it("picks the smallest variant up to 256 device pixels", () => {
    expect(imageVariantFor(256, 100)).toBe("w256");
    expect(imageVariantFor(100, 256)).toBe("w256");
  });

  it("moves up at the boundaries", () => {
    expect(imageVariantFor(257, 100)).toBe("w1024");
    expect(imageVariantFor(1024, 100)).toBe("w1024");
    expect(imageVariantFor(1025, 100)).toBe("w2048");
  });

  it("counts the device pixel ratio, so a retina screen gets the sharper file", () => {
    expect(imageVariantFor(200, 200, 1)).toBe("w256");
    expect(imageVariantFor(200, 200, 2)).toBe("w1024");
    expect(imageVariantFor(600, 600, 2)).toBe("w2048");
  });

  it("reads a widget's size through the camera zoom", () => {
    const widget = { x: 0, y: 0, width: 200, height: 100 } as Widget;
    expect(imageVariantForWidget(widget, 1)).toBe("w256");
    expect(imageVariantForWidget(widget, 2)).toBe("w1024");
    expect(imageVariantForWidget(widget, 6)).toBe("w2048");
  });

  it("falls back to a decoded neighbour before showing the placeholder", () => {
    expect(imageVariantFallbacks("w1024")[0]).toBe("w1024");
    // A sharper file is usable in a smaller box…
    expect(imageVariantFallbacks("w256")).toEqual(["w256", "w1024", "w2048"]);
    // …and a smaller one beats a colour plate while the sharper one loads.
    expect(imageVariantFallbacks("w2048")).toEqual(["w2048", "w1024", "w256"]);
  });
});

describe("fitting without stretching (ADR-249)", () => {
  it("contains a square picture in a wide box", () => {
    expect(imageFit({ x: 0, y: 0, width: 200, height: 100 }, 400, 400)).toEqual({
      x: 50,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("contains a wide picture in a tall box", () => {
    expect(imageFit({ x: 10, y: 20, width: 200, height: 200 }, 800, 200)).toEqual({
      x: 10,
      y: 95,
      width: 200,
      height: 50,
    });
  });

  it("leaves the box alone when the natural size is unknown", () => {
    const box = { x: 1, y: 2, width: 30, height: 40 };
    expect(imageFit(box, 0, 0)).toEqual(box);
  });
});

describe("painting the three states (ADR-249, §9.6)", () => {
  const box = { x: 0, y: 0, width: 300, height: 200 };

  it("draws the bitmap, fitted, inside the object", () => {
    const { ctx, calls } = fakeContext();
    paintImage(ctx, box, 1, {
      bitmap,
      palette: DEFAULT_PALETTE,
      fontFamily: "Inter",
      unavailableLabel: "Image unavailable",
    });
    const draw = calls.find((call) => call.method === "drawImage");
    expect(draw).toBeDefined();
    // 400×200 in a 300×200 box: 300×150, centred vertically.
    expect(draw!.args.slice(1)).toEqual([0, 25, 300, 150]);
  });

  it("fills the loading placeholder with the dominant colour and draws a glyph", () => {
    const { ctx, calls, fillStyles } = fakeContext();
    paintImage(ctx, box, 1, {
      bitmap: null,
      dominantColor: "#123456",
      palette: DEFAULT_PALETTE,
      fontFamily: "Inter",
    });
    expect(fillStyles[0]).toBe("#123456");
    expect(calls.some((call) => call.method === "arc")).toBe(true);
    expect(calls.some((call) => call.method === "fillText")).toBe(false);
  });

  it("refuses a dominant colour that is not a hex value", () => {
    const { ctx, fillStyles } = fakeContext();
    paintImage(ctx, box, 1, {
      bitmap: null,
      dominantColor: "url(javascript:alert(1))",
      palette: DEFAULT_PALETTE,
      fontFamily: "Inter",
    });
    expect(fillStyles[0]).toBe(DEFAULT_PALETTE.hover);
  });

  it("says the picture is unavailable when there is room for the sentence", () => {
    const { ctx, calls } = fakeContext();
    paintImage(ctx, box, 1, {
      bitmap: null,
      unavailable: true,
      palette: DEFAULT_PALETTE,
      fontFamily: "Inter",
      unavailableLabel: "Image unavailable",
    });
    const text = calls.find((call) => call.method === "fillText");
    expect(text?.args[0]).toBe("Image unavailable");
  });

  it("keeps only the crossed glyph when the object is small", () => {
    const { ctx, calls } = fakeContext();
    paintImage(ctx, { x: 0, y: 0, width: 80, height: 60 }, 1, {
      bitmap: null,
      unavailable: true,
      palette: DEFAULT_PALETTE,
      fontFamily: "Inter",
      unavailableLabel: "Image unavailable",
    });
    expect(calls.some((call) => call.method === "fillText")).toBe(false);
  });
});

describe("image fields (ADR-249, §3.2)", () => {
  it("reads the flat fields and drops nonsense", () => {
    const widget = {
      id: "i1",
      type: "image",
      parentId: null,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fileId: "f1",
      naturalWidth: 800,
      naturalHeight: -1,
      dominantColor: "#abcdef",
      alt: "A diagram",
    } as unknown as Widget;
    expect(imageFieldsOf(widget)).toEqual({
      fileId: "f1",
      naturalWidth: 800,
      naturalHeight: undefined,
      dominantColor: "#abcdef",
      alt: "A diagram",
    });
  });

  it("returns nothing for a widget that is not a picture", () => {
    const widget = {
      id: "n1",
      type: "sticky_note",
      parentId: null,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as Widget;
    expect(imageFieldsOf(widget)).toEqual({
      fileId: undefined,
      naturalWidth: undefined,
      naturalHeight: undefined,
      dominantColor: undefined,
      alt: undefined,
    });
  });
});
