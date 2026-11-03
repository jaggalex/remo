import type { CardStatus, Widget } from "@remo/model";
import type { CanvasPalette } from "./palette";

/** The small print on a card: status, assignee and date range (ADR-106 amendment). */
export interface CardMetaTheme {
  fontFamily: string;
  palette: CanvasPalette;
  statusLabel: Record<CardStatus, string>;
}

export interface CardFace {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Baseline for the title when the card also carries meta; undefined keeps centre. */
  titleY: number;
}

function shortDate(value: string | undefined): string {
  if (!value) return "";
  return value.slice(5).replace("-", ".");
}

function range(card: Widget): string {
  const start = shortDate(card.startAt);
  const due = shortDate(card.dueAt);
  if (start && due) return `${start} — ${due}`;
  return start || due;
}

/** Local calendar date, so "overdue" does not flip at UTC midnight. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function statusColour(status: CardStatus, palette: CanvasPalette): string {
  if (status === "done") return palette.success;
  if (status === "in_progress") return palette.warning;
  return palette.textMuted;
}

/**
 * Draw the card's meta line and return the title baseline.
 *
 * A card without meta keeps its title centred. With meta, the title moves up and the
 * badges sit on the lower line. This is shared by the standalone card and the kanban
 * matrix, so the two cannot drift.
 */
export function drawCardMeta(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  card: Widget,
  theme: CardMetaTheme,
  zoom: number,
): number {
  const hasMeta = Boolean(card.status || card.assigneeName || card.startAt || card.dueAt);
  if (!hasMeta) return top + height / 2;

  const y = top + height - 13 / zoom;
  const leftEdge = left + 12;
  const rightEdge = left + width - 12;
  let x = leftEdge;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `${9.5 / zoom}px ${theme.fontFamily}`;

  if (card.status) {
    const label = theme.statusLabel[card.status] ?? card.status;
    const labelWidth = ctx.measureText(label).width;
    const room = rightEdge - x - 62 / zoom;
    if (room > 20 / zoom) {
      ctx.fillStyle = statusColour(card.status, theme.palette);
      ctx.beginPath();
      ctx.arc(x + 3 / zoom, y, 3 / zoom, 0, Math.PI * 2);
      ctx.fill();
      x += 11 / zoom;
      ctx.fillText(label, x, y);
      x += labelWidth + 10 / zoom;
    }
  }

  if (card.assigneeName) {
    const available = rightEdge - x - 70 / zoom;
    if (available > 16 / zoom) {
      const initials = card.assigneeName
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase())
        .join("")
        .slice(0, 2);
      const radius = 7 / zoom;
      ctx.fillStyle = theme.palette.selectionFill;
      ctx.beginPath();
      ctx.arc(x + radius, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.palette.textSecondary;
      ctx.font = `600 ${8 / zoom}px ${theme.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(initials || "?", x + radius, y);
      ctx.textAlign = "left";
      ctx.font = `${9.5 / zoom}px ${theme.fontFamily}`;
      x += radius * 2 + 6 / zoom;
    }
  }

  const dates = range(card);
  if (dates) {
    const overdue = Boolean(card.dueAt && card.dueAt < today());
    ctx.fillStyle = overdue ? theme.palette.danger : theme.palette.textMuted;
    ctx.textAlign = "right";
    ctx.fillText(overdue ? `! ${dates}` : dates, rightEdge, y);
    ctx.textAlign = "left";
  }
  return top + height / 2 - 8 / zoom;
}
