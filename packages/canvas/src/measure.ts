/**
 * One off-screen 1×1 canvas for text measurement.
 *
 * The painter measures with the real context; the editor, the fitter and the badge need a
 * context before a canvas is mounted. One module owns the scratch canvas so a second
 * measuring context cannot drift from the first.
 */
let scratch: CanvasRenderingContext2D | null = null;

export function measureContext(): CanvasRenderingContext2D | null {
  if (scratch) return scratch;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  scratch = canvas.getContext("2d");
  return scratch;
}
