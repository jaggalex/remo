import { connectorPath, labelPoint, type Camera } from "@remo/canvas";
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
): EditorTarget | null {
  const path = connectorPath(connector, resolve, stubOptions);
  if (!path) return null;

  const mid = labelPoint(path, connector.labelAt);
  const zoom = camera.zoom;
  const textSize = connector.style?.fontSize ?? 13;
  const size = Math.max(11, textSize * zoom);
  const width = Math.max(140, 200 * zoom);
  const height = Math.max(24, size * 1.7);
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
