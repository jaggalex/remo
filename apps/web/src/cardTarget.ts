import type { KanbanState, Widget } from "@remo/model";

/**
 * Where a card created from the rail should land (ADR-119).
 *
 * A card is not a free object: it lives in a kanban cell. The rule is explicit so the
 * rail can both explain (button disabled) and act (same target) without guessing:
 * the selected matrix, the matrix of a selected card, or the only matrix on the board.
 */
export function cardTargetFor(
  widgets: Widget[],
  selectedIds: readonly string[],
  kanbanStates: Record<string, KanbanState>,
): { kanbanId: string; columnId: string; swimlaneId: string } | null {
  const matrices = widgets.filter((widget) => widget.type === "kanban");
  const selectedMatrix = widgets.find(
    (widget) => selectedIds.includes(widget.id) && widget.type === "kanban",
  );
  const selectedCard = widgets.find(
    (widget) =>
      selectedIds.includes(widget.id) &&
      widget.type === "card" &&
      widget.parentId &&
      kanbanStates[widget.parentId],
  );
  const kanbanId =
    selectedMatrix?.id ??
    selectedCard?.parentId ??
    (matrices.length === 1 ? matrices[0]!.id : null);
  const state = kanbanId ? kanbanStates[kanbanId] : undefined;
  const columnId = state?.columns[0]?.id;
  const swimlaneId = state?.swimlanes[0]?.id;
  if (!kanbanId || !columnId || !swimlaneId) return null;
  return { kanbanId, columnId, swimlaneId };
}
