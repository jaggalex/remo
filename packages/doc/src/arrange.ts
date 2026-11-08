import { bounds, kindOf, type Widget } from "@remo/model";
import type { BoardDocument } from "./board";
import { moveWidgets, type WidgetPosition } from "./widgets";

/**
 * Arranging a selection: six edges and equal gaps.
 *
 * The commands work on *units* — a group is one unit — so aligning never collapses a
 * group into a column; children follow their container (ADR-036).
 */

/* --------------------------------------------------------------- arranging --- */

/**
 * How a selection is lined up.
 *
 * The six edges are the source product's Arrange menu: three along each axis. The
 * commands work on *units* — a group is one unit — so aligning a group does not
 * collapse it into a column of its members (ADR-036).
 */
export type AlignEdge = "left" | "centerX" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

interface ArrangeUnit {
  /** Roots only: a child moves with its container. */
  ids: string[];
  box: { x: number; y: number; width: number; height: number };
}

/**
 * The things an arrange command may move, one entry per group.
 *
 * Cards are placed by their kanban matrix and connectors are derived from their
 * endpoints, so neither has a free position to arrange; children follow their
 * container through `moveWidgets`, which is why only roots become units.
 */
function arrangeUnits(board: BoardDocument, ids: readonly string[]): ArrangeUnit[] {
  const units = new Map<string, Widget[]>();
  for (const id of ids) {
    const widget = board.readWidget(id);
    if (!widget) continue;
    if (!kindOf(widget.type).movable) continue;
    if (widget.parentId) continue;
    const key = widget.groupId ?? widget.id;
    const members = units.get(key) ?? [];
    members.push(widget);
    units.set(key, members);
  }

  return [...units.values()].map((members) => ({
    ids: members.map((widget) => widget.id),
    box: bounds(members),
  }));
}

/**
 * Line the selection up along one edge in a single undo step.
 *
 * The reference is the selection's own union box, so aligning never moves the
 * outermost objects: the group stays where the person put it and the rest comes to
 * it.
 */
export function alignWidgets(
  board: BoardDocument,
  ids: readonly string[],
  edge: AlignEdge,
): void {
  const units = arrangeUnits(board, ids);
  if (units.length < 2) return;

  const all = units.flatMap((unit) =>
    unit.ids.map((id) => board.readWidget(id)).filter((widget): widget is Widget => Boolean(widget)),
  );
  const whole = bounds(all);
  const moves: WidgetPosition[] = [];

  for (const unit of units) {
    let dx = 0;
    let dy = 0;
    switch (edge) {
      case "left":
        dx = whole.x - unit.box.x;
        break;
      case "centerX":
        dx = whole.x + (whole.width - unit.box.width) / 2 - unit.box.x;
        break;
      case "right":
        dx = whole.x + whole.width - (unit.box.x + unit.box.width);
        break;
      case "top":
        dy = whole.y - unit.box.y;
        break;
      case "middle":
        dy = whole.y + (whole.height - unit.box.height) / 2 - unit.box.y;
        break;
      case "bottom":
        dy = whole.y + whole.height - (unit.box.y + unit.box.height);
        break;
    }
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;

    for (const id of unit.ids) {
      const widget = board.readWidget(id);
      if (widget) moves.push({ id, x: widget.x + dx, y: widget.y + dy });
    }
  }

  moveWidgets(board, moves);
}

/**
 * Equalise the gaps between three or more units along one axis.
 *
 * The outermost units stay put and everything between them is spread so the spaces
 * are equal — distributing centres instead would change the gaps whenever the
 * objects differ in size, which is the opposite of what the command promises.
 */
export function distributeWidgets(
  board: BoardDocument,
  ids: readonly string[],
  axis: DistributeAxis,
): void {
  const units = arrangeUnits(board, ids);
  if (units.length < 3) return;

  const horizontal = axis === "horizontal";
  const ordered = [...units].sort((a, b) =>
    horizontal ? a.box.x - b.box.x : a.box.y - b.box.y,
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const start = horizontal ? first.box.x : first.box.y;
  const end = horizontal ? last.box.x + last.box.width : last.box.y + last.box.height;
  const occupied = ordered.reduce(
    (total, unit) => total + (horizontal ? unit.box.width : unit.box.height),
    0,
  );
  const gap = (end - start - occupied) / (ordered.length - 1);

  const moves: WidgetPosition[] = [];
  let cursor = start;
  for (const unit of ordered) {
    const delta = cursor - (horizontal ? unit.box.x : unit.box.y);
    if (Math.abs(delta) > 0.001) {
      for (const id of unit.ids) {
        const widget = board.readWidget(id);
        if (widget) {
          moves.push({
            id,
            x: widget.x + (horizontal ? delta : 0),
            y: widget.y + (horizontal ? 0 : delta),
          });
        }
      }
    }
    cursor += (horizontal ? unit.box.width : unit.box.height) + gap;
  }

  moveWidgets(board, moves);
}

/**
 * Delete several widgets (and their kanban placements) as one gesture.
 *
 * Contents are removed with their container: a frame takes its stickies, a kanban
 * takes its cards, and each card's placement goes with it.
 */
