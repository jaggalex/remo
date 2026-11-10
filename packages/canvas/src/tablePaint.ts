import type { Widget } from "@remo/model";
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
    ctx.strokeStyle = palette.borderSubtle;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.fillStyle = palette.textSecondary;
    ctx.font = headerFont;
    if (column.axis.vertical) {
      ctx.save();
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText(column.axis.title, 0, 0, rect.height - 12 / zoom);
      ctx.restore();
    } else {
      ctx.textAlign = "left";
      ctx.fillText(column.axis.title, rect.x + 10 / zoom, rect.y + rect.height / 2);
    }
  }

  for (const row of grid.rows) {
    const rect = rowHeaderRect(grid, row.axis.id)!;
    ctx.fillStyle = appearance?.rows?.[row.axis.id] ?? headerFill;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = palette.borderSubtle;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = palette.textSecondary;
    ctx.font = headerFont;
    ctx.textAlign = "left";
    ctx.fillText(row.axis.title, rect.x + 10 / zoom, rect.y + rect.height / 2);
  }

  const corner = cornerRect(grid);
  ctx.fillStyle = headerFill;
  ctx.fillRect(corner.x, corner.y, corner.width, corner.height);
  ctx.strokeStyle = palette.borderSubtle;
  ctx.strokeRect(corner.x, corner.y, corner.width, corner.height);

  for (const cell of grid.cells) {
    const fill = cellFill(frame, cell.rowId, cell.columnId);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height);
    }
    ctx.strokeStyle = palette.borderSubtle;
    ctx.strokeRect(cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height);
  }

  // The outer edge is stronger than the inner grid, so a table reads as one object.
  ctx.strokeStyle = palette.borderStrong;
  ctx.strokeRect(grid.origin.x, grid.origin.y, grid.width, grid.height);
  ctx.restore();
}
