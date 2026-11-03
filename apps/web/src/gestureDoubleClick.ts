import { isEditable } from "./editable";
import type { GestureEnv } from "./gestureEnv";
import { cellAt, connectorHandles, connectorPath, kanbanContains, layerKey, pick, pickConnector, placementAt } from "@remo/canvas";
import { expandGroups } from "@remo/model";

/**
   * Double-click edits what is under the cursor.
   *
   * Same rule as picking: the widget painted on top wins. A sticky dropped over a
   * kanban must open its text, not create a card in the cell beneath it — and a
   * double-click on a card inside the kanban still goes through the matrix, because
   * cards are not pickable as widgets.
   */
export function doubleClick(env: GestureEnv, event: React.MouseEvent<HTMLCanvasElement>) {
  const { camera, settings, widgets, layouts, selectedIds, isCardOfKanban, toWorld, worldToScreenPoint, onSelect, onAddCard, onDeleteWaypoint, onEdit, readOnly, widgetById } = env;
  const world = toWorld(event);
  const hit = pick(widgets, world, isCardOfKanban);

  if (readOnly) return;
  if (hit && layouts.has(hit.id)) {
    const layout = layouts.get(hit.id)!;
    const placement = placementAt(layout, world);
    if (placement) {
      onEdit(placement.cardId);
      return;
    }
    if (world.y < layout.top + layout.headerHeight) return;
    const cell = cellAt(layout, world);
    if (cell) onAddCard(hit.id, cell.columnId, cell.swimlaneId);
    return;
  }

  // ADR-077: double-click on a rigid point deletes it and merges the segments.
  const soleLineForPoint = selectedIds.length === 1 ? widgetById(selectedIds[0]!) : undefined;
  if (soleLineForPoint?.type === "connector" && !soleLineForPoint.locked) {
    const path = connectorPath(soleLineForPoint, widgetById, {
      max: settings.connectors.stubMax,
      ratio: settings.connectors.stubRatio,
    });
    if (path) {
      for (const handle of connectorHandles(path, soleLineForPoint)) {
        if (handle.kind !== "waypoint" || !handle.waypointId) continue;
        const screen = worldToScreenPoint(handle.point);
        if (Math.hypot(screen.x - event.clientX, screen.y - event.clientY) <= 12) {
          onDeleteWaypoint(soleLineForPoint.id, handle.waypointId);
          return;
        }
      }
    }
  }

  const line = pickConnector(widgets, world, 8 / camera.zoom, widgetById, {
    max: settings.connectors.stubMax,
    ratio: settings.connectors.stubRatio,
  });
  if (line && (!hit || layerKey(line) > layerKey(hit))) {
    onSelect([line.id]);
    if (isEditable(line)) onEdit(line.id);
    return;
  }

  // Double-click enters a group: the member alone becomes the selection, so it can
  // be restyled, layered or edited without taking the group apart (ADR-047).
  if (hit && hit.groupId) {
    onSelect([hit.id]);
    if (isEditable(hit)) onEdit(hit.id);
    return;
  }

  if (hit && isEditable(hit)) {
    onSelect(expandGroups(widgets, [hit.id]));
    onEdit(hit.id);
    return;
  }

  // Nothing on top: a double-click inside a kanban body still adds a card.
  for (const [kanbanId, layout] of layouts) {
    if (!kanbanContains(layout, world)) continue;
    if (world.y < layout.top + layout.headerHeight) return;
    const cell = cellAt(layout, world);
    if (cell) onAddCard(kanbanId, cell.columnId, cell.swimlaneId);
    return;
  }
}
