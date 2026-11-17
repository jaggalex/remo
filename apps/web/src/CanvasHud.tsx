import { ZoomControls } from "@remo/ui";
import type { Camera } from "@remo/canvas";
import { useI18n } from "./i18n";

/**
 * World coordinates are a developer's instrument, not a product readout (§10.4, Н2):
 * they live behind `?debug` instead of on the screen.
 */
const DEBUG = new URLSearchParams(window.location.search).has("debug");

/**
 * The bottom-left view controls: the design system's zoom panel and nothing else
 * (ADR-232). This component only places it and, behind `?debug`, the world cursor.
 */
export function CanvasHud({
  camera,
  worldCursor,
  onFit,
  onZoom,
}: {
  camera: Camera;
  worldCursor: { x: number; y: number } | null;
  onFit: () => void;
  onZoom: (factor: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="canvas-hud">
      <ZoomControls
        zoom={Math.round(camera.zoom * 100)}
        onOut={() => onZoom(1 / 1.2)}
        onIn={() => onZoom(1.2)}
        onFit={onFit}
        fitHint={t("canvas.fitHint")}
      />
      {DEBUG && worldCursor && (
        <span className="hud-cursor" aria-hidden="true">
          {Math.round(worldCursor.x)}, {Math.round(worldCursor.y)}
        </span>
      )}
    </div>
  );
}
