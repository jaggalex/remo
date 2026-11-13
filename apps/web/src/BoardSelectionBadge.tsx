import { useMemo } from "react";
import { soleSelectedGroup, type Tag, type Widget } from "@remo/model";
import { connectorPath, pathPolyline, textClipped } from "@remo/canvas";
import type { BoardSettings } from "./settings";
import { SelectionBadge } from "./SelectionBadge";

/**
 * The selection badge and the few facts it needs (ADR-211).
 *
 * Kept out of `BoardCanvas` because the canvas is at its line limit, and because the
 * badge is the only reader of "the selection as a whole": a single object, a group or a
 * block, plus the line's drawn size. The canvas passes the raw selection and the badge
 * decides what to say.
 */
export function BoardSelectionBadge({
  widgets,
  selectedIds,
  groupNames,
  tags,
  resizeLimit,
  widgetById,
  settings,
}: {
  widgets: readonly Widget[];
  selectedIds: readonly string[];
  groupNames: Record<string, string>;
  tags: Record<string, Tag>;
  resizeLimit: { width: number; height: number } | null;
  widgetById: (id: string) => Widget | undefined;
  settings: BoardSettings;
}) {
  const selectedWidget =
    selectedIds.length === 1 ? widgets.find((widget) => widget.id === selectedIds[0]) : undefined;

  /**
   * Size of the selected line as it is drawn, not as it was stored.
   *
   * A connector's box is a leftover of its creation: moving an endpoint changes the
   * path without rewriting it, so the badge used to report the shape of a line that no
   * longer exists.
   */
  const selectedLineSize = useMemo(() => {
    if (!selectedWidget || selectedWidget.type !== "connector") return null;
    const path = connectorPath(selectedWidget, widgetById, {
      max: settings.connectors.stubMax,
      ratio: settings.connectors.stubRatio,
    });
    if (!path) return null;
    const points = pathPolyline(path);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      width: Math.round(Math.max(...xs) - Math.min(...xs)),
      height: Math.round(Math.max(...ys) - Math.min(...ys)),
    };
  }, [selectedWidget, settings.connectors.stubMax, settings.connectors.stubRatio, widgetById]);

  const selectedGroup = soleSelectedGroup(widgets, selectedIds);

  // The clip state is the same measure the painter uses (ADR-214). Only the two kinds
  // that paint text in a box are asked; a card's title is a different layout. A shape
  // paints its label at the M cap whatever `stickySize` it carries, so the badge asks
  // with the same cap the painter does (ADR-215).
  const clipped =
    selectedWidget &&
    (selectedWidget.type === "sticky_note" || selectedWidget.type === "shape")
      ? textClipped(
          selectedWidget,
          selectedWidget.type === "shape"
            ? settings.notes.fontCap.M
            : (settings.notes.fontCap[selectedWidget.style?.stickySize ?? "M"] ??
              settings.notes.fontCap.M),
          settings.text.fontFamily,
        )
      : null;

  return (
    <SelectionBadge
      selectedIds={selectedIds}
      selectedWidget={selectedWidget}
      selectedGroup={selectedGroup}
      selectedGroupName={selectedGroup ? groupNames[selectedGroup] : undefined}
      selectedTags={
        selectedWidget?.tagIds?.map((id) => tags[id]).filter((tag): tag is Tag => Boolean(tag)) ??
        []
      }
      selectedLineSize={selectedLineSize}
      selectedWidgets={
        selectedIds.length > 1
          ? widgets.filter((widget) => selectedIds.includes(widget.id))
          : []
      }
      resizeLimit={resizeLimit}
      textClipped={clipped}
    />
  );
}
