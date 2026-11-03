import {
  DEFAULT_HEADER_HEIGHT,
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
  const padding = options.padding ?? 14;
  const gap = options.gap ?? 10;

  const columns = state.columns;
  const lanes = state.swimlanes;
  const columnCount = Math.max(columns.length, 1);
  const laneCount = Math.max(lanes.length, 1);

  const left = kanban.x - kanban.width / 2;
  const top = kanban.y - kanban.height / 2;
  // Columns carry their own widths; scale by the container box so the drawn
  // matrix always matches the widget we can hit-test.
  const stored = columns.reduce((total, column) => total + (column.width || 0), 0);
  const scale = stored > 0 ? kanban.width / stored : 1;
  const headerHeight = Math.min(
    state.headerHeight || DEFAULT_HEADER_HEIGHT,
    kanban.height * 0.4,
  );
  const laneHeight = (kanban.height - headerHeight) / laneCount;

  const byId = new Map(cards.map((c) => [c.id, c]));

  let cursor = left;
  const columnBands: ColumnBand[] = columns.map((column) => {
    const count = Object.values(state.cards).filter((p) => p.columnId === column.id).length;
    const width = (column.width || kanban.width / columnCount) * scale;
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

  const laneBands: LaneBand[] = lanes.map((lane, index) => {
    const count = Object.values(state.cards).filter((p) => p.swimlaneId === lane.id).length;
    return {
      id: lane.id,
      title: lane.title,
      count,
      top: top + headerHeight + index * laneHeight,
      centerY: top + headerHeight + index * laneHeight + laneHeight / 2,
      height: laneHeight,
    };
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

      const cardWidth = column.width - padding * 2;
      const cardHeight = Math.min(
        cell.reduce((max, item) => Math.max(max, byId.get(item.cardId)?.height ?? 0), 0) || 79,
        (lane.height - padding) / cell.length - gap,
        140,
      );
      const height = Math.max(cardHeight, 24);
      const blockHeight = cell.length * height + (cell.length - 1) * gap;
      const startY = lane.top + (lane.height - blockHeight) / 2 + height / 2;

      cell.forEach((item, index) => {
        placements.push({
          cardId: item.cardId,
          columnId: column.id,
          swimlaneId: lane.id,
          x: column.left + padding + cardWidth / 2,
          y: startY + index * (height + gap),
          width: cardWidth,
          height,
        });
      });
    }
  }

  return {
    left,
    top,
    width: kanban.width,
    height: kanban.height,
    headerHeight,
    padding,
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
