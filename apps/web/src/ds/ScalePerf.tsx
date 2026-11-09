import { useEffect, useRef, useState } from "react";
import { DEFAULT_FONT_FAMILY, boxOf, drawWidget, visibleWorldRect } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { canvasPaletteFromTokens } from "../canvasPalette";
import { DEFAULT_INK } from "../objectDefaults";

/**
 * A 10 000-object paint baseline (review P6).
 *
 * The connector harness measures 60/120 objects; this one measures the size the product
 * says it supports. It paints the real painter into a real canvas, moves the viewport
 * every frame (a pan), and reports the average and worst frame. It is a measurement, not
 * a product screen. The e2e gate reads `window.__scalePerf`.
 */
const NOTES = 7000;
const SHAPES = 2500;
const CONNECTORS = 500;
const TOTAL = NOTES + SHAPES + CONNECTORS;

function scene(): Widget[] {
  const widgets: Widget[] = [];
  const columns = 100;
  for (let index = 0; index < NOTES + SHAPES; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const note = index < NOTES;
    widgets.push({
      id: `${note ? "n" : "s"}${index}`,
      type: note ? "sticky_note" : "shape",
      parentId: null,
      x: column * 60,
      y: row * 60,
      width: note ? 44 : 36,
      height: note ? 38 : 30,
      ...(note
        ? { content: `Note ${index % 100}`, style: { fillColor: "yellow" } }
        : { shapeKind: "round_rectangle", style: { fillColor: "blue" } }),
    } as Widget);
  }
  for (let index = 0; index < CONNECTORS; index += 1) {
    const from = widgets[index % NOTES]!;
    const to = widgets[(index * 7 + 13) % NOTES]!;
    widgets.push({
      id: `c${index}`,
      type: "connector",
      parentId: null,
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      width: Math.abs(from.x - to.x),
      height: Math.abs(from.y - to.y),
      start: { item: from.id, side: "right" },
      end: { item: to.id, side: "left" },
      arrow: "end",
      routing: "elbow",
      style: { strokeColor: DEFAULT_INK, strokeWidth: 1.5 },
    });
  }
  return widgets;
}

export function ScalePerf() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<{
    average: number;
    worst: number;
    objects: number;
    visible: number;
  } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const widgets = scene();
    const resolve = (id: string) => widgets.find((widget) => widget.id === id);
    const palette = canvasPaletteFromTokens();
    const theme = {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontCap: { S: 13, M: 16, L: 20 },
      shapeStrokeWidth: 1,
      cardPlaceholder: "Type something",
      timerExpired: "Time is up",
      cardStatus: { todo: "To do", in_progress: "In progress", done: "Done" },
      palette,
    };
    const frames: number[] = [];
    const visibleCounts: number[] = [];
    /** The first frames pay JIT and font loading, not the steady-state paint. */
    const WARMUP = 15;
    const MEASURED = 60;
    let frame = 0;
    let raf = 0;

    const paint = () => {
      const started = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = palette.canvas;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // The product culls to the viewport; measuring all 10 000 every frame would be a
      // different, much worse benchmark than the one the board actually runs.
      const zoom = 0.4;
      const camera = { x: 40 + frame * 2, y: 40 + frame, zoom };
      const visible = visibleWorldRect(camera, { width: canvas.width, height: canvas.height });
      ctx.save();
      ctx.scale(zoom, zoom);
      ctx.translate(-camera.x, -camera.y);
      let painted = 0;
      for (const widget of widgets) {
        const box = boxOf(widget);
        if (
          box.x > visible.x + visible.width ||
          box.x + box.width < visible.x ||
          box.y > visible.y + visible.height ||
          box.y + box.height < visible.y
        ) {
          continue;
        }
        painted += 1;
        drawWidget(ctx, widget, zoom, { resolve, theme });
      }
      ctx.restore();
      const ended = performance.now();
      frames.push(ended - started);
      visibleCounts.push(painted);
      frame += 1;
      if (frame < WARMUP + MEASURED) raf = requestAnimationFrame(paint);
      else {
        // The budget is steady-state paint, not the cold first frames.
        const steady = frames.slice(WARMUP);
        const steadyVisible = visibleCounts.slice(WARMUP);
        const average = steady.reduce((sum, value) => sum + value, 0) / steady.length;
        const worst = Math.max(...steady);
        const visible = Math.round(
          steadyVisible.reduce((sum, value) => sum + value, 0) / steadyVisible.length,
        );
        const measured = {
          average: Math.round(average * 10) / 10,
          worst: Math.round(worst * 10) / 10,
          objects: TOTAL,
          visible,
        };
        (window as unknown as Record<string, unknown>).__scalePerf = measured;
        setResult(measured);
      }
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="ds-perf">
      <canvas ref={ref} width={760} height={620} className="ds-perf-canvas" />
      {result && (
        <p className="ds-note">
          average {result.average} ms · worst {result.worst} ms · {result.visible} of{" "}
          {result.objects} objects visible
        </p>
      )}
    </div>
  );
}
