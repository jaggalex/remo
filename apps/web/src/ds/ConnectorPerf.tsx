import { useEffect, useRef, useState } from "react";
import { DEFAULT_FONT_FAMILY, drawWidget } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { canvasPaletteFromTokens } from "../canvasPalette";
import { DEFAULT_INK } from "../objectDefaults";

/**
 * Dev-only performance harness for the connector painter (roadmap 1.7).
 *
 * It paints 60 notes and 120 connectors, moves one note every frame, and reports the
 * average and worst frame time. It is deliberately outside the product route: this is
 * a measurement, not a screen.
 */
const NOTES = 60;
const CONNECTORS = 120;

function scene(): Widget[] {
  const widgets: Widget[] = [];
  for (let index = 0; index < NOTES; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    widgets.push({
      id: `n${index}`,
      type: "sticky_note",
      parentId: null,
      x: column * 220,
      y: row * 220,
      width: 140,
      height: 120,
      content: `Note ${index}`,
      style: { fillColor: "yellow" },
    });
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
      start: { item: from.id, side: index % 2 ? "right" : "bottom" },
      end: { item: to.id, side: index % 2 ? "left" : "top" },
      arrow: "end",
      routing: ["straight", "elbow", "curved"][index % 3] as "straight" | "elbow" | "curved",
      style: { strokeColor: DEFAULT_INK, strokeWidth: 1.5 },
    });
  }
  return widgets;
}

export function ConnectorPerf() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<{ fps: number; average: number; worst: number } | null>(null);

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
    const intervals: number[] = [];
    let frame = 0;
    let previous = performance.now();
    let raf = 0;

    const paint = () => {
      const started = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = palette.canvas;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(0.42, 0.42);
      ctx.translate(40, 40);
      const moving = widgets[0]!;
      moving.x = 40 + Math.sin(frame / 8) * 90;
      for (const widget of widgets) {
        drawWidget(ctx, widget, 0.42, { resolve, theme });
      }
      ctx.restore();
      const ended = performance.now();
      frames.push(ended - started);
      intervals.push(ended - previous);
      frame += 1;
      previous = ended;
      if (frame < 150) raf = requestAnimationFrame(paint);
      else {
        const average = frames.reduce((sum, value) => sum + value, 0) / frames.length;
        const interval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
        const worst = Math.max(...frames);
        const measured = {
          fps: Math.round((1000 / interval) * 10) / 10,
          average: Math.round(average * 10) / 10,
          worst: Math.round(worst * 10) / 10,
        };
        (window as unknown as Record<string, unknown>).__connectorPerf = measured;
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
          {result.fps} FPS · average {result.average} ms · worst {result.worst} ms · 120 connectors
        </p>
      )}
    </div>
  );
}
