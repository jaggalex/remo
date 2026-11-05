import type { CardStatus, Widget } from "@remo/model";
import { drawCardMeta } from "./cardMeta";
import type { KanbanLayout } from "./layout";
import { DEFAULT_PALETTE, type CanvasPalette } from "./palette";

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

const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

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
    const countText =
      column.wipLimit != null
        ? `${column.count} / ${column.wipLimit}${over ? " !" : ""}`
        : String(column.count);
    ctx.fillStyle = over ? palette.warning : palette.textMuted;
    ctx.font = `${19}px ${font}`;
    const titleWidth = ctx.measureText(column.title).width;
    ctx.fillText(countText, column.left + padding + titleWidth + 14, top + headerHeight * 0.42);

    ctx.fillStyle = column.accent;
    ctx.fillRect(
      column.left + padding,
      top + headerHeight * 0.68,
      column.width - padding * 2,
      3 / zoom,
    );
  }

  // Swimlane bands and their dividers.
  layout.lanes.forEach((lane, index) => {
    if (index > 0) {
      ctx.strokeStyle = palette.borderSubtle;
      ctx.lineWidth = hairline;
      ctx.beginPath();
      ctx.moveTo(left + padding, lane.top);
      ctx.lineTo(left + width - padding, lane.top);
      ctx.stroke();
    }

    ctx.fillStyle = palette.textPrimary;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${20}px ${font}`;
    ctx.fillText(lane.title, left + padding, lane.top + 34);

    ctx.fillStyle = palette.textMuted;
    ctx.font = `${19}px ${font}`;
    const laneWidth = ctx.measureText(lane.title).width;
    ctx.fillText(String(lane.count), left + padding + laneWidth + 14, lane.top + 34);
  });

  // Column separators.
  ctx.strokeStyle = palette.borderSubtle;
  ctx.lineWidth = hairline;
  layout.columns.slice(1).forEach((column) => {
    ctx.beginPath();
    ctx.moveTo(column.left, top + headerHeight * 0.8);
    ctx.lineTo(column.left, top + height);
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

    ctx.fillStyle = palette.panel;
    ctx.strokeStyle = selectedCard ? palette.accent : palette.borderSubtle;
    ctx.lineWidth = (selectedCard ? 2.5 : 1.8) / zoom;
    roundedRect(ctx, cardLeft, cardTop, placement.width, placement.height, placement.height / 2.6);
    ctx.fill();
    ctx.stroke();

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
          },
          zoom,
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

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
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
