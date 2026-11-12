import {
  headerText,
  tableCellBorder,
  TABLE_HEADER_LINE_HEIGHT,
  TABLE_HEADER_PADDING,
  type TableBorder,
  type Widget,
} from "@remo/model";
import type { CanvasPalette } from "./palette";
import {
  cellFill,
  columnHeaderRect,
  cornerRect,
  layoutTable,
  rowHeaderRect,
} from "./table";

/**
 * Paint the grid of a section table (ADR-196, ADR-199).
 *
 * The table is content, not chrome: it is painted in the board layer after the frame's
 * own plate and before its children, so the notes sit inside the cells and the frame
 * title stays above. Fills are the named overrides; an absent fill leaves the frame's
 * panel showing.
 */

/** A title shortened until it fits in one line, with an ellipsis. */
function fitHeaderText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 0 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return cut > 0 ? `${text.slice(0, cut)}…` : "…";
}

/** Word-wrapped header text, with a hard break for a word wider than the cell. */
function wrapHeaderText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  const push = (value: string) => {
    if (value) lines.push(value);
  };
  for (const word of words) {
    let rest = word;
    while (rest) {
      const candidate = line ? `${line} ${rest}` : rest;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        rest = "";
        continue;
      }
      if (line) {
        push(line);
        line = "";
        continue;
      }
      let cut = rest.length;
      while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
  }
  push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitHeaderText(ctx, `${kept[maxLines - 1]}…`, maxWidth);
  return kept;
}

export function drawTable(
  ctx: CanvasRenderingContext2D,
  frame: Widget,
  widgets: readonly Widget[],
  zoom: number,
  palette: CanvasPalette,
  fontFamily: string,
): void {
  const layout = frame.layout;
  if (layout?.kind !== "table" || layout.active === false) return;
  const grid = layoutTable(frame, widgets);
  if (!grid) return;

  const appearance = layout.appearance;
  const headerFill = appearance?.headers ?? appearance?.table ?? palette.hover;
  const tableFill = appearance?.table;
  const line = 1 / zoom;
  const headerFont = `${12 / zoom}px ${fontFamily}`;
  const borders = appearance?.borders;
  const stroke = (border: TableBorder | undefined, fallback: string, fallbackWidth = 1) => {
    if (border?.style === "none") return false;
    ctx.strokeStyle = border?.color ?? fallback;
    ctx.lineWidth = (border?.width ?? fallbackWidth) / zoom;
    ctx.setLineDash(border?.style === "dashed" ? [4 / zoom, 3 / zoom] : []);
    return true;
  };
  const resetStroke = () => {
    ctx.setLineDash([]);
    ctx.lineWidth = line;
  };

  ctx.save();
  ctx.lineWidth = line;
  ctx.textBaseline = "middle";

  if (tableFill) {
    ctx.fillStyle = tableFill;
    ctx.fillRect(grid.origin.x, grid.origin.y, grid.width, grid.height);
  }

  // Column headers, row headers and the empty corner.
  for (const column of grid.columns) {
    const rect = columnHeaderRect(grid, column.axis.id)!;
    ctx.fillStyle = appearance?.columns?.[column.axis.id] ?? headerFill;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    const border =
      borders?.columns?.[column.axis.id] ?? borders?.headers ?? borders?.table;
    if (stroke(border, palette.borderSubtle)) ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    resetStroke();

    const text = headerText(column.axis.title);
    ctx.fillStyle = palette.textSecondary;
    ctx.font = headerFont;
    if (column.axis.vertical) {
      ctx.save();
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      // The header band grew to fit the title; only an extreme title is shortened,
      // never squeezed or scaled (ADR-201).
      ctx.fillText(fitHeaderText(ctx, text, rect.height - (TABLE_HEADER_PADDING * 2) / zoom), 0, 0);
      ctx.restore();
    } else {
      const lineHeight = TABLE_HEADER_LINE_HEIGHT / zoom;
      const maxLines = Math.max(
        1,
        Math.floor((rect.height - (TABLE_HEADER_PADDING * 2) / zoom) / lineHeight),
      );
      const lines = wrapHeaderText(
        ctx,
        text,
        rect.width - (TABLE_HEADER_PADDING * 2) / zoom,
        maxLines,
      );
      const total = lines.length * lineHeight;
      const start = rect.y + (rect.height - total) / 2 + lineHeight / 2;
      ctx.textAlign = "left";
      lines.forEach((line, index) =>
        ctx.fillText(line, rect.x + TABLE_HEADER_PADDING / zoom, start + index * lineHeight),
      );
    }
  }

  for (const row of grid.rows) {
    const rect = rowHeaderRect(grid, row.axis.id)!;
    ctx.fillStyle = appearance?.rows?.[row.axis.id] ?? headerFill;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    const border = borders?.rows?.[row.axis.id] ?? borders?.headers ?? borders?.table;
    if (stroke(border, palette.borderSubtle)) ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    resetStroke();
    ctx.fillStyle = palette.textSecondary;
    ctx.font = headerFont;
    const lineHeight = TABLE_HEADER_LINE_HEIGHT / zoom;
    const maxLines = Math.max(
      1,
      Math.floor((rect.height - (TABLE_HEADER_PADDING * 2) / zoom) / lineHeight),
    );
    const lines = wrapHeaderText(
      ctx,
      headerText(row.axis.title),
      rect.width - (TABLE_HEADER_PADDING * 2) / zoom,
      maxLines,
    );
    const total = lines.length * lineHeight;
    const start = rect.y + (rect.height - total) / 2 + lineHeight / 2;
    ctx.textAlign = "left";
    lines.forEach((line, index) =>
      ctx.fillText(line, rect.x + TABLE_HEADER_PADDING / zoom, start + index * lineHeight),
    );
  }

  const corner = cornerRect(grid);
  ctx.fillStyle = headerFill;
  ctx.fillRect(corner.x, corner.y, corner.width, corner.height);
  if (stroke(borders?.headers ?? borders?.table, palette.borderSubtle)) {
    ctx.strokeRect(corner.x, corner.y, corner.width, corner.height);
  }
  resetStroke();

  for (const cell of grid.cells) {
    const fill = cellFill(frame, cell.rowId, cell.columnId);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height);
    }
    const border = tableCellBorder(layout, cell.rowId, cell.columnId);
    if (stroke(border, palette.borderSubtle)) {
      ctx.strokeRect(cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height);
    }
    resetStroke();
  }

  // The outer edge is stronger than the inner grid, so a table reads as one object; a
  // table-level border replaces that emphasis (ADR-208).
  if (stroke(borders?.table, palette.borderStrong)) {
    ctx.strokeRect(grid.origin.x, grid.origin.y, grid.width, grid.height);
  }
  ctx.restore();
}
