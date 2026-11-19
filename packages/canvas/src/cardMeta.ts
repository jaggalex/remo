import type { CardStatus, TagColor, Widget } from "@remo/model";
import type { CanvasPalette } from "./palette";

/** The small print on a card: status, assignee and date range (ADR-106 amendment). */
export interface CardMetaTheme {
  fontFamily: string;
  palette: CanvasPalette;
  statusLabel: Record<CardStatus, string>;
  /** The room's tag vocabulary (ADR-102), so the face can name a card's tags. */
  tags?: ReadonlyMap<string, { name: string; color: TagColor }>;
}

/** At most this many tags on a face; the rest are in the panel (ADR-106). */
export const CARD_FACE_TAGS = 3;

/** The tags a card face shows, in the card's own order, skipping deleted ids. */
export function faceTags(
  card: Widget,
  tags: CardMetaTheme["tags"],
): Array<{ name: string; color: TagColor }> {
  if (!tags) return [];
  return (card.tagIds ?? [])
    .map((id) => tags.get(id))
    .filter((tag): tag is { name: string; color: TagColor } => Boolean(tag))
    .slice(0, CARD_FACE_TAGS);
}

/** One line of tag chips from `x`, clipped to `rightEdge`: a chip that does not fit is left out. */
function drawTagChips(
  ctx: CanvasRenderingContext2D,
  chips: Array<{ name: string; color: TagColor }>,
  x: number,
  y: number,
  rightEdge: number,
  theme: CardMetaTheme,
): void {
  const height = 14;
  const pad = 6;
  ctx.font = `600 9px ${theme.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let left = x;
  for (const chip of chips) {
    let label = chip.name;
    let width = ctx.measureText(label).width + pad * 2;
    // A long name is shortened rather than pushed off the card.
    while (left + width > rightEdge && label.length > 2) {
      label = `${label.slice(0, -2)}…`;
      width = ctx.measureText(label).width + pad * 2;
    }
    if (left + width > rightEdge) break;
    const colours = theme.palette.tags[chip.color] ?? theme.palette.tags.gray;
    ctx.fillStyle = colours.fill;
    ctx.beginPath();
    const r = height / 2;
    ctx.moveTo(left + r, y - r);
    ctx.arcTo(left + width, y - r, left + width, y + r, r);
    ctx.arcTo(left + width, y + r, left, y + r, r);
    ctx.arcTo(left, y + r, left, y - r, r);
    ctx.arcTo(left, y - r, left + width, y - r, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colours.ink;
    ctx.fillText(label, left + pad, y);
    left += width + 4;
  }
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
 *
 * Sizes are world units, like the title (ADR-235): the small print belongs to the card and
 * scales with it. The numbers are the ones it had at 100 %.
 */
export function drawCardMeta(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  card: Widget,
  theme: CardMetaTheme,
): number {
  const hasMeta = Boolean(card.status || card.assigneeName || card.startAt || card.dueAt);
  const chips = faceTags(card, theme.tags);
  if (!hasMeta && chips.length === 0) return top + height / 2;
  if (!hasMeta) {
    // Only tags: they take the bottom line, as the other fields would.
    drawTagChips(ctx, chips, left + 12, top + height - 13, left + width - 12, theme);
    return top + height / 2 - 8;
  }
  if (chips.length > 0) {
    // Tags and fields: a line of their own between the title and the fields.
    drawTagChips(ctx, chips, left + 12, top + height / 2 + 2, left + width - 12, theme);
  }

  const y = top + height - 13;
  const leftEdge = left + 12;
  const rightEdge = left + width - 12;
  let x = leftEdge;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `${9.5}px ${theme.fontFamily}`;

  if (card.status) {
    const label = theme.statusLabel[card.status] ?? card.status;
    const labelWidth = ctx.measureText(label).width;
    const room = rightEdge - x - 62;
    if (room > 20) {
      ctx.fillStyle = statusColour(card.status, theme.palette);
      ctx.beginPath();
      ctx.arc(x + 3, y, 3, 0, Math.PI * 2);
      ctx.fill();
      x += 11;
      ctx.fillText(label, x, y);
      x += labelWidth + 10;
    }
  }

  if (card.assigneeName) {
    const available = rightEdge - x - 70;
    if (available > 16) {
      const initials = card.assigneeName
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase())
        .join("")
        .slice(0, 2);
      const radius = 7;
      ctx.fillStyle = theme.palette.selectionFill;
      ctx.beginPath();
      ctx.arc(x + radius, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.palette.textSecondary;
      ctx.font = `600 ${8}px ${theme.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(initials || "?", x + radius, y);
      ctx.textAlign = "left";
      ctx.font = `${9.5}px ${theme.fontFamily}`;
      x += radius * 2 + 6;
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
  return chips.length > 0 ? top + 16 : top + height / 2 - 8;
}
