import { Button, IconButton, Separator, Tooltip } from "@remo/ui";
import type { Camera } from "@remo/canvas";
import { useI18n } from "./i18n";

/**
 * World coordinates are a developer's instrument, not a product readout (§10.4, Н2):
 * they live behind `?debug` instead of on the screen.
 */
const DEBUG = new URLSearchParams(window.location.search).has("debug");

/**
 * The bottom-left view controls: fit and zoom — nothing else.
 *
 * The grid switch and the coordinate readout are gone: the grid is a board setting
 * (ADR-123) and coordinates are debug output. Everything here is a design-system
 * Button/IconButton, so hover, press, focus and disabled come from one place.
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
      <Tooltip label={t("canvas.fitHint")}>
        <Button variant="ghost" size="compact" onClick={onFit}>
          {t("canvas.fit")}
        </Button>
      </Tooltip>
      <Separator vertical />
      <IconButton
        icon="minus"
        label={t("canvas.zoomOut")}
        size="compact"
        onClick={() => onZoom(1 / 1.2)}
      />
      <span className="hud-zoom">{Math.round(camera.zoom * 100)} %</span>
      <IconButton
        icon="plus"
        label={t("canvas.zoomIn")}
        size="compact"
        onClick={() => onZoom(1.2)}
      />
      {DEBUG && worldCursor && (
        <span className="hud-cursor" aria-hidden="true">
          {Math.round(worldCursor.x)}, {Math.round(worldCursor.y)}
        </span>
      )}
    </div>
  );
}
