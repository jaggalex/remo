import { gatherPlan } from "@remo/doc";
import type { Camera } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { useI18n } from "./i18n";

/**
 * The section "Gather into section" would create, drawn while the action is pointed at
 * (ADR-198). It reads the same plan the command uses, so the outline is the box the click
 * creates.
 */
export function GatherPreview({
  on,
  widgets,
  selectedIds,
  camera,
  viewport,
}: {
  on: boolean;
  widgets: readonly Widget[];
  selectedIds: readonly string[];
  camera: Camera;
  viewport: { width: number; height: number };
}) {
  const { t } = useI18n();
  if (!on || selectedIds.length < 2) return null;
  const box = gatherPlan(widgets, selectedIds).box;
  if (!box) return null;
  return (
    <div
      className="gather-preview"
      aria-hidden="true"
      style={{
        left: (box.x - camera.x) * camera.zoom + viewport.width / 2,
        top: (box.y - camera.y) * camera.zoom + viewport.height / 2,
        width: box.width * camera.zoom,
        height: box.height * camera.zoom,
      }}
    >
      <span>{t("section.title")}</span>
    </div>
  );
}
