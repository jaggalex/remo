import { connectorPath, labelMetrics, labelPoint, type Camera } from "@remo/canvas";
import type { TextDeltaOp } from "@remo/model";
import type { Widget } from "@remo/model";
import type { EditorTarget } from "./InlineEditor";
import { DEFAULT_BAR_SURFACE, DEFAULT_INK } from "./objectDefaults";

export function connectorEditorTarget(
  connector: Widget,
  camera: Camera,
  boardRect: { width: number; height: number },
  delta: TextDeltaOp[],
  resolve: (id: string) => Widget | undefined,
  stubOptions: { max?: number; ratio?: number },
  fontFamily: string = "sans-serif",
): EditorTarget | null {
  const path = connectorPath(connector, resolve, stubOptions);
  if (!path) return null;

  const mid = labelPoint(path, connector.labelAt);
  const zoom = camera.zoom;
  const textSize = connector.style?.fontSize ?? 13;
  const size = Math.max(11, textSize * zoom);
  // The editor sits in the chip it edits (ADR-213): the same layout gives the width and
  // the height, with a screen floor so a label stays typeable when zoomed out.
  const text = delta
    .filter((op) => op.insert)
    .map((op) => op.insert ?? "")
    .join("");
  const metrics = labelMetrics(text || connector.content || "", textSize, fontFamily);
  const width = Math.max((metrics?.width ?? 200) * zoom, 120);
  const height = Math.max((metrics?.height ?? size * 1.7 / zoom) * zoom, 24);
  const centreX = (mid.x - camera.x) * zoom + boardRect.width / 2;
  const centreY = (mid.y - camera.y) * zoom + boardRect.height / 2;

  return {
    id: connector.id,
    rect: {
      left: centreX - width / 2,
      top: centreY - height / 2,
      width,
      height,
    },
    delta,
    fontSize: size,
    padding: Math.max(4, 4 * zoom),
    align: "center",
    vAlign: "middle",
    fontWeight: 500,
    fill: DEFAULT_BAR_SURFACE,
    ink: connector.style?.textColor ?? DEFAULT_INK,
    radius: 4,
  };
}
