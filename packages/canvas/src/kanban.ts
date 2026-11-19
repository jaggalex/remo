import type { CardStatus, TagColor, Widget } from "@remo/model";
import { drawCardMeta } from "./cardMeta";
import { drawCardSheet } from "./cardSheet";
import type { KanbanLayout } from "./layout";
import { DEFAULT_PALETTE, type CanvasPalette } from "./palette";
import { DEFAULT_FONT_FAMILY } from "./textLayout";

export interface KanbanPaintOptions {
  selectedIds?: readonly string[];
  /**
   * Placeholder inside an empty card.
   *
   * It is UI copy, so it comes from the caller's translations instead of being baked
   * into the painter (ADR-051).
   */
  placeholder?: string;
  /**
   * Card currently being dragged.
   *
   * It is painted on the overlay layer, following the pointer, so leaving it here as
   * well would show two copies of the same card. Its old place keeps a dashed
   * outline instead (`drawDragOrigin`).
   */
  hiddenCardId?: string | null;
  /** Colours from the design-system tokens; defaults keep tests and exports working. */
  palette?: CanvasPalette;
  /** Font family chosen in settings (Inter by default). */
  fontFamily?: string;
  /** Card records by id, so the face can show status, assignee and dates. */
  cards?: Map<string, Widget>;
  /** Localised status labels; default keeps tests and exports readable. */
  cardStatus?: Record<CardStatus, string>;
  /** The room's tag vocabulary, for tag chips on a card face (ADR-106). */
  tags?: ReadonlyMap<string, { name: string; color: TagColor }>;
}

/** The cell whose empty-cell `+` is under a world point, if any. */
export function plusHit(
  layout: KanbanLayout,
  point: { x: number; y: number },
  zoom: number,
): { columnId: string; swimlaneId: string } | null {
  const radius = 12 / Math.max(zoom, 0.01);
  for (const column of layout.columns) {
    for (const lane of layout.lanes) {
      const occupied = layout.placements.some(
        (placement) =>
          placement.columnId === column.id && placement.swimlaneId === lane.id,
      );
      if (occupied) continue;
      const cx = column.left + layout.padding + 16;
      const cy = lane.centerY;
      if (Math.abs(point.x - cx) <= radius && Math.abs(point.y - cy) <= radius) {
        return { columnId: column.id, swimlaneId: lane.id };
      }
    }
  }
  return null;
}

/**
 * Transient cell highlight, painted on the overlay layer. Keeping it out of the
 * board layer means moving the pointer across a kanban does not repaint the board.
 */
export function drawKanbanHover(
  ctx: CanvasRenderingContext2D,
  layout: KanbanLayout,
  cell: { columnId: string; swimlaneId: string } | null,
  palette: CanvasPalette = DEFAULT_PALETTE,
): void {
  if (!cell) return;
  const column = layout.columns.find((c) => c.id === cell.columnId);
  const lane = layout.lanes.find((l) => l.id === cell.swimlaneId);
  if (!column || !lane) return;

  ctx.fillStyle = palette.selectionFill;
  ctx.fillRect(column.left, lane.top, column.width, lane.height);
}

/** The count beside a column title: `n`, or `n / limit` and `!` when over (ADR-106). */
export function columnCountText(column: { count: number; wipLimit?: number }): string {
  const over = column.wipLimit != null && column.count > column.wipLimit;
  return column.wipLimit != null ? `${column.count} / ${column.wipLimit}${over ? " !" : ""}` : String(column.count);
}

/** A title on the kanban: what it names, and its box in world units. */
export interface KanbanTitleTarget {
  kind: "column" | "lane";
  id: string;
  index: number;
  title: string;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * The title under a point (ADR-244): a column's title and count in the header band, or a
 * lane's title in the strip (ADR-240). The same boxes the painter draws in, so the part
 * that reacts is the part that reads as a title; the rest of the band moves the kanban.
 * `measure` is the text width at a CSS font, from whoever has a context.
 */
export function kanbanTitleAt(
  layout: KanbanLayout,
  point: { x: number; y: number },
  measure: (text: string, font: string) => number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
): KanbanTitleTarget | null {
  for (const target of kanbanTitles(layout, measure, fontFamily)) {
    const { x, y, width, height } = target.box;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) return target;
  }
  return null;
}

/** Every title box of a kanban, columns first. */
export function kanbanTitles(
  layout: KanbanLayout,
  measure: (text: string, font: string) => number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
): KanbanTitleTarget[] {
  const { top, headerHeight, padding, left, laneStrip } = layout;
  const out: KanbanTitleTarget[] = [];
  const titleY = top + headerHeight * 0.42;
  layout.columns.forEach((column, index) => {
    const width =
      measure(column.title || " ", `600 20px ${fontFamily}`) +
      14 +
      measure(columnCountText(column), `19px ${fontFamily}`);
    const room = column.width - padding * 2;
    out.push({
      kind: "column",
      id: column.id,
      index,
      title: column.title,
      box: { x: column.left + padding - 4, y: titleY - 16, width: Math.min(width, room) + 8, height: 32 },
    });
  });
  if (laneStrip > 0) {
    layout.lanes.forEach((lane, index) => {
      // Up to two title lines and the count, at the top of the lane's strip cell.
      const height = Math.min(lane.height, 30 + 2 * 26 + 14);
      out.push({
        kind: "lane",
        id: lane.id,
        index,
        title: lane.title,
        box: { x: left + padding - 4, y: lane.top + 8, width: laneStrip - padding * 2 + 8, height: height - 8 },
      });
    });
  }
  return out;
}

const FONT = DEFAULT_FONT_FAMILY;

/**
 * Paints a kanban matrix: column headers with live counts, swimlane bands with
 * their own counts, and cards inside cells. Everything comes from `layout`, which
 * also drives hit-testing, so what is drawn is what can be clicked.
 */
export function drawKanban(
  ctx: CanvasRenderingContext2D,
  layout: KanbanLayout,
  zoom: number,
  titles: Map<string, string>,
  options: KanbanPaintOptions = {},
): void {
  const { left, top, width, height, headerHeight, padding } = layout;
  const hairline = 1 / zoom;
  const palette = options.palette ?? DEFAULT_PALETTE;
  const font = options.fontFamily ?? FONT;

  // Column headers.
  for (const column of layout.columns) {
    ctx.fillStyle = palette.textPrimary;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${20}px ${font}`;
    ctx.fillText(column.title, column.left + padding, top + headerHeight * 0.42);

    const over = column.wipLimit != null && column.count > column.wipLimit;
    const countText = columnCountText(column);
    // Measured in the title's own font: the count starts where the title ends.
    const titleWidth = ctx.measureText(column.title).width;
    ctx.fillStyle = over ? palette.warning : palette.textMuted;
    ctx.font = `${19}px ${font}`;
    ctx.fillText(countText, column.left + padding + titleWidth + 14, top + headerHeight * 0.42);

    ctx.fillStyle = column.accent;
    ctx.fillRect(
      column.left + padding,
      top + headerHeight * 0.68,
      column.width - padding * 2,
      3 / zoom,
    );
  }

  // Swimlane bands and their dividers. A lane's title and count live in the strip on the
  // left, so no card is ever drawn over them (ADR-240).
  const strip = layout.laneStrip;
  layout.lanes.forEach((lane, index) => {
    if (index > 0) {
      ctx.strokeStyle = palette.borderSubtle;
      ctx.lineWidth = hairline;
      ctx.beginPath();
      ctx.moveTo(left + padding, lane.top);
      ctx.lineTo(left + width - padding, lane.top);
      ctx.stroke();
    }
    if (strip <= 0) return;

    ctx.fillStyle = palette.textPrimary;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${20}px ${font}`;
    const lines = wrapText(ctx, lane.title, strip - padding * 2, 2);
    lines.forEach((line, row) => {
      ctx.fillText(line, left + padding, lane.top + 30 + row * 26);
    });
    ctx.fillStyle = palette.textMuted;
    ctx.font = `${19}px ${font}`;
    ctx.fillText(String(lane.count), left + padding, lane.top + 30 + lines.length * 26);
  });

  // Column separators, and the edge between the lane strip and the first column.
  ctx.strokeStyle = palette.borderSubtle;
  ctx.lineWidth = hairline;
  const separators = strip > 0 ? layout.columns : layout.columns.slice(1);
  const lastLane = layout.lanes[layout.lanes.length - 1];
  const bottom = Math.max(top + height, lastLane ? lastLane.top + lastLane.height : 0);
  separators.forEach((column) => {
    ctx.beginPath();
    ctx.moveTo(column.left, top + headerHeight * 0.8);
    ctx.lineTo(column.left, bottom);
    ctx.stroke();
  });

  // Cards.
  for (const placement of layout.placements) {
    if (placement.cardId === options.hiddenCardId) continue;
    const cardLeft = placement.x - placement.width / 2;
    const cardTop = placement.y - placement.height / 2;
    const selectedCard = options.selectedIds?.includes(placement.cardId) ?? false;
    const title = titles.get(placement.cardId) ?? "";
    const card = options.cards?.get(placement.cardId);

    ctx.save();

    drawCardSheet(
      ctx,
      { x: cardLeft, y: cardTop, width: placement.width, height: placement.height },
      zoom,
      { palette, selected: selectedCard },
    );

    // Meta goes on top of the card fill, so the badges are not painted under it.
    const titleY = card
      ? drawCardMeta(
          ctx,
          cardLeft,
          cardTop,
          placement.width,
          placement.height,
          card,
          {
            fontFamily: font,
            palette,
            statusLabel:
              options.cardStatus ?? { todo: "To do", in_progress: "In progress", done: "Done" },
            tags: options.tags,
          },
        )
      : placement.y;

    if (title) {
      ctx.fillStyle = palette.textSecondary;
      ctx.font = `${15}px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const lines = wrapText(ctx, title, placement.width - 28, 2);
      const lineHeight = 19;
      const offset = ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, index) => {
        ctx.fillText(line, cardLeft + 14, titleY - offset + index * lineHeight);
      });
    } else {
      ctx.fillStyle = palette.textMuted;
      ctx.font = `${15}px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(options.placeholder ?? "Type something", cardLeft + 14, titleY);
    }
    ctx.restore();
  }

  // Empty cells keep their `+` affordance.
  for (const column of layout.columns) {
    for (const lane of layout.lanes) {
      // Occupancy counts the dragged card too: its cell is not empty, it is just
      // waiting for the drop.
      const occupied = layout.placements.some(
        (p) => p.columnId === column.id && p.swimlaneId === lane.id,
      );
      if (occupied) continue;
      const cx = column.left + padding + 16;
      const cy = lane.centerY;
      ctx.strokeStyle = palette.borderStrong;
      ctx.lineWidth = 1.4 / zoom;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
    }
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) return lines;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}
