import {
  DEFAULT_HEADER_HEIGHT,
  KANBAN_CARD_GAP,
  KANBAN_PADDING,
  cardFaceHeight,
  kanbanLaneHeights,
  laneStripWidth,
  type KanbanState,
  type Widget,
} from "@remo/model";

export interface CardPlacement {
  cardId: string;
  columnId: string;
  swimlaneId: string;
  /** Card centre in canvas coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColumnBand {
  id: string;
  title: string;
  accent: string;
  count: number;
  /** Optional WIP limit; the header shows `count / limit` and a warning when over. */
  wipLimit?: number;
  left: number;
  centerX: number;
  width: number;
}

export interface LaneBand {
  id: string;
  title: string;
  count: number;
  top: number;
  centerY: number;
  height: number;
}

export interface KanbanLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  headerHeight: number;
  padding: number;
  /** Width of the lane-title strip on the left; 0 when no lane has a title (ADR-240). */
  laneStrip: number;
  columns: ColumnBand[];
  lanes: LaneBand[];
  placements: CardPlacement[];
}

/**
 * Computes the whole kanban matrix from state.
 *
 * The same result drives painting and hit-testing, so a card can never be drawn
 * somewhere it cannot be picked (ADR-006: layout is derived, never stored).
 */
export function layoutKanban(
  kanban: Widget,
  cards: Widget[],
  state: KanbanState,
  options: { padding?: number; gap?: number } = {},
): KanbanLayout {
  const padding = options.padding ?? KANBAN_PADDING;
  const gap = options.gap ?? KANBAN_CARD_GAP;

  const columns = state.columns;
  const lanes = state.swimlanes;
  const columnCount = Math.max(columns.length, 1);

  const left = kanban.x - kanban.width / 2;
  const top = kanban.y - kanban.height / 2;
  // Lane titles get a strip of their own, so no card lies on a title (ADR-240).
  const laneStrip = Math.min(laneStripWidth(state), kanban.width / 3);
  const matrixWidth = kanban.width - laneStrip;
  // Columns carry their own widths; scale by the space beside the strip so the drawn
  // matrix always matches the widget we can hit-test.
  const stored = columns.reduce((total, column) => total + (column.width || 0), 0);
  const scale = stored > 0 ? matrixWidth / stored : 1;
  const headerHeight = Math.min(
    state.headerHeight || DEFAULT_HEADER_HEIGHT,
    kanban.height * 0.4,
  );

  const byId = new Map(cards.map((c) => [c.id, c]));
  const heightOf = (cardId: string) => byId.get(cardId)?.height;
  // Lanes are as tall as their fullest cell; extra room is shared (ADR-240).
  const laneHeights = kanbanLaneHeights(state, kanban.height - headerHeight, heightOf);

  let cursor = left + laneStrip;
  const columnBands: ColumnBand[] = columns.map((column) => {
    const count = Object.values(state.cards).filter((p) => p.columnId === column.id).length;
    const width = (column.width || matrixWidth / columnCount) * scale;
    const band: ColumnBand = {
      id: column.id,
      title: column.title,
      accent: column.accent,
      count,
      ...(column.wipLimit != null ? { wipLimit: column.wipLimit } : {}),
      left: cursor,
      centerX: cursor + width / 2,
      width,
    };
    cursor += width;
    return band;
  });

  let laneTop = top + headerHeight;
  const laneBands: LaneBand[] = lanes.map((lane, index) => {
    const count = Object.values(state.cards).filter((p) => p.swimlaneId === lane.id).length;
    const height = laneHeights[index] ?? 0;
    const band: LaneBand = {
      id: lane.id,
      title: lane.title,
      count,
      top: laneTop,
      centerY: laneTop + height / 2,
      height,
    };
    laneTop += height;
    return band;
  });

  // Cards per cell, in fractional order.
  const cells = new Map<string, { cardId: string; order: string }[]>();
  for (const [cardId, placement] of Object.entries(state.cards)) {
    const key = `${placement.columnId}|${placement.swimlaneId}`;
    const cell = cells.get(key) ?? [];
    cell.push({ cardId, order: placement.order });
    cells.set(key, cell);
  }
  for (const cell of cells.values()) cell.sort((a, b) => (a.order < b.order ? -1 : 1));

  const placements: CardPlacement[] = [];

  for (const column of columnBands) {
    for (const lane of laneBands) {
      const cell = cells.get(`${column.id}|${lane.id}`);
      if (!cell?.length) continue;

      // Each card keeps its own height and the cell stacks them from its top: the lane
      // is at least that tall, so nothing spills into the next lane.
      const cardWidth = column.width - padding * 2;
      let y = lane.top + padding;
      for (const item of cell) {
        const height = cardFaceHeight(heightOf(item.cardId));
        placements.push({
          cardId: item.cardId,
          columnId: column.id,
          swimlaneId: lane.id,
          x: column.left + padding + cardWidth / 2,
          y: y + height / 2,
          width: cardWidth,
          height,
        });
        y += height + gap;
      }
    }
  }

  return {
    left,
    top,
    width: kanban.width,
    height: kanban.height,
    headerHeight,
    padding,
    laneStrip,
    columns: columnBands,
    lanes: laneBands,
    placements,
  };
}

/**
 * The same layout, shifted.
 *
 * A kanban's matrix is derived from the widget, so when the widget is being carried
 * the matrix has to move with it — otherwise the frame travels and the columns stay
 * behind. Nothing is recomputed: every box is translated by the same offset.
 */
export function translateLayout(layout: KanbanLayout, dx: number, dy: number): KanbanLayout {
  return {
    ...layout,
    left: layout.left + dx,
    top: layout.top + dy,
    columns: layout.columns.map((column) => ({
      ...column,
      left: column.left + dx,
      centerX: column.centerX + dx,
    })),
    lanes: layout.lanes.map((lane) => ({
      ...lane,
      top: lane.top + dy,
      centerY: lane.centerY + dy,
    })),
    placements: layout.placements.map((placement) => ({
      ...placement,
      x: placement.x + dx,
      y: placement.y + dy,
    })),
  };
}

/** Cell under a point, used by drag-and-drop and by `+` quick add. */
export function cellAt(
  layout: KanbanLayout,
  point: { x: number; y: number },
): { columnId: string; swimlaneId: string } | null {
  const column = layout.columns.find(
    (c) => point.x >= c.left && point.x <= c.left + c.width,
  );
  const lane = layout.lanes.find(
    (l) => point.y >= l.top && point.y <= l.top + l.height,
  );
  if (!column || !lane) return null;
  return { columnId: column.id, swimlaneId: lane.id };
}

/**
 * Where a dragged card lands in a cell (ADR-006: order is a fractional key): before the
 * first card whose centre is below the pointer, or at the end. The dragged card itself
 * is not a slot. `lineY` is where the drop line is drawn, halfway between two cards.
 */
export function cardDropSlot(
  layout: KanbanLayout,
  cell: { columnId: string; swimlaneId: string },
  y: number,
  draggedCardId: string,
): { beforeCardId: string | null; lineY: number } {
  const lane = layout.lanes.find((entry) => entry.id === cell.swimlaneId);
  const inCell = layout.placements
    .filter(
      (p) => p.columnId === cell.columnId && p.swimlaneId === cell.swimlaneId && p.cardId !== draggedCardId,
    )
    .sort((a, b) => a.y - b.y);
  const before = inCell.find((p) => p.y > y);
  const gap = 10;
  if (before) {
    const index = inCell.indexOf(before);
    const previous = inCell[index - 1];
    const top = before.y - before.height / 2;
    const lineY = previous ? (previous.y + previous.height / 2 + top) / 2 : top - gap / 2;
    return { beforeCardId: before.cardId, lineY };
  }
  const last = inCell[inCell.length - 1];
  const lineY = last
    ? last.y + last.height / 2 + gap / 2
    : (lane?.top ?? layout.top) + layout.padding;
  return { beforeCardId: null, lineY };
}

/**
 * Where a dragged column or lane lands (ADR-244): its index among the others, which is
 * what `moveColumn` / `moveSwimlane` take, and the line that shows it (an x for a column,
 * a y for a lane).
 */
export function axisDropSlot(
  layout: KanbanLayout,
  kind: "column" | "lane",
  id: string,
  point: { x: number; y: number },
): { index: number; line: number } {
  if (kind === "column") {
    const others = layout.columns.filter((column) => column.id !== id);
    const index = others.filter((column) => column.centerX < point.x).length;
    const next = others[index];
    const last = others[others.length - 1];
    const line = next ? next.left : last ? last.left + last.width : layout.left + layout.laneStrip;
    return { index, line };
  }
  const others = layout.lanes.filter((lane) => lane.id !== id);
  const index = others.filter((lane) => lane.centerY < point.y).length;
  const next = others[index];
  const last = others[others.length - 1];
  const line = next ? next.top : last ? last.top + last.height : layout.top + layout.headerHeight;
  return { index, line };
}

/** True when the point falls inside the kanban container box. */
export function kanbanContains(
  layout: KanbanLayout,
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= layout.left &&
    point.x <= layout.left + layout.width &&
    point.y >= layout.top &&
    point.y <= layout.top + layout.height
  );
}

/** Cards touched by a marquee drawn inside a kanban. */
export function placementsInRect(
  layout: KanbanLayout,
  rect: { x: number; y: number; width: number; height: number },
): CardPlacement[] {
  return layout.placements.filter(
    (p) =>
      p.x - p.width / 2 < rect.x + rect.width &&
      p.x + p.width / 2 > rect.x &&
      p.y - p.height / 2 < rect.y + rect.height &&
      p.y + p.height / 2 > rect.y,
  );
}

export function placementAt(
  layout: KanbanLayout,
  point: { x: number; y: number },
): CardPlacement | null {
  for (let i = layout.placements.length - 1; i >= 0; i -= 1) {
    const p = layout.placements[i]!;
    if (
      point.x >= p.x - p.width / 2 &&
      point.x <= p.x + p.width / 2 &&
      point.y >= p.y - p.height / 2 &&
      point.y <= p.y + p.height / 2
    ) {
      return p;
    }
  }
  return null;
}
