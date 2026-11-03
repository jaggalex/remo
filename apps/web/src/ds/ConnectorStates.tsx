import { useEffect, useRef } from "react";
import { drawWidget } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { canvasPaletteFromTokens } from "../canvasPalette";
import { DEFAULT_INK } from "../objectDefaults";

/**
 * Three connector routings on a fixed canvas, for the visual baseline (roadmap Q2.1).
 *
 * This is a measurement surface, not a product screen: the same painter, a deterministic
 * scene, no camera and no chrome. The PNG is the evidence a person reviews; the e2e test
 * samples pixels so a regression cannot hide behind a pretty file.
 */
const WIDTH = 760;
const HEIGHT = 460;

function note(id: string, x: number, y: number, label: string): Widget {
  return {
    id,
    type: "sticky_note",
    parentId: null,
    x,
    y,
    width: 130,
    height: 84,
    content: label,
    style: { fillColor: "yellow" },
  };
}

function connector(
  id: string,
  from: Widget,
  to: Widget,
  routing: "straight" | "elbow" | "curved",
  waypoints?: Widget["waypoints"],
): Widget {
  return {
    id,
    type: "connector",
    parentId: null,
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
    start: { item: from.id, side: "right" },
    end: { item: to.id, side: "left" },
    arrow: "end",
    routing,
    ...(waypoints ? { waypoints } : {}),
    style: { strokeColor: DEFAULT_INK, strokeWidth: 2 },
  };
}

export function ConnectorStates() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const palette = canvasPaletteFromTokens();
    const theme = {
      fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
      fontCap: { S: 13, M: 16, L: 20 },
      shapeStrokeWidth: 2,
      cardPlaceholder: "Type something",
      timerExpired: "Time is up",
      cardStatus: { todo: "To do", in_progress: "In progress", done: "Done" },
      palette,
    };

    const left = (y: number, id: string, label: string) => note(id, 120, y, label);
    const right = (y: number, id: string, label: string) => note(id, 640, y, label);
    const widgets: Widget[] = [];

    const straightFrom = left(90, "s-from", "Straight");
    const straightTo = right(90, "s-to", "A → B");
    widgets.push(straightFrom, straightTo, connector("s-line", straightFrom, straightTo, "straight"));

    const elbowFrom = left(210, "e-from", "Elbow");
    const elbowTo = right(270, "e-to", "corner");
    widgets.push(
      elbowFrom,
      elbowTo,
      connector("e-line", elbowFrom, elbowTo, "elbow"),
    );

    const curvedFrom = left(350, "c-from", "Curved");
    const curvedTo = right(400, "c-to", "bulge");
    widgets.push(curvedFrom, curvedTo, connector("c-line", curvedFrom, curvedTo, "curved"));

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = palette.canvas;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const resolve = (id: string) => widgets.find((widget) => widget.id === id);
    for (const widget of widgets) drawWidget(ctx, widget, 1, { resolve, theme });
  }, []);

  return (
    <div className="ds-connector-states" data-testid="connector-states">
      <canvas ref={ref} width={WIDTH} height={HEIGHT} aria-label="Three connector routings" />
    </div>
  );
}
