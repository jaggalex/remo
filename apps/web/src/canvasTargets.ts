import {
  kanbanContains,
  layerKey,
  pick,
  pickConnector,
  placementAt,
  type KanbanLayout,
} from "@remo/canvas";
import { expandGroups, type Vec2, type Widget } from "@remo/model";

/**
 * What a right-click is about.
 *
 * Extracted from `BoardCanvas` so the rule can be read in one place and tested: the
 * topmost thing under the pointer decides, a kanban's column/swimlane/card bands are
 * checked before the board, and — since ADR-058 — a click *inside* the current selection
 * keeps that selection, so the menu acts on what the person already chose.
 */
export type ContextTarget =
  | { kind: "card"; kanbanId: string; cardId: string }
  | { kind: "column"; kanbanId: string; columnId: string; index: number }
  | { kind: "swimlane"; kanbanId: string; swimlaneId: string; index: number }
  | { kind: "kanban"; kanbanId: string }
  | { kind: "selection"; ids: string[] };

export interface ContextTargetArgs {
  world: Vec2;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  selectedIds: readonly string[];
  isCardOfKanban: (widget: Widget) => boolean;
  /** Resolves a widget, including cards to their cell. */
  resolve: (id: string) => Widget | undefined;
  /** Hit tolerance and elbow stubs, so the answer matches what the line looks like. */
  connector: { tolerance: number; stubMax?: number; stubRatio?: number };
}

/**
 * The ids a right-click should act on.
 *
 * A widget inside the current selection keeps the whole selection; anything else is
 * replaced by what was clicked (expanded to its group, as a click would).
 */
function selectionFor(args: ContextTargetArgs, widget: Widget): string[] {
  const { selectedIds, widgets } = args;
  if (selectedIds.length > 1) {
    const inSelection =
      selectedIds.includes(widget.id) ||
      (widget.groupId != null &&
        widgets.some((candidate) => selectedIds.includes(candidate.id) && candidate.groupId === widget.groupId));
    if (inSelection) return [...selectedIds];
  }
  return expandGroups(widgets, [widget.id]);
}

export function contextTargetAt(args: ContextTargetArgs): ContextTarget {
  const { world, widgets, layouts, isCardOfKanban, resolve } = args;

  // Whatever is painted on top wins: a note dropped onto a kanban is above it, so its
  // own menu must open instead of the board's.
  const topmost = pick(widgets, world, isCardOfKanban);
  if (topmost && topmost.type !== "kanban") {
    return { kind: "selection", ids: selectionFor(args, topmost) };
  }

  for (const [kanbanId, layout] of layouts) {
    if (!kanbanContains(layout, world)) continue;

    const placement = placementAt(layout, world);
    if (placement) return { kind: "card", kanbanId, cardId: placement.cardId };

    const columnIndex = layout.columns.findIndex(
      (column) => world.x >= column.left && world.x <= column.left + column.width,
    );
    const laneIndex = layout.lanes.findIndex(
      (lane) => world.y >= lane.top && world.y <= lane.top + lane.height,
    );

    if (world.y <= layout.top + layout.headerHeight) {
      const column = columnIndex >= 0 ? layout.columns[columnIndex] : undefined;
      if (column) return { kind: "column", kanbanId, columnId: column.id, index: columnIndex };
      return { kind: "kanban", kanbanId };
    }

    const lane = laneIndex >= 0 ? layout.lanes[laneIndex] : undefined;
    const firstColumn = layout.columns[0];
    const overLabel =
      firstColumn && lane
        ? world.x <= firstColumn.left + 320 && world.y - lane.top <= 48
        : false;
    if (lane && overLabel) {
      return { kind: "swimlane", kanbanId, swimlaneId: lane.id, index: laneIndex };
    }

    return { kind: "kanban", kanbanId };
  }

  const hit = pick(widgets, world, isCardOfKanban);
  const connector = pickConnector(
    widgets,
    world,
    args.connector.tolerance,
    resolve,
    { max: args.connector.stubMax, ratio: args.connector.stubRatio },
  );
  if (connector && (!hit || layerKey(connector) > layerKey(hit))) {
    const inSelection = args.selectedIds.includes(connector.id);
    return {
      kind: "selection",
      ids: inSelection && args.selectedIds.length > 1 ? [...args.selectedIds] : [connector.id],
    };
  }
  if (hit) return { kind: "selection", ids: selectionFor(args, hit) };
  return { kind: "selection", ids: [...args.selectedIds] };
}
